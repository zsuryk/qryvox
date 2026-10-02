import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// The only table (spec decision 11). Append-only: triggers in drizzle/0001_append_only_triggers.sql.
export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // Per-case sequence, 1..n with no gaps.
    seq: integer("seq").notNull(),
    eventId: text("event_id").notNull(),
    caseId: text("case_id").notNull(),
    type: text("type").notNull(),
    v: integer("v").notNull(),
    actor: text("actor").notNull(),
    at: text("at").notNull(),
    stepRunId: text("step_run_id"),
    ipHash: text("ip_hash"),
    payload: text("payload", { mode: "json" }).notNull().$type<Record<string, unknown>>(),
    hash: text("hash").notNull(),
    prevHash: text("prev_hash"),
  },
  (t) => [
    uniqueIndex("events_event_id_unique").on(t.eventId),
    // Also stops the chain forking: two appends that read the same latest seq cannot both commit.
    uniqueIndex("events_case_seq_unique").on(t.caseId, t.seq),
    // A step run completes at most once (ADR-0002). Deliberately not (case_id, step_run_id, type):
    // a findings run appends many finding.created events under one step_run_id.
    uniqueIndex("events_step_completed_unique")
      .on(t.caseId, t.stepRunId)
      .where(sql`${t.type} = 'step.completed'`),
  ],
);

export type EventRow = typeof events.$inferSelect;
