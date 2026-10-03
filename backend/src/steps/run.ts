import { randomUUID } from "node:crypto";
import { ANALYST_ACTOR, PROMPT_VERSIONS, type RunStepRequest, type StepFailure, type StepResult } from "@qryvox/shared";
import type { Db } from "../db/client.js";
import type { EventRow } from "../db/schema.js";
import { checkRateLimit, type RateLimits } from "../guards.js";
import { extractJson, LlmError, type Llm } from "../llm.js";
import { append, EventIdConflict, type EventDraft, findCompletedRun, isUniqueViolation, listEventsOfType, type Tx } from "../log.js";
import { attributes } from "./attributes.js";
import { contradictions } from "./contradictions.js";
import { decompose } from "./decompose.js";
import { explain } from "./explain.js";
import { extract } from "./extract.js";
import { findings } from "./findings.js";
import type { AnyStep } from "./step.js";

const STEPS: Record<RunStepRequest["step"], AnyStep> = { extract, decompose, contradictions, findings, attributes, explain };

export class LlmNotConfigured extends Error {
  override name = "LlmNotConfigured";
}

// Who is asking, for the rate limit and the ip_hash stored on every event the run appends.
export type StepCaller = { ipHash: string; limits: RateLimits };

export type StepOutcome = { status: 200; body: StepResult } | { status: 422 | 502; body: StepFailure };

// One analysis step as a single stateless call, safe to retry (ADR-0002):
//   1. a run that already completed returns its stored result — before any model call, so a retry is free;
//   2. otherwise, within the rate limit, step.started is appended, then the model is called with no
//      transaction open;
//   3. step.completed, and for the findings step its findings plus a finding.superseded for every finding
//      a previous run left on the board, is appended in one write transaction;
//   4. if a concurrent duplicate completed first, the partial unique index rejects ours, the transaction
//      rolls back whole, and the winner's stored result is returned instead.
export async function runStep(
  db: Db,
  llm: Llm | null,
  caseId: string,
  req: RunStepRequest,
  caller: StepCaller,
): Promise<StepOutcome> {
  const done = await findCompletedRun(db, caseId, req.step_run_id);
  if (done) return completedOutcome(done, req);

  const step = STEPS[req.step];
  if (!llm) throw new LlmNotConfigured("no model is configured: set LLM_BASE_URL and LLM_MODEL");

  const input = await step.loadInput(db, caseId, req.input_run_id);
  // Only a run about to spend tokens counts: a stored result or a precondition failure never gets here.
  await checkRateLimit(db, caseId, caller.ipHash, caller.limits);
  const run = {
    step: req.step,
    model: llm.model,
    prompt_version: PROMPT_VERSIONS[req.step],
    input_run_id: req.input_run_id,
  };
  const draft = { v: 1, actor: ANALYST_ACTOR, stepRunId: req.step_run_id, ipHash: caller.ipHash };

  await append(db, caseId, [{ ...draft, eventId: randomUUID(), type: "step.started", payload: run }]);

  const fail = async (status: 422 | 502, error: string, raw: unknown): Promise<StepOutcome> => {
    const [row] = await append(db, caseId, [
      { ...draft, eventId: randomUUID(), type: "step.failed", payload: { ...run, error, raw_response: raw } },
    ]);
    return { status, body: { error, step_run_id: req.step_run_id, seq: row!.seq } };
  };

  let completion;
  try {
    completion = await llm.complete(step.messages(input));
  } catch (err) {
    if (!(err instanceof LlmError)) throw err;
    return fail(502, err.message, err.raw);
  }

  const parsed = step.output.safeParse(extractJson(completion.content));
  if (!parsed.success) return fail(422, `model output did not match the ${req.step} schema`, completion.raw);
  const grounded = step.ground(parsed.data, input);
  if ("error" in grounded) return fail(422, grounded.error, completion.raw);

  const created = step.toFindings?.(grounded.output) ?? [];
  try {
    const [row] = await append(db, caseId, async (tx) => [
      {
        ...draft,
        eventId: randomUUID(),
        type: "step.completed",
        payload: { ...run, output: grounded.output, raw_response: completion.raw },
      },
      // Read inside the transaction, so two findings runs completing together cannot both stay on the board.
      ...(step.toFindings ? await supersededBy(tx, caseId, draft) : []),
      ...created.map((finding): EventDraft => ({ ...draft, eventId: randomUUID(), type: "finding.created", payload: finding })),
    ]);
    return completedOutcome(row!, req);
  } catch (err) {
    if (!isUniqueViolation(err, "events.case_id, events.step_run_id")) throw err;
    const winner = await findCompletedRun(db, caseId, req.step_run_id);
    if (!winner) throw err;
    return completedOutcome(winner, req);
  }
}

// One finding.superseded for each finding still on the board: the new run replaces it.
async function supersededBy(tx: Tx, caseId: string, draft: Omit<EventDraft, "eventId" | "type" | "payload">): Promise<EventDraft[]> {
  const ids = (rows: { payload: Record<string, unknown> }[]) => rows.map((r) => String(r.payload.finding_id));
  const superseded = new Set(ids(await listEventsOfType(tx, caseId, "finding.superseded")));
  return ids(await listEventsOfType(tx, caseId, "finding.created"))
    .filter((id) => !superseded.has(id))
    .map((finding_id) => ({ ...draft, eventId: randomUUID(), type: "finding.superseded", payload: { finding_id } }));
}

function completedOutcome(row: EventRow, req: RunStepRequest): StepOutcome {
  const p = row.payload as { step: string; prompt_version: string; model: string; output: Record<string, unknown> };
  if (p.step !== req.step) {
    throw new EventIdConflict(`step_run_id ${req.step_run_id} already completed a ${p.step} step`);
  }
  return {
    status: 200,
    body: {
      step_run_id: req.step_run_id,
      step: req.step,
      seq: row.seq,
      prompt_version: p.prompt_version,
      model: p.model,
      output: p.output,
    },
  };
}
