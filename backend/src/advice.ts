import {
  ANALYST_ACTOR,
  assessSuitability,
  type CaseState,
  type ClientProfile,
  type DecideAdviceRequest,
  ProductAttributes,
  RULES_VERSION,
  undismissedFindings,
} from "@qryvox/shared";
import { randomUUID } from "node:crypto";
import type { Db } from "./db/client.js";
import type { EventRow } from "./db/schema.js";
import { appendOnceWith, type EventDraft, findByEventId, findCompletedRun, foldCase, type Tx } from "./log.js";

// The client layer (#31): profiles, advice drafted by the suitability rules, and the adviser's decision.
// No model is called here. Every check runs inside the write transaction against the case as it stands
// then, so two concurrent requests cannot both leave advice in play.

// A request the case cannot take yet, or any more: answered 409, nothing appended.
export class AdviceConflict extends Error {
  override name = "AdviceConflict";
}

export class AdviceNotFound extends Error {
  override name = "AdviceNotFound";
}

const head = (eventId: string, type: EventDraft["type"]) => ({ eventId, type, v: 1, actor: ANALYST_ACTOR });

const supersede = (adviceId: string, cause: "profile_changed" | "product_changed"): EventDraft => ({
  ...head(randomUUID(), "advice.superseded"),
  payload: { advice_id: adviceId, cause },
});

// A new version of a client's profile. Advice drafted on the old version is superseded with it.
export function recordProfile(db: Db, caseId: string, eventId: string, profile: ClientProfile): Promise<EventRow> {
  return appendOnceWith(db, caseId, head(eventId, "client.profiled"), async (tx) => {
    const state = await foldCase(tx, caseId);
    return { payload: profile, companions: inPlay(state, profile.client_id).map((a) => supersede(a.adviceId, "profile_changed")) };
  });
}

// Advice for a client: their latest profile against the latest attributes run, on a verified pack. Advice
// still in play on an older attributes run is superseded; advice already on these same inputs is a 409.
export function draftAdvice(db: Db, caseId: string, eventId: string, clientId: string): Promise<EventRow> {
  return appendOnceWith(db, caseId, head(eventId, "advice.drafted"), async (tx) => {
    const state = await foldCase(tx, caseId);
    const client = state.clients.find((c) => c.clientId === clientId);
    if (!client) throw new AdviceConflict(`client ${clientId} has no profile in this case`);
    if (!latestCompleted(state, "findings")) {
      throw new AdviceConflict("the pack has not been verified: run the analysis steps before drafting advice");
    }
    const run = latestCompleted(state, "attributes");
    if (!run) throw new AdviceConflict("no completed attributes run: read the product's attributes first");

    const current = inPlay(state, clientId);
    const same = current.find((a) => a.attributes_run_id === run && a.profile_seq === client.profiledAtSeq);
    if (same) throw new AdviceConflict(`advice ${same.adviceId} is already drafted on this profile and these attributes`);

    const assessment = assessSuitability(client.profile, await attributesOf(tx, caseId, run), undismissedFindings(state));
    return {
      payload: {
        client_id: clientId,
        profile_seq: client.profiledAtSeq,
        attributes_run_id: run,
        ...assessment,
        rules_version: RULES_VERSION,
      },
      companions: current.map((a) => supersede(a.adviceId, "product_changed")),
    };
  });
}

// The adviser's sign-off. A retry of a decision already recorded returns it, even if the advice has been
// superseded since; a new decision on superseded advice is refused.
export async function decideAdvice(db: Db, caseId: string, adviceId: string, req: DecideAdviceRequest): Promise<EventRow> {
  if (!(await findByEventId(db, req.event_id))) {
    const advice = (await foldCase(db, caseId)).advice.find((a) => a.adviceId === adviceId);
    if (!advice) throw new AdviceNotFound(`advice ${adviceId} not found in case ${caseId}`);
  }
  return appendOnceWith(db, caseId, head(req.event_id, "advice.decided"), async (tx) => {
    const advice = (await foldCase(tx, caseId)).advice.find((a) => a.adviceId === adviceId);
    if (!advice || advice.supersededAtSeq !== null) {
      throw new AdviceConflict(`advice ${adviceId} was superseded by a newer profile or attributes run`);
    }
    return { payload: { advice_id: adviceId, decision: req.decision }, companions: [] };
  });
}

function inPlay(state: CaseState, clientId: string) {
  return state.advice.filter((a) => a.client_id === clientId && a.supersededAtSeq === null);
}

// The latest completed run of a step, by the seq it completed at.
function latestCompleted(state: CaseState, step: "findings" | "attributes"): string | null {
  const runs = state.stepRuns.filter((r) => r.step === step && r.status === "completed");
  return runs.sort((a, b) => (a.settledAtSeq ?? 0) - (b.settledAtSeq ?? 0)).at(-1)?.stepRunId ?? null;
}

// The stored output of a completed attributes run.
export async function attributesOf(db: Db | Tx, caseId: string, runId: string): Promise<ProductAttributes> {
  const row = await findCompletedRun(db, caseId, runId);
  return ProductAttributes.parse((row?.payload as { output?: unknown } | undefined)?.output);
}
