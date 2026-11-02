CREATE TABLE `mp_seats` (
	`id` text PRIMARY KEY NOT NULL,
	`room_code` text NOT NULL,
	`token_hash` text NOT NULL,
	`state_json` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`room_code`) REFERENCES `mp_rooms`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mp_seats_room_token` ON `mp_seats` (`room_code`,`token_hash`);--> statement-breakpoint
CREATE INDEX `mp_seats_room` ON `mp_seats` (`room_code`);