import type { Finding, StepName } from "@qryvox/shared";
import type { z } from "zod";
import type { Db } from "../db/client.js";
import type { EventDraft, Tx } from "../log.js";
import type { ChatMessage } from "../llm.js";

// A step cannot run yet: no documents, or its input run is missing. Nothing is appended, no tokens spent.
export class StepPrecondition extends Error {
  override name = "StepPrecondition";
}

// Output is what the run stores and returns; Reply is what the model must answer, when the two differ.
export type StepDefinition<Input, Output extends Record<string, unknown>, Reply = Output> = {
  name: StepName;
  // Reads what the step consumes from the log. Steps are stateless: the log is their only input.
  loadInput(db: Db, caseId: string, inputRunId: string | null): Promise<Input>;
  // The versioned prompt. Never sent to the interface; only PROMPT_VERSIONS[name] is recorded.
  messages(input: Input): ChatMessage[];
  output: z.ZodType<Reply>;
  // Checks the parsed reply against the input (e.g. quotes really appear on the cited page).
  // Returns the output to store, or an error that fails the run.
  ground(reply: Reply, input: Input): { output: Output } | { error: string };
  // The findings this run puts on the board, appended with its step.completed in one transaction.
  toFindings?(output: Output): Finding[];
  // Other events that follow from this run completing, built inside the same write transaction from what
  // the log holds then (e.g. a new attributes run superseding advice drafted on an older one).
  alsoAppend?(tx: Tx, caseId: string, stepRunId: string): Promise<EventDraft[]>;
};

// Erases the type parameters so steps can share one registry.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyStep = StepDefinition<any, Record<string, unknown>, any>;
