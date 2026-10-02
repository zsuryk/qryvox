import type { Event, VerifyResponse } from "@qryvox/shared";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { events, type EventRow } from "./db/schema.js";
import { hashEvent } from "./hash.js";

export type EventDraft = {
  eventId: string;
  type: Event["type"];
  v: number;
  actor: string;
  stepRunId?: string | null;
  ipHash?: string | null;
  payload: Record<string, unknown>;
};

// Write transactions from this process run one at a time. The local libSQL driver is synchronous: a
// second BEGIN IMMEDIATE would block the event loop on the file lock that the first transaction, on
// this same loop, can then never release. Across processes and on Turso the database serializes.
const writeQueues = new WeakMap<Db, Promise<unknown>>();

function exclusive<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  const run = (writeQueues.get(db) ?? Promise.resolve()).then(fn, fn);
  writeQueues.set(db, run.catch(() => undefined));
  return run;
}

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// Every append is one write transaction (ADR-0002): read the case's latest seq and hash, chain the
// new events onto it, insert, commit. Callers do any slow work (model calls) before calling this.
// Drafts may be built inside the transaction when they depend on what the log holds at commit time.
export async function append(
  db: Db,
  caseId: string,
  drafts: readonly EventDraft[] | ((tx: Tx) => Promise<readonly EventDraft[]>),
): Promise<EventRow[]> {
  return exclusive(db, () =>
    db.transaction(async (tx) => chainAndInsert(tx, caseId, typeof drafts === "function" ? await drafts(tx) : drafts)),
  );
}

async function chainAndInsert(tx: Tx, caseId: string, drafts: readonly EventDraft[]): Promise<EventRow[]> {
  const [last] = await tx
    .select({ seq: events.seq, hash: events.hash })
    .from(events)
    .where(eq(events.caseId, caseId))
    .orderBy(desc(events.seq))
    .limit(1);

  let seq = last?.seq ?? 0;
  let prevHash = last?.hash ?? null;
  const at = new Date().toISOString();

  const rows = drafts.map((d) => {
    seq += 1;
    const fields = {
      seq,
      eventId: d.eventId,
      caseId,
      type: d.type,
      v: d.v,
      actor: d.actor,
      at,
      stepRunId: d.stepRunId ?? null,
      ipHash: d.ipHash ?? null,
      payload: d.payload,
    };
    const hash = hashEvent(fields, prevHash);
    const row = { ...fields, hash, prevHash };
    prevHash = hash;
    return row;
  });

  return tx.insert(events).values(rows).returning();
}

export class EventIdConflict extends Error {
  override name = "EventIdConflict";
}

// For events the browser originates: a retry with the same event_id returns the stored event
// instead of appending a second one, including when the original is still in flight.
export async function appendOnce(db: Db, caseId: string, draft: EventDraft): Promise<EventRow> {
  const existing = await findByEventId(db, draft.eventId);
  if (existing) return sameEventOrThrow(existing, caseId, draft);
  try {
    const [row] = await append(db, caseId, [draft]);
    return row!;
  } catch (err) {
    if (!isUniqueViolation(err, "events.event_id")) throw err;
    const winner = await findByEventId(db, draft.eventId);
    if (!winner) throw err;
    return sameEventOrThrow(winner, caseId, draft);
  }
}

function sameEventOrThrow(row: EventRow, caseId: string, draft: EventDraft): EventRow {
  if (row.caseId !== caseId || row.type !== draft.type) {
    throw new EventIdConflict(`event_id ${draft.eventId} is already used by a different event`);
  }
  return row;
}

export function isUniqueViolation(err: unknown, column: string): boolean {
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    if (e.message.includes(`UNIQUE constraint failed: ${column}`)) return true;
  }
  return false;
}

async function findByEventId(db: Db, eventId: string): Promise<EventRow | undefined> {
  const [row] = await db.select().from(events).where(eq(events.eventId, eventId)).limit(1);
  return row;
}

export async function caseExists(db: Db, caseId: string): Promise<boolean> {
  const [row] = await db
    .select({ type: events.type })
    .from(events)
    .where(and(eq(events.caseId, caseId), eq(events.seq, 1)))
    .limit(1);
  return row?.type === "case.opened";
}

export async function listEvents(db: Db, caseId: string, after: number, limit: number): Promise<EventRow[]> {
  return db
    .select()
    .from(events)
    .where(and(eq(events.caseId, caseId), gt(events.seq, after)))
    .orderBy(asc(events.seq))
    .limit(limit);
}

export async function getEvent(db: Db, caseId: string, seq: number): Promise<EventRow | undefined> {
  const [row] = await db
    .select()
    .from(events)
    .where(and(eq(events.caseId, caseId), eq(events.seq, seq)))
    .limit(1);
  return row;
}

// Re-hashes the whole chain from stored rows. Tamper-evident, not tamper-proof (ADR-0002).
export async function verifyChain(db: Db, caseId: string): Promise<VerifyResponse> {
  const rows = await listEvents(db, caseId, 0, Number.MAX_SAFE_INTEGER);
  let prevHash: string | null = null;
  let brokenAt: number | null = null;

  for (const [i, row] of rows.entries()) {
    const linked = row.seq === i + 1 && row.prevHash === prevHash;
    if (!linked || hashEvent(row, prevHash) !== row.hash) {
      brokenAt = row.seq;
      break;
    }
    prevHash = row.hash;
  }

  return {
    intact: brokenAt === null,
    event_count: rows.length,
    latest_hash: rows.at(-1)?.hash ?? null,
    broken_at_seq: brokenAt,
  };
}

// The wire shape of an event: envelope + payload. hash, prev_hash and ip_hash never leave the server.
export function toWire(row: EventRow) {
  return {
    seq: row.seq,
    event_id: row.eventId,
    case_id: row.caseId,
    type: row.type,
    v: row.v,
    actor: row.actor,
    at: row.at,
    step_run_id: row.stepRunId,
    payload: row.payload,
  };
}

export async function listEventsOfType(db: Db | Tx, caseId: string, type: Event["type"]): Promise<EventRow[]> {
  return db
    .select()
    .from(events)
    .where(and(eq(events.caseId, caseId), eq(events.type, type)))
    .orderBy(asc(events.seq));
}

export async function findCompletedRun(db: Db, caseId: string, stepRunId: string): Promise<EventRow | undefined> {
  const [row] = await db
    .select()
    .from(events)
    .where(and(eq(events.caseId, caseId), eq(events.stepRunId, stepRunId), eq(events.type, "step.completed")))
    .limit(1);
  return row;
}
