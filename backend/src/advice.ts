import {
  ANALYST_ACTOR,
  assessSuitability,
  type CaseState,
  type ClientListResponse,
  type ClientQueueEntry,
  type ClientProfile,
  type DecideAdviceRequest,
  type DecideListRequest,
  ProductAttributes,
  RULES_VERSION,
  type ShelfEntry,
  undismissedFindings,
  vulnerability,
} from "@qryvox/shared";
import { createHash, randomUUID } from "node:crypto";
import type { Db } from "./db/client.js";
import type { EventRow } from "./db/schema.js";
import {
  appendOnceWith,
  casesOfClient,
  profiledClients,
  casesWithCompletedStep,
  type EventDraft,
  findByEventId,
  findCompletedRun,
  foldCase,
  type Tx,
} from "./log.js";

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
// Recorded by the adviser by default; given by the client on their own page, the client is its actor.
export function recordProfile(db: Db, caseId: string, eventId: string, profile: ClientProfile, byClient = false): Promise<EventRow> {
  const event = { ...head(eventId, "client.profiled"), ...(byClient ? { actor: profile.client_id } : {}) };
  return appendOnceWith(db, caseId, event, async (tx) => {
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

    const attributes = await attributesOf(tx, caseId, run);
    const assessment = assessSuitability(client.profile, attributes, undismissedFindings(state));
    // Every other verified product is assessed for this client, whatever the verdict (#68): the same rules,
    // no model, so showing the whole shelf costs nothing. The alternatives are its suitable entries.
    const compared = await shelfComparison(tx, caseId, attributes, client.profile);
    const alternatives =
      assessment.verdict === "suitable"
        ? undefined
        : compared.filter((e) => e.verdict === "suitable").map((e) => ({ ...e, verdict: "suitable" as const }));
    return {
      payload: {
        client_id: clientId,
        profile_seq: client.profiledAtSeq,
        attributes_run_id: run,
        ...assessment,
        rules_version: RULES_VERSION,
        ...(alternatives ? { alternatives } : {}),
        shelf: compared,
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
    const state = await foldCase(tx, caseId);
    const advice = state.advice.find((a) => a.adviceId === adviceId);
    if (!advice || advice.supersededAtSeq !== null) {
      throw new AdviceConflict(`advice ${adviceId} was superseded by a newer profile or attributes run`);
    }
    // A vulnerable client's advice is approved only once the adviser confirms they explained it to the
    // client directly (#42). The confirmation is recorded with the decision.
    const client = state.clients.find((c) => c.clientId === advice.client_id);
    const why = client ? vulnerability(client.profile) : [];
    const confirmations = req.confirmations ?? [];
    if (req.decision === "approved" && why.length > 0 && !confirmations.includes("explained_directly")) {
      throw new AdviceConflict(
        `this client needs extra care (${why.join("; ")}): confirm you have explained the advice to them directly before approving`,
      );
    }
    // The adviser's pick (#71): one suitable product, on its approval.
    if (req.adviser_pick) {
      if (req.decision !== "approved") throw new AdviceConflict("only an approval can mark the adviser's pick");
      if (advice.verdict !== "suitable") throw new AdviceConflict("only a product the rules find suitable can be the adviser's pick");
    }
    return {
      payload: {
        advice_id: adviceId,
        decision: req.decision,
        ...(req.reason ? { reason: req.reason } : {}),
        ...(confirmations.length > 0 ? { confirmations } : {}),
        ...(req.adviser_pick ? { adviser_pick: true } : {}),
      },
      companions: [],
    };
  });
}

// The shelf (#39): every other verified product, from the cases it was verified in — a completed findings
// run and an attributes run that named the product — the latest verified case per product. Never the
// advice's own product, however many cases it has.
async function shelf(tx: Tx, caseId: string, own: ProductAttributes) {
  return verifiedProducts(tx, caseId, own.product_name?.value.toLowerCase());
}

// Every verified product, the latest verified case per name, except the case (and any case of the product
// named) `except`. A client's list (#71) takes them all.
async function verifiedProducts(tx: Db | Tx, caseId: string | null, ownName: string | undefined) {
  const products = new Map<string, { caseId: string; runId: string; at: string; attributes: ProductAttributes; state: CaseState }>();
  for (const id of await casesWithCompletedStep(tx, "attributes")) {
    if (id === caseId) continue;
    const state = await foldCase(tx, id);
    const runId = latestCompleted(state, "attributes");
    if (!runId || !latestCompleted(state, "findings")) continue;
    const row = await findCompletedRun(tx, id, runId);
    const attributes = ProductAttributes.parse((row?.payload as { output?: unknown } | undefined)?.output);
    const name = attributes.product_name?.value;
    if (!name || name.toLowerCase() === ownName) continue;
    const seen = products.get(name.toLowerCase());
    if (!seen || seen.at < row!.at) products.set(name.toLowerCase(), { caseId: id, runId, at: row!.at, attributes, state });
  }
  return [...products.values()];
}

// The shelf as the rules find it for this client: every other verified product with its verdict, its own
// reasons, disclosures and citations. Empty only when nothing else is verified.
async function shelfComparison(tx: Tx, caseId: string, own: ProductAttributes, profile: ClientProfile): Promise<ShelfEntry[]> {
  return (await shelf(tx, caseId, own)).map((product) => {
    const assessment = assessSuitability(profile, product.attributes, undismissedFindings(product.state));
    return {
      case_id: product.caseId,
      product_name: product.attributes.product_name!.value,
      attributes_run_id: product.runId,
      verdict: assessment.verdict,
      reasons: assessment.reasons,
      disclosures: assessment.disclosures,
    };
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

// --- A client's list (#71, ADR-0008) ---

// An event id derived from the request's and the case's, so one request that appends to many cases is safe to
// repeat: the same request names the same events. Shaped as a version-4 uuid, as every event id is.
function derivedId(eventId: string, caseId: string, label: string): string {
  const h = createHash("sha256").update(`${eventId}:${caseId}:${label}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// The client's answers, given once: recorded in every verified product's case and drafted against each, by
// the rules and no model. A retry with the same event_id finishes what a failure left and appends nothing twice.
export async function recordClientList(db: Db, eventId: string, profile: ClientProfile): Promise<ClientListResponse> {
  const products = await verifiedProducts(db, null, undefined);
  if (products.length === 0) throw new AdviceConflict("no product is verified yet: there is nothing to compare for this client");
  const listed: ClientListResponse["products"] = [];
  for (const product of products) {
    await recordProfile(db, product.caseId, derivedId(eventId, product.caseId, "profile"), profile, true);
    const advice = derivedId(eventId, product.caseId, "advice");
    await draftAdvice(db, product.caseId, advice, profile.client_id);
    listed.push({ case_id: product.caseId, advice_id: advice });
  }
  return { client_id: profile.client_id, products: listed };
}

// The cases that hold this client's answers, or a 404 for a client nobody has recorded.
export async function clientCases(db: Db, clientId: string): Promise<string[]> {
  const ids = await casesOfClient(db, clientId);
  if (ids.length === 0) throw new AdviceNotFound(`client ${clientId} not found`);
  return ids;
}

// The adviser's one decision on the client's whole list: their advice in play in every case, approved or
// rejected together, optionally with one suitable product as the pick. Everything is checked before anything
// is appended, so a refusal leaves no case decided; a retry repeats the same events.
export async function decideList(db: Db, clientId: string, req: DecideListRequest): Promise<ClientListResponse> {
  const targets: { caseId: string; adviceId: string; verdict: string }[] = [];
  for (const caseId of await clientCases(db, clientId)) {
    const advice = inPlay(await foldCase(db, caseId), clientId).at(-1);
    if (advice) targets.push({ caseId, adviceId: advice.adviceId, verdict: advice.verdict });
  }
  if (targets.length === 0) throw new AdviceConflict(`client ${clientId} has no advice in play to decide`);
  if (req.pick_case_id !== undefined) {
    const pick = targets.find((t) => t.caseId === req.pick_case_id);
    if (req.decision !== "approved") throw new AdviceConflict("only an approval can mark the adviser's pick");
    if (!pick) throw new AdviceConflict(`case ${req.pick_case_id} is not on this client's list`);
    if (pick.verdict !== "suitable") throw new AdviceConflict("only a product the rules find suitable can be the adviser's pick");
  }
  const decided: ClientListResponse["products"] = [];
  for (const t of targets) {
    await decideAdvice(db, t.caseId, t.adviceId, {
      event_id: derivedId(req.event_id, t.caseId, "decision"),
      decision: req.decision,
      ...(req.reason ? { reason: req.reason } : {}),
      ...(req.confirmations ? { confirmations: req.confirmations } : {}),
      ...(t.caseId === req.pick_case_id ? { adviser_pick: true } : {}),
    });
    decided.push({ case_id: t.caseId, advice_id: t.adviceId });
  }
  return { client_id: clientId, products: decided };
}

// The adviser's queue (#71): each client with advice in play, the cases holding it and the state of each
// decision. Read-only; oldest answers first.
export async function clientQueue(db: Db): Promise<ClientQueueEntry[]> {
  const queue: ClientQueueEntry[] = [];
  for (const { clientId, at } of await profiledClients(db)) {
    const cases: ClientQueueEntry["cases"] = [];
    let vulnerable = false;
    for (const caseId of await casesOfClient(db, clientId)) {
      const state = await foldCase(db, caseId);
      const advice = inPlay(state, clientId).at(-1);
      if (!advice) continue;
      const profile = state.clients.find((c) => c.clientId === clientId)?.profile;
      if (profile && vulnerability(profile).length > 0) vulnerable = true;
      cases.push({ case_id: caseId, advice_id: advice.adviceId, verdict: advice.verdict, decision: advice.decision?.decision ?? null });
    }
    if (cases.length > 0) queue.push({ client_id: clientId, vulnerable, answered_at: at, cases });
  }
  return queue;
}
