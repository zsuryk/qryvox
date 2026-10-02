import { createHash } from "node:crypto";

// Stable key order at every depth, so the same event always hashes the same.
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

export type HashedFields = {
  seq: number;
  eventId: string;
  caseId: string;
  type: string;
  v: number;
  actor: string;
  at: string;
  stepRunId: string | null;
  ipHash: string | null;
  payload: Record<string, unknown>;
};

// Each event's own hash covers its full content (heavy fields included) plus the previous hash,
// so the newest event is protected without waiting for a successor (ADR-0002).
// Computed in the API process only — never in the browser.
export function hashEvent(fields: HashedFields, prevHash: string | null): string {
  const content = {
    seq: fields.seq,
    event_id: fields.eventId,
    case_id: fields.caseId,
    type: fields.type,
    v: fields.v,
    actor: fields.actor,
    at: fields.at,
    step_run_id: fields.stepRunId,
    ip_hash: fields.ipHash,
    payload: fields.payload,
    prev_hash: prevHash,
  };
  return createHash("sha256").update(canonicalJson(content)).digest("hex");
}
