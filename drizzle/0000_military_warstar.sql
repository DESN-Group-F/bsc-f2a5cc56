CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`action` text NOT NULL,
	`battery_id` text,
	`actor_id` text NOT NULL,
	`actor_name` text NOT NULL,
	`at` text NOT NULL,
	`details_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_scope_time` ON `audit_events` (`scope`,`at`);--> statement-breakpoint
CREATE INDEX `idx_audit_scope_battery_time` ON `audit_events` (`scope`,`battery_id`,`at`);--> statement-breakpoint
CREATE TABLE `batteries` (
	`key` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`chemistry` text DEFAULT '' NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`capacity_mah` real,
	`voltage` real,
	`tag_id` text,
	`owner_key` text NOT NULL,
	`home_room_key` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`owner_key`) REFERENCES `people`(`key`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`home_room_key`) REFERENCES `rooms`(`key`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "positive_capacity" CHECK("batteries"."capacity_mah" IS NULL OR "batteries"."capacity_mah">0),
	CONSTRAINT "positive_voltage" CHECK("batteries"."voltage" IS NULL OR "batteries"."voltage">0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_batteries_scope_id` ON `batteries` (`scope`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_batteries_scope_tag` ON `batteries` (`scope`,`tag_id`);--> statement-breakpoint
CREATE TABLE `charges` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`battery_key` text NOT NULL,
	`completed_at` text NOT NULL,
	`percentage` real,
	`recorded_at` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_name` text NOT NULL,
	FOREIGN KEY (`battery_key`) REFERENCES `batteries`(`key`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "charge_percentage_range" CHECK("charges"."percentage" IS NULL OR ("charges"."percentage">=0 AND "charges"."percentage"<=100))
);
--> statement-breakpoint
CREATE INDEX `idx_charges_battery_time` ON `charges` (`battery_key`,`completed_at`,`recorded_at`);--> statement-breakpoint
CREATE TABLE `loans` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`battery_key` text NOT NULL,
	`borrower_key` text NOT NULL,
	`borrower_name` text NOT NULL,
	`checked_out_at` text NOT NULL,
	`returned_at` text,
	`cancelled_at` text,
	`checkout_actor_id` text NOT NULL,
	`checkout_actor_name` text NOT NULL,
	`return_actor_id` text,
	`return_actor_name` text,
	`correction_reason` text,
	FOREIGN KEY (`battery_key`) REFERENCES `batteries`(`key`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`borrower_key`) REFERENCES `people`(`key`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_loans_one_active` ON `loans` (`battery_key`) WHERE "loans"."returned_at" IS NULL AND "loans"."cancelled_at" IS NULL;--> statement-breakpoint
CREATE INDEX `idx_loans_scope_battery_time` ON `loans` (`scope`,`battery_key`,`checked_out_at`);--> statement-breakpoint
CREATE TABLE `observations` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`battery_key` text NOT NULL,
	`room_key` text NOT NULL,
	`observed_at` text NOT NULL,
	`received_at` text NOT NULL,
	`source` text NOT NULL,
	FOREIGN KEY (`battery_key`) REFERENCES `batteries`(`key`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`room_key`) REFERENCES `rooms`(`key`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_observations_battery_time` ON `observations` (`battery_key`,`observed_at`,`received_at`);--> statement-breakpoint
CREATE TABLE `operations` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`kind` text NOT NULL,
	`fingerprint` text NOT NULL,
	`result_json` text NOT NULL,
	`created_at` text NOT NULL,
	`guard` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "operation_guard" CHECK("operations"."guard"=1)
);
--> statement-breakpoint
CREATE TABLE `people` (
	`key` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`reference` text DEFAULT '' NOT NULL,
	`role` text NOT NULL,
	CONSTRAINT "people_role" CHECK("people"."role" IN ('staff','borrower'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_people_scope_id` ON `people` (`scope`,`id`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`key` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`building` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_rooms_scope_id` ON `rooms` (`scope`,`id`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`scope` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL
);
