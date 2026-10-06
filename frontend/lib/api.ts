import {
  type AdviceDecision,
  AppendResponse,
  type CardOperationRequest,
  ClientCasesResponse,
  ClientListResponse,
  ClientQueueResponse,
  CardOperationResponse,
  ChangeDispositionRequest,
  type ClientProfile,
  type DecisionConfirmation,
  type KnowledgeLevel,
  type RejectionReason,
  ErrorResponse,
  EventPage,
  type IngestedDocument,
  API_TOKEN_HEADER,
  API_TOKEN_PARAM,
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

// The API token (ADR-0001, #19). The demo link carries ?k=<token>; it is kept for the tab in
// sessionStorage and taken out of the address bar, so it does not travel on in a screenshot, a copied link
// or a referrer. Every call carries it; only analysis steps need it. Without one, nothing changes: a local
// backend with no API_TOKEN asks for none.
const TOKEN_KEY = "qryvox.api-token";

export function captureApiToken(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const token = url.searchParams.get(API_TOKEN_PARAM);
  if (!token) return;
  try {
    window.sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Storage refused (a private window, blocked site data): the link still works for this page load.
    memoryToken = token;
  }
  url.searchParams.delete(API_TOKEN_PARAM);
  window.history.replaceState(window.history.state, "", url);
}

let memoryToken: string | null = null;

function apiToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(TOKEN_KEY) ?? memoryToken;
  } catch {
    return memoryToken;
  }
}

async function send(method: "GET" | "POST", path: string, body?: unknown): Promise<Response> {
  const token = apiToken();
  const headers = {
    ...(body === undefined ? {} : { "content-type": "application/json" }),
    ...(token ? { [API_TOKEN_HEADER]: token } : {}),
  };
  return fetch(`${API_URL}${path}`, {
    method,
    cache: "no-store",
    ...(Object.keys(headers).length === 0 ? {} : { headers }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
  // The API token, missing or wrong: said as what to do, not as a status code.
  if (res.status === 401) {
    throw new Error("this demo link is missing its access token, or the token is wrong. Open the link you were given again.");
  }
  throw new Error(`POST ${path}: ${res.status} ${text}`);
}

// The analyst's explicit decision on one finding, by button or keyboard. Nothing is decided anywhere else,
// and a retry with the same event_id appends nothing (spec decision 34, ADR-0002).
export async function changeDisposition(caseId: string, req: ChangeDispositionRequest): Promise<AppendResponse> {
  return AppendResponse.parse(await post(`/cases/${caseId}/dispositions`, req));
}

// One card operation on a live case's canvas (#65), named by the browser's event_id so a retry appends
// nothing. The answer is the event as the log recorded it. A refusal is thrown as the server's own reason
// (a card the case no longer has, a dock into the wrong category), since that is what the analyst needs.
export async function recordCardOperation(caseId: string, req: CardOperationRequest): Promise<CardOperationResponse> {
  const res = await send("POST", `/cases/${caseId}/cards`, req);
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  if (res.ok) return CardOperationResponse.parse(body);
  throw new Error(ErrorResponse.safeParse(body).data?.error ?? `the server answered ${res.status}`);
}

// --- The client layer. Each is an append the browser names by event_id, so a retry after a lost
// response returns the event already written rather than writing a second (ADR-0002).

// A new version of a client's answers. The server supersedes advice drafted on the old version.
// byClient: the client gave these answers themselves, so the log records them as the actor.
export async function recordProfile(caseId: string, eventId: string, profile: ClientProfile, byClient = false): Promise<AppendResponse> {
  return AppendResponse.parse(await post(`/cases/${caseId}/clients`, { event_id: eventId, profile, ...(byClient ? { by_client: true } : {}) }));
}

// Advice drafted by the suitability rules, never a model; the advice's id is this event_id.
export async function draftAdvice(caseId: string, eventId: string, clientId: string): Promise<AppendResponse> {
  return AppendResponse.parse(await post(`/cases/${caseId}/advice`, { event_id: eventId, client_id: clientId }));
}

// The adviser's sign-off. Nothing reaches a client without it.
// With its reason when it rejects, and what the adviser confirmed when it approves (#42).
export async function decideAdvice(
  caseId: string,
  adviceId: string,
  eventId: string,
  decision: AdviceDecision,
  extra: { reason?: RejectionReason; confirmations?: DecisionConfirmation[] } = {},
): Promise<AppendResponse> {
  return AppendResponse.parse(await post(`/cases/${caseId}/advice/${adviceId}/decision`, { event_id: eventId, decision, ...extra }));
}

// The depth a client chose, shared by them (#38). Called only once they have switched sharing on.
export async function recordReading(caseId: string, clientId: string, adviceId: string, depth: KnowledgeLevel): Promise<AppendResponse> {
  return AppendResponse.parse(await post(`/cases/${caseId}/clients/${clientId}/readings`, { event_id: crypto.randomUUID(), advice_id: adviceId, depth }));
}

// --- A client's list (#71, ADR-0008): one questionnaire for every verified product.

// The answers, given once: the server records them in every verified product's case and drafts each product's
// advice by the rules. event_id names the whole request, so a retry finishes it and appends nothing twice.
export async function recordClientList(eventId: string, profile: ClientProfile): Promise<ClientListResponse> {
  return ClientListResponse.parse(await post("/clients", { event_id: eventId, profile }));
}

// The cases that hold a client's answers. NotFound for a client nobody has recorded.
export async function fetchClientCases(clientId: string): Promise<string[]> {
  return ClientCasesResponse.parse(await get(`/clients/${encodeURIComponent(clientId)}`)).case_ids;
}

// The adviser's queue: every client with advice in play, oldest answers first.
export async function fetchClientQueue(): Promise<ClientQueueResponse["clients"]> {
  return ClientQueueResponse.parse(await get("/clients")).clients;
}

// The adviser's one decision on the client's whole list; pickCaseId marks one suitable product as their pick.
export async function decideClientList(
  clientId: string,
  eventId: string,
  decision: AdviceDecision,
  extra: { reason?: RejectionReason; confirmations?: DecisionConfirmation[]; pick_case_id?: string } = {},
): Promise<ClientListResponse> {
  return ClientListResponse.parse(await post(`/clients/${encodeURIComponent(clientId)}/decision`, { event_id: eventId, decision, ...extra }));
}
