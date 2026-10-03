import {
  ANALYST_ACTOR,
  type AppendResponse,
  ChangeDispositionRequest,
  DecideAdviceRequest,
  DraftAdviceRequest,
  EVENT_PAGE_LIMIT,
  EVENT_TYPES,
  type EventPage,
  type EventPayloadResponse,
  IngestDocumentRequest,
  OpenCaseRequest,
  type OpenCaseResponse,
  RecordProfileRequest,
  RecordReadingRequest,
  RunStepRequest,
  SlimEvent,
} from "@qryvox/shared";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { AdviceConflict, AdviceNotFound, decideAdvice, draftAdvice, recordProfile } from "./advice.js";
import { assertAppendOnly } from "./db/append-only.js";
import type { Database } from "./db/client.js";
import { clientIp, type Guards, hashIp, judgeLink, originAllowList, RateLimited } from "./guards.js";
import type { Llm } from "./llm.js";
import {
  appendOnce,
  caseExists,
  EventIdConflict,
  findByEventId,
  findingStatus,
  foldCase,
  getEvent,
  listEvents,
  toWire,
  verifyChain,
} from "./log.js";
import { LlmNotConfigured, runStep } from "./steps/run.js";
import { StepPrecondition } from "./steps/step.js";

export type AppOptions = Database & {
  // null when no model is configured: everything but running a new step still works.
  llm: Llm | null;
  guards: Guards;
};

const PageQuery = z.object({
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(EVENT_PAGE_LIMIT).default(EVENT_PAGE_LIMIT),
});
const SeqParam = z.coerce.number().int().positive();

export function createApp({ client, db, llm, guards }: AppOptions) {
  const app = new Hono();

  // Checked once per process, before the first request touches the log; a missing trigger fails every request loudly.
  let appendOnly: Promise<void> | undefined;
  app.use(async (_c, next) => {
    appendOnly ??= assertAppendOnly(client);
    await appendOnly;
    await next();
  });

  app.use(originAllowList(guards.allowedOrigins));
  app.use(cors({ origin: [...guards.allowedOrigins] }));

  app.onError((err, c) => {
    if (err instanceof EventIdConflict || err instanceof StepPrecondition || err instanceof AdviceConflict) {
      return c.json({ error: err.message }, 409);
    }
    if (err instanceof AdviceNotFound) return c.json({ error: err.message }, 404);
    if (err instanceof LlmNotConfigured) return c.json({ error: err.message }, 503);
    if (err instanceof RateLimited) {
      c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json({ error: err.message }, 429);
    }
    console.error(err);
    return c.json({ error: err.message }, 500);
  });

  // Returns the shared event vocabulary so a deploy smoke check also proves @qryvox/shared resolved at runtime.
  app.get("/health", (c) => c.json({ status: "ok", eventTypes: EVENT_TYPES }));

  // The root says what this is and nothing more (#47): an API, with its health check. Without a route here a
  // misconfigured host can answer / with a static file instead of the app.
  app.get("/", (c) => c.json({ service: "qryvox-api", health: "/health" }));

  app.post("/cases", async (c) => {
    const body = OpenCaseRequest.safeParse(await readJson(c));
    if (!body.success) return badRequest(c, body.error);

    // The case is named after the event that opens it, so a retried open lands on the same case.
    const caseId = body.data.event_id;
    const row = await appendOnce(db, caseId, {
      eventId: body.data.event_id,
      type: "case.opened",
      v: 1,
      actor: ANALYST_ACTOR,
      payload: {},
    });
    return c.json({ case_id: row.caseId, seq: row.seq } satisfies OpenCaseResponse, 201);
  });

  app.post("/cases/:caseId/documents", async (c) => {
    const caseId = c.req.param("caseId");
    const body = IngestDocumentRequest.safeParse(await readJson(c));
    if (!body.success) return badRequest(c, body.error);
    const { document } = body.data;
    if (document.pages.length !== document.page_count) {
      return c.json({ error: `page_count is ${document.page_count} but ${document.pages.length} pages were sent` }, 400);
    }
    if (!(await caseExists(db, caseId))) return notFound(c, caseId);

    const row = await appendOnce(db, caseId, {
      eventId: body.data.event_id,
      type: "document.ingested",
      v: 1,
      actor: ANALYST_ACTOR,
      payload: document,
    });
    return c.json({ seq: row.seq } satisfies AppendResponse, 201);
  });

  app.post("/cases/:caseId/steps", judgeLink(guards.judgeToken), async (c) => {
    const caseId = c.req.param("caseId");
    const body = RunStepRequest.safeParse(await readJson(c));
    if (!body.success) return badRequest(c, body.error);
    if (!(await caseExists(db, caseId))) return notFound(c, caseId);

    const ipHash = hashIp(guards.ipHashSecret, clientIp(c));
    const outcome = await runStep(db, llm, caseId, body.data, { ipHash, limits: guards.limits });
    return c.json(outcome.body, outcome.status);
  });

  // The analyst's explicit decision on one finding (spec decision 34). Only a human appends this: no step
  // ever approves or dismisses. Deciding again replaces the decision on the board; the log keeps both.
  app.post("/cases/:caseId/dispositions", async (c) => {
    const caseId = c.req.param("caseId");
    const body = ChangeDispositionRequest.safeParse(await readJson(c));
    if (!body.success) return badRequest(c, body.error);
    if (!(await caseExists(db, caseId))) return notFound(c, caseId);
    const { event_id, finding_id, disposition } = body.data;

    // A retry of a decision already recorded returns it, even if the finding has been superseded since.
    if (!(await findByEventId(db, event_id))) {
      const status = await findingStatus(db, caseId, finding_id);
      if (status === null) return c.json({ error: `finding ${finding_id} not found in case ${caseId}` }, 404);
      if (status === "superseded") {
        return c.json({ error: `finding ${finding_id} was superseded by a later findings run and is off the board` }, 409);
      }
    }

    const row = await appendOnce(db, caseId, {
      eventId: event_id,
      type: "disposition.changed",
      v: 1,
      actor: ANALYST_ACTOR,
      payload: { finding_id, disposition },
    });
    return c.json({ seq: row.seq } satisfies AppendResponse, 201);
  });

  // The client layer (#31). No model is called and nothing spends tokens, so no judge-link token either.
  // A new profile version supersedes the client's advice in play, in the same transaction.
  app.post("/cases/:caseId/clients", async (c) => {
    const caseId = c.req.param("caseId");
    const body = RecordProfileRequest.safeParse(await readJson(c));
    if (!body.success) return badRequest(c, body.error);
    if (!(await caseExists(db, caseId))) return notFound(c, caseId);

    const row = await recordProfile(db, caseId, body.data.event_id, body.data.profile, body.data.by_client ?? false);
    return c.json({ seq: row.seq } satisfies AppendResponse, 201);
  });

  // The depth a client chose to read at, shared by them from their own page (#38). It informs a suggestion
  // to the adviser and changes nothing itself.
  app.post("/cases/:caseId/clients/:clientId/readings", async (c) => {
    const caseId = c.req.param("caseId");
    const clientId = c.req.param("clientId");
    const body = RecordReadingRequest.safeParse(await readJson(c));
    if (!body.success) return badRequest(c, body.error);
    if (!(await caseExists(db, caseId))) return notFound(c, caseId);
    const state = await foldCase(db, caseId);
    if (!state.clients.some((client) => client.clientId === clientId)) {
      return c.json({ error: `client ${clientId} not found in case ${caseId}` }, 404);
    }
    const row = await appendOnce(db, caseId, {
      eventId: body.data.event_id,
      type: "client.read",
      v: 1,
      actor: clientId,
      payload: { client_id: clientId, advice_id: body.data.advice_id, depth: body.data.depth },
    });
    return c.json({ seq: row.seq } satisfies AppendResponse, 201);
  });

  // Drafts advice by the suitability rules: 409 until the pack is verified and its attributes are read.
  // The advice's id is the request's event_id.
  app.post("/cases/:caseId/advice", async (c) => {
    const caseId = c.req.param("caseId");
    const body = DraftAdviceRequest.safeParse(await readJson(c));
    if (!body.success) return badRequest(c, body.error);
    if (!(await caseExists(db, caseId))) return notFound(c, caseId);

    const row = await draftAdvice(db, caseId, body.data.event_id, body.data.client_id);
    return c.json({ seq: row.seq } satisfies AppendResponse, 201);
  });

  // The adviser approves or rejects. Only a person decides; nothing approves itself.
  app.post("/cases/:caseId/advice/:adviceId/decision", async (c) => {
    const caseId = c.req.param("caseId");
    const body = DecideAdviceRequest.safeParse(await readJson(c));
    if (!body.success) return badRequest(c, body.error);
    // A rejection says why (#42), in a reason chosen from the list.
    if (body.data.decision === "rejected" && !body.data.reason) {
      return c.json({ error: "a rejection needs its reason: choose why the draft is rejected" }, 400);
    }
    if (!(await caseExists(db, caseId))) return notFound(c, caseId);

    const row = await decideAdvice(db, caseId, c.req.param("adviceId"), body.data);
    return c.json({ seq: row.seq } satisfies AppendResponse, 201);
  });

  app.get("/cases/:caseId/events", async (c) => {
    const caseId = c.req.param("caseId");
    const query = PageQuery.safeParse(c.req.query());
    if (!query.success) return badRequest(c, query.error);
    if (!(await caseExists(db, caseId))) return notFound(c, caseId);

    const { after, limit } = query.data;
    const rows = await listEvents(db, caseId, after, limit + 1);
    const page: EventPage = {
      // Parsing against the slim schema strips heavy fields (extracted text, raw model output).
      events: rows.slice(0, limit).map((row) => SlimEvent.parse(toWire(row))),
      has_more: rows.length > limit,
    };
    return c.json(page);
  });

  app.get("/cases/:caseId/events/:seq/payload", async (c) => {
    const caseId = c.req.param("caseId");
    const seq = SeqParam.safeParse(c.req.param("seq"));
    if (!seq.success) return badRequest(c, seq.error);

    const row = await getEvent(db, caseId, seq.data);
    if (!row) return c.json({ error: `no event ${seq.data} in case ${caseId}` }, 404);
    return c.json({ seq: row.seq, payload: row.payload } satisfies EventPayloadResponse);
  });

  app.get("/cases/:caseId/verify", async (c) => {
    const caseId = c.req.param("caseId");
    if (!(await caseExists(db, caseId))) return notFound(c, caseId);
    return c.json(await verifyChain(db, caseId));
  });

  return app;
}

async function readJson(c: Context): Promise<unknown> {
  return c.req.json().catch(() => undefined);
}

function badRequest(c: Context, error: z.ZodError) {
  return c.json({ error: z.prettifyError(error) }, 400);
}

function notFound(c: Context, caseId: string) {
  return c.json({ error: `case ${caseId} not found` }, 404);
}
