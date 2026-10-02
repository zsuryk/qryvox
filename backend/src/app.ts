import { EVENT_TYPES } from "@qryvox/shared";
import { Hono } from "hono";

export const app = new Hono();

// Returns the shared event vocabulary so a deploy smoke check also proves @qryvox/shared resolved at runtime.
app.get("/health", (c) => c.json({ status: "ok", eventTypes: EVENT_TYPES }));
