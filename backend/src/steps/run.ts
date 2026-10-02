import { randomUUID } from "node:crypto";
import { ANALYST_ACTOR, PROMPT_VERSIONS, type RunStepRequest, type StepFailure, type StepResult } from "@qryvox/shared";
import type { Db } from "../db/client";
import type { EventRow } from "../db/schema";
import { extractJson, LlmError, type Llm } from "../llm";
import { append, EventIdConflict, findCompletedRun, isUniqueViolation } from "../log";
import { extract } from "./extract";
import type { AnyStep } from "./step";

// Steps land one ticket at a time; a step missing here answers 501.
const STEPS: Partial<Record<RunStepRequest["step"], AnyStep>> = { extract };

export class StepNotImplemented extends Error {
  override name = "StepNotImplemented";
}

export class LlmNotConfigured extends Error {
  override name = "LlmNotConfigured";
}

export type StepOutcome = { status: 200; body: StepResult } | { status: 422 | 502; body: StepFailure };

// One analysis step as a single stateless call, safe to retry (ADR-0002):
//   1. a run that already completed returns its stored result — before any model call, so a retry is free;
//   2. otherwise step.started is appended, then the model is called with no transaction open;
//   3. step.completed (and, for the findings step, its findings) is appended in one write transaction;
//   4. if a concurrent duplicate completed first, the partial unique index rejects ours, the transaction
//      rolls back whole, and the winner's stored result is returned instead.
export async function runStep(db: Db, llm: Llm | null, caseId: string, req: RunStepRequest): Promise<StepOutcome> {
  const done = await findCompletedRun(db, caseId, req.step_run_id);
  if (done) return completedOutcome(done, req);

  const step = STEPS[req.step];
  if (!step) throw new StepNotImplemented(`step ${req.step} is not implemented yet`);
  if (!llm) throw new LlmNotConfigured("no model is configured: set LLM_BASE_URL and LLM_MODEL");

  const input = await step.loadInput(db, caseId, req.input_run_id);
  const run = {
    step: req.step,
    model: llm.model,
    prompt_version: PROMPT_VERSIONS[req.step],
    input_run_id: req.input_run_id,
  };
  const draft = { v: 1, actor: ANALYST_ACTOR, stepRunId: req.step_run_id };

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

  try {
    const [row] = await append(db, caseId, [
      {
        ...draft,
        eventId: randomUUID(),
        type: "step.completed",
        payload: { ...run, output: grounded.output, raw_response: completion.raw },
      },
    ]);
    return completedOutcome(row!, req);
  } catch (err) {
    if (!isUniqueViolation(err, "events.case_id, events.step_run_id")) throw err;
    const winner = await findCompletedRun(db, caseId, req.step_run_id);
    if (!winner) throw err;
    return completedOutcome(winner, req);
  }
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
