import { z } from "zod";

// Envelope fields carried by every event, named as in ADR-0002.
// hash / prev_hash stay server-side (ADR-0002: the browser never verifies the chain).
const envelope = {
  seq: z.number().int().positive(),
  event_id: z.uuid(),
  case_id: z.string().min(1),
  v: z.number().int().positive(),
  actor: z.string().min(1),
  at: z.iso.datetime(),
  step_run_id: z.string().min(1).nullable(),
};

export const CaseOpened = z.object({
  ...envelope,
  type: z.literal("case.opened"),
  payload: z.object({}),
});

// Scaffold: the remaining ADR-0002 types land with the tickets that emit them.
export const Event = z.discriminatedUnion("type", [CaseOpened]);
export type Event = z.infer<typeof Event>;

export type EventType = Event["type"];
export const EVENT_TYPES = Event.options.map((o) => o.shape.type.value) as readonly EventType[];
