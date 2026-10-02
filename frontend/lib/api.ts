import { EventPage, type SlimEvent, VerifyResponse } from "@qryvox/shared";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

export class NotFound extends Error {}

async function get(path: string): Promise<unknown> {
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  if (res.status === 404) throw new NotFound(path);
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

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
