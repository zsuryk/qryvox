import {
  ANALYST_ACTOR,
  type AppendResponse,
  EVENT_PAGE_LIMIT,
  EVENT_TYPES,
  type EventPage,
  type EventPayloadResponse,
  IngestDocumentRequest,
  OpenCaseRequest,
  type OpenCaseResponse,
  RunStepRequest,
  SlimEvent,
} from "@qryvox/shared";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { assertAppendOnly } from "./db/append-only";
import type { Database } from "./db/client";
import { clientIp, type Guards, hashIp, originAllowList, RateLimited } from "./guards";
import type { Llm } from "./llm";
import { appendOnce, caseExists, EventIdConflict, getEvent, listEvents, toWire, verifyChain } from "./log";
import { LlmNotConfigured, runStep } from "./steps/run";
import { StepPrecondition } from "./steps/step";

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
    if (err instanceof EventIdConflict || err instanceof StepPrecondition) return c.json({ error: err.message }, 409);
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

  app.post("/cases/:caseId/steps", async (c) => {
    const caseId = c.req.param("caseId");
    const body = RunStepRequest.safeParse(await readJson(c));
    if (!body.success) return badRequest(c, body.error);
    if (!(await caseExists(db, caseId))) return notFound(c, caseId);

    const ipHash = hashIp(guards.ipHashSecret, clientIp(c));
    const outcome = await runStep(db, llm, caseId, body.data, { ipHash, limits: guards.limits });
    return c.json(outcome.body, outcome.status);
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
