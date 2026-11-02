CREATE TABLE `lb_events` (
	`run_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`kind` text NOT NULL,
	`payload_hash` text NOT NULL,
	`accepted_ms` integer NOT NULL,
	`receipt_json` text,
	PRIMARY KEY(`run_id`, `sequence`),
	FOREIGN KEY (`run_id`) REFERENCES `lb_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "lb_events_seq" CHECK("lb_events"."sequence" BETWEEN 1 AND 256),
	CONSTRAINT "lb_events_kind" CHECK("lb_events"."kind" IN ('checkpoint','relay','fall','finish','abandon'))
);
--> statement-breakpoint
CREATE TABLE `lb_limits` (
	`bucket` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_ms` integer NOT NULL,
	CONSTRAINT "lb_limits_positive" CHECK("lb_limits"."count">0)
);
--> statement-breakpoint
CREATE INDEX `lb_limits_expiry` ON `lb_limits` (`expires_ms`);--> statement-breakpoint
CREATE TABLE `lb_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_hash` text,
	`alias` text NOT NULL,
	`course_id` text NOT NULL,
	`rules_version` text NOT NULL,
	`start_key` text NOT NULL,
	`started_ms` integer NOT NULL,
	`expires_ms` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_seq` integer DEFAULT 0 NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`falls` integer DEFAULT 0 NOT NULL,
	`last_event_ms` integer NOT NULL,
	`finished_ms` integer,
	`score_ms` integer,
	CONSTRAINT "lb_runs_status" CHECK("lb_runs"."status" IN ('active','finished','abandoned')),
	CONSTRAINT "lb_runs_seq" CHECK("lb_runs"."last_seq" BETWEEN 0 AND 256),
	CONSTRAINT "lb_runs_progress" CHECK("lb_runs"."progress" BETWEEN 0 AND 6),
	CONSTRAINT "lb_runs_falls" CHECK("lb_runs"."falls" BETWEEN 0 AND 256)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lb_runs_session_start` ON `lb_runs` (`session_hash`,`start_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `lb_runs_one_active` ON `lb_runs` (`session_hash`) WHERE "lb_runs"."status"='active';--> statement-breakpoint
CREATE INDEX `lb_runs_board` ON `lb_runs` (`course_id`,`rules_version`,`status`,`score_ms`,`finished_ms`,`id`);--> statement-breakpoint
CREATE INDEX `lb_runs_expiry` ON `lb_runs` (`expires_ms`);--> statement-breakpoint
CREATE INDEX `lb_runs_retention` ON `lb_runs` (`started_ms`);--> statement-breakpoint
CREATE TABLE `lb_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`alias` text NOT NULL,
	`created_ms` integer NOT NULL,
	`expires_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `lb_sessions_expiry` ON `lb_sessions` (`expires_ms`);