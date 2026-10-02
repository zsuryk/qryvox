-- Hand-written (ADR-0002): drizzle-kit cannot express triggers, and its SQLite table recreation
-- would silently drop them. assertAppendOnly() in src/db/append-only.ts checks they still exist.
CREATE TRIGGER `events_no_update` BEFORE UPDATE ON `events`
BEGIN
	SELECT RAISE(ABORT, 'events is append-only: UPDATE rejected');
END;
--> statement-breakpoint
CREATE TRIGGER `events_no_delete` BEFORE DELETE ON `events`
BEGIN
	SELECT RAISE(ABORT, 'events is append-only: DELETE rejected');
END;
