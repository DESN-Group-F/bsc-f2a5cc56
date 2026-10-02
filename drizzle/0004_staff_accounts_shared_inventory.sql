CREATE TABLE `shared_inventories` (
	`dataset` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	CONSTRAINT "shared_dataset" CHECK(dataset IN ('demo','live'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shared_inventories_scope_unique` ON `shared_inventories` (`scope`);--> statement-breakpoint
CREATE TABLE `sign_in_attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`failures` integer NOT NULL,
	`window_started_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `staff_account_events` (
	`id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_name` text NOT NULL,
	`target_id` text NOT NULL,
	`at` text NOT NULL,
	`details_json` text NOT NULL,
	`guard` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "account_event_guard" CHECK(guard = 1)
);
--> statement-breakpoint
CREATE TABLE `staff_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`role` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`auth_version` integer DEFAULT 1 NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`hash_iterations` integer NOT NULL,
	`default_dataset` text DEFAULT 'demo' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "account_role" CHECK(role IN ('admin','staff')),
	CONSTRAINT "account_active" CHECK(active IN (0,1)),
	CONSTRAINT "account_dataset" CHECK(default_dataset IN ('demo','live'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_accounts_username_unique` ON `staff_accounts` (`username`);--> statement-breakpoint
CREATE TABLE `staff_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`auth_version` integer NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_account` ON `staff_sessions` (`account_id`);--> statement-breakpoint
CREATE TRIGGER staff_account_identity BEFORE UPDATE OF id,username,created_at ON staff_accounts
BEGIN
 SELECT RAISE(ABORT,'Account identity is immutable') WHERE NEW.id<>OLD.id OR NEW.username<>OLD.username OR NEW.created_at<>OLD.created_at;
END;
--> statement-breakpoint
CREATE TRIGGER staff_account_last_admin BEFORE UPDATE OF active,role ON staff_accounts
BEGIN
 SELECT RAISE(ABORT,'Keep the last active administrator') WHERE OLD.role='admin' AND OLD.active=1 AND (NEW.role<>'admin' OR NEW.active<>1) AND (SELECT COUNT(*) FROM staff_accounts WHERE role='admin' AND active=1)<=1;
END;
--> statement-breakpoint
CREATE TRIGGER staff_account_no_delete BEFORE DELETE ON staff_accounts
BEGIN
 SELECT RAISE(ABORT,'Disable accounts instead of deleting history');
END;
--> statement-breakpoint
CREATE TRIGGER staff_account_no_replace BEFORE INSERT ON staff_accounts
BEGIN
 SELECT RAISE(ABORT,'UNIQUE account identity') WHERE EXISTS(SELECT 1 FROM staff_accounts WHERE id=NEW.id OR username=NEW.username);
END;
--> statement-breakpoint
CREATE TRIGGER staff_account_event_immutable_update BEFORE UPDATE ON staff_account_events
BEGIN
 SELECT RAISE(ABORT,'Account history is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER staff_account_event_immutable_delete BEFORE DELETE ON staff_account_events
BEGIN
 SELECT RAISE(ABORT,'Account history is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER staff_account_event_no_replace BEFORE INSERT ON staff_account_events
BEGIN
 SELECT RAISE(ABORT,'UNIQUE account history identity') WHERE EXISTS(SELECT 1 FROM staff_account_events WHERE id=NEW.id);
END;
