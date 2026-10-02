import {
  AppendResponse,
  ChangeDispositionRequest,
  EventPage,
  type IngestedDocument,
  OpenCaseResponse,
  type RunStepRequest,
  type SlimEvent,
  StepFailure,
  StepResult,
  VerifyResponse,
} from "@qryvox/shared";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

export class NotFound extends Error {}

// A step that ran and failed: the server appended step.failed and says why — 422 when the model's output
// did not parse, 502 when the model was unreachable. The body is parsed rather than flattened into text,
// because the sequence number it carries is what the log shows the analyst as the step's record.
export class StepFailureError extends Error {
  override name = "StepFailureError";
  constructor(readonly failure: ReturnType<typeof StepFailure.parse>) {
    super(failure.error);
  }
}

async function send(method: "GET" | "POST", path: string, body?: unknown): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    method,
    cache: "no-store",
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
}

// One shape for both verbs, so a message off the wire reads the same whichever call it came from.
// The body is read once and carried into every failure, the 404 included: a server that says *why* —
// "finding X was superseded by a later findings run" — is the only reason the analyst gets for a control
// that refused them, and a bare status code is not a reason.
async function request(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
  const res = await send(method, path, body);
  if (res.ok) return res.json();
  const text = await res.text();
  if (res.status === 404) throw new NotFound(`${method} ${path}: 404 ${text}`);
  throw new Error(`${method} ${path}: ${res.status} ${text}`);
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

// One analysis step, as one awaited call (spec decision 19): no background job, no streaming, no server
// orchestration. step_run_id is the browser's to name (spec decision 25), so a retry after a failure
// reuses the same id and the server hands back the run it already completed without calling the model.
export async function runStep(caseId: string, req: RunStepRequest): Promise<StepResult> {
  const path = `/cases/${caseId}/steps`;
  const res = await send("POST", path, req);
  if (res.ok) return StepResult.parse(await res.json());
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  const failure = StepFailure.safeParse(body);
  if (failure.success) throw new StepFailureError(failure.data);
  throw new Error(`POST ${path}: ${res.status} ${text}`);
}

// The analyst's explicit decision on one finding, by button or keyboard. Nothing is decided anywhere else,
// and a retry with the same event_id appends nothing (spec decision 34, ADR-0002).
export async function changeDisposition(caseId: string, req: ChangeDispositionRequest): Promise<AppendResponse> {
  return AppendResponse.parse(await post(`/cases/${caseId}/dispositions`, req));
}
