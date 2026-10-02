import {
  AppendResponse,
  EventPage,
  type IngestedDocument,
  OpenCaseResponse,
  type SlimEvent,
  VerifyResponse,
} from "@qryvox/shared";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

export class NotFound extends Error {}

// One shape for both verbs, so a message off the wire reads the same whichever call it came from.
async function request(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    cache: "no-store",
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (res.status === 404) throw new NotFound(`${method} ${path}: 404`);
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

const get = (path: string) => request("GET", path);
const post = (path: string, body: unknown) => request("POST", path, body);

// Follows the seq-paged event list to the end.
export async function fetchEvents(caseId: string): Promise<SlimEvent[]> {
  const events: SlimEvent[] = [];
  for (let more = true; more; ) {
    const page = EventPage.parse(await get(`/cases/${caseId}/events?after=${events.at(-1)?.seq ?? 0}`));
    events.push(...page.events);
    more = page.has_more;
  }
  return events;
}

export async function fetchVerify(caseId: string): Promise<VerifyResponse> {
  return VerifyResponse.parse(await get(`/cases/${caseId}/verify`));
}

// event_id is the browser's to name (ADR-0002): the caller passes the same one on a retry and the
// server returns the event it already wrote rather than appending a second.
export async function openCase(eventId: string): Promise<OpenCaseResponse> {
  return OpenCaseResponse.parse(await post("/cases", { event_id: eventId }));
}

// The PDF itself never goes over the wire — only what the browser read out of it in lib/intake.ts.
export async function ingestDocument(caseId: string, eventId: string, document: IngestedDocument): Promise<AppendResponse> {
  return AppendResponse.parse(await post(`/cases/${caseId}/documents`, { event_id: eventId, document }));
}
