import type { StepName } from "@qryvox/shared";
import type { z } from "zod";
import type { Db } from "../db/client";
import type { ChatMessage } from "../llm";

// A step cannot run yet: no documents, or its input run is missing. Nothing is appended, no tokens spent.
export class StepPrecondition extends Error {
  override name = "StepPrecondition";
}

export type StepDefinition<Input, Output extends Record<string, unknown>> = {
  name: StepName;
  // Reads what the step consumes from the log. Steps are stateless: the log is their only input.
  loadInput(db: Db, caseId: string, inputRunId: string | null): Promise<Input>;
  // The versioned prompt. Never sent to the interface; only PROMPT_VERSIONS[name] is recorded.
  messages(input: Input): ChatMessage[];
  output: z.ZodType<Output>;
  // Checks the parsed output against the input (e.g. quotes really appear on the cited page).
  // Returns the output to store, or an error that fails the run.
  ground(output: Output, input: Input): { output: Output } | { error: string };
};

// Erases the type parameters so steps can share one registry.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyStep = StepDefinition<any, Record<string, unknown>>;
