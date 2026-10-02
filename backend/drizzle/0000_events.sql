CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`seq` integer NOT NULL,
	`event_id` text NOT NULL,
	`case_id` text NOT NULL,
	`type` text NOT NULL,
	`v` integer NOT NULL,
	`actor` text NOT NULL,
	`at` text NOT NULL,
	`step_run_id` text,
	`ip_hash` text,
	`payload` text NOT NULL,
	`hash` text NOT NULL,
	`prev_hash` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_event_id_unique` ON `events` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `events_case_seq_unique` ON `events` (`case_id`,`seq`);