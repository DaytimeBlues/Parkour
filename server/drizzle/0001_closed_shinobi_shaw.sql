CREATE TABLE `mp_rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`state_json` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`created_ms` integer NOT NULL,
	`expires_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mp_rooms_owner` ON `mp_rooms` (`owner_id`,`expires_ms`);--> statement-breakpoint
CREATE INDEX `mp_rooms_expiry` ON `mp_rooms` (`expires_ms`);