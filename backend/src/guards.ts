import { createHmac } from "node:crypto";
import { and, count, eq, gte, min } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import type { Db } from "./db/client";
import { events } from "./db/schema";

// Spend protection for a public judge URL (ADR-0001): an origin allow-list, a hashed client IP, and a rate
// limit counted from the events table. The model provider's hard spend limit is the real backstop
// (docs/ops/model-spend.md).

export type RateLimits = {
  windowSeconds: number;
  // step.started events allowed per hashed IP across all cases, and per case, within the window.
  stepsPerIp: number;
  stepsPerCase: number;
};

export type Guards = {
  allowedOrigins: readonly string[];
  ipHashSecret: string;
  limits: RateLimits;
};

// A browser request from any other origin is refused outright, not merely left without CORS headers:
// otherwise the step would still run and spend tokens. Requests without an Origin (curl, server-side
// fetch) pass and meet the rate limit instead.
export function originAllowList(allowedOrigins: readonly string[]): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header("origin");
    if (origin !== undefined && !allowedOrigins.includes(origin)) {
      return c.json({ error: `origin ${origin} is not allowed` }, 403);
    }
    await next();
  };
}

// Vercel sets x-forwarded-for to the client address; locally the Node socket is the fallback.
export function clientIp(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  const real = c.req.header("x-real-ip")?.trim();
  if (real) return real;
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
  return incoming?.socket?.remoteAddress ?? "unknown";
}

// Events are immutable, so a raw IP written to one could never be deleted. Only this keyed HMAC is stored.
export function hashIp(secret: string, ip: string): string {
  return createHmac("sha256", secret).update(ip).digest("hex");
}

export class RateLimited extends Error {
  override name = "RateLimited";
  constructor(
    message: string,
    readonly retryAfterSeconds: number,
  ) {
    super(message);
  }
}

// Counts recent step.started events in the events table: serverless instances share no memory, so an
// in-process counter would reset with every cold start and never see the other instances.
export async function checkRateLimit(db: Db, caseId: string, ipHash: string, limits: RateLimits, now = new Date()) {
  const since = new Date(now.getTime() - limits.windowSeconds * 1000).toISOString();
  const recent = and(eq(events.type, "step.started"), gte(events.at, since));

  for (const [scope, where, limit] of [
    ["this client", and(recent, eq(events.ipHash, ipHash)), limits.stepsPerIp],
    ["this case", and(recent, eq(events.caseId, caseId)), limits.stepsPerCase],
  ] as const) {
    const [row] = await db.select({ n: count(), oldest: min(events.at) }).from(events).where(where);
    if ((row?.n ?? 0) >= limit) {
      // The window frees a slot when its oldest counted start ages out.
      const freesAt = new Date(row?.oldest ?? now.toISOString()).getTime() + limits.windowSeconds * 1000;
      const retryAfter = Math.max(1, Math.ceil((freesAt - now.getTime()) / 1000));
      throw new RateLimited(
        `rate limit: ${limit} analysis steps per ${limits.windowSeconds} s for ${scope}; retry in ${retryAfter} s`,
        retryAfter,
      );
    }
  }
}
