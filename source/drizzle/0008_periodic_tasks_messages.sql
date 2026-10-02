CREATE TABLE `task_cycles` (
	`key` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`id` text NOT NULL,
	`plan_key` text NOT NULL,
	`plan_version` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`due_on` text NOT NULL,
	`reminder_on` text,
	`reminder_time` text,
	`reminder_status` text NOT NULL,
	`reminder_at_utc` text,
	`status` text DEFAULT 'open' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	`completed_by` text,
	`completed_by_name` text,
	`completion_notes` text,
	FOREIGN KEY (`plan_key`) REFERENCES `task_plans`(`key`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`completed_by`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "task_cycle_status" CHECK("task_cycles"."status" IN ('open','completed')),
	CONSTRAINT "task_cycle_snapshot" CHECK(json_valid("task_cycles"."snapshot_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_task_cycles_scope_id` ON `task_cycles` (`scope`,`id`);--> statement-breakpoint
CREATE INDEX `idx_task_cycles_due` ON `task_cycles` (`plan_key`,`due_on`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_task_cycles_one_open` ON `task_cycles` (`plan_key`) WHERE "task_cycles"."status"='open';--> statement-breakpoint
CREATE TABLE `task_messages` (
	`key` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`id` text NOT NULL,
	`cycle_key` text NOT NULL,
	`recipient_id` text NOT NULL,
	`occurrence` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`reminder_on` text,
	`reminder_time` text,
	`reminder_at_utc` text,
	`created_at` text NOT NULL,
	`read_at` text,
	FOREIGN KEY (`cycle_key`) REFERENCES `task_cycles`(`key`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipient_id`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_task_messages_scope_id` ON `task_messages` (`scope`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_task_message_occurrence` ON `task_messages` (`cycle_key`,`recipient_id`,`occurrence`);--> statement-breakpoint
CREATE INDEX `idx_task_messages_recipient` ON `task_messages` (`scope`,`recipient_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `task_plan_assignees` (
	`key` text PRIMARY KEY NOT NULL,
	`plan_key` text NOT NULL,
	`account_id` text NOT NULL,
	FOREIGN KEY (`plan_key`) REFERENCES `task_plans`(`key`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_task_plan_assignee` ON `task_plan_assignees` (`plan_key`,`account_id`);--> statement-breakpoint
CREATE TABLE `task_plan_batteries` (
	`key` text PRIMARY KEY NOT NULL,
	`plan_key` text NOT NULL,
	`battery_key` text NOT NULL,
	FOREIGN KEY (`plan_key`) REFERENCES `task_plans`(`key`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`battery_key`) REFERENCES `batteries`(`key`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_task_plan_battery` ON `task_plan_batteries` (`plan_key`,`battery_key`);--> statement-breakpoint
CREATE TABLE `task_plans` (
	`key` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`scope_note` text DEFAULT '' NOT NULL,
	`basis` text DEFAULT '' NOT NULL,
	`target_kind` text NOT NULL,
	`target_ref` text,
	`recurrence_basis` text NOT NULL,
	`first_due_on` text,
	`interval_count` integer NOT NULL,
	`interval_unit` text NOT NULL,
	`scheduled_dates_json` text NOT NULL,
	`reminder_days_before` integer NOT NULL,
	`reminder_time` text,
	`channels_json` text NOT NULL,
	`applicability_confirmed` integer DEFAULT 0 NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "task_plan_category" CHECK("task_plans"."category" IN ('storage_review','inventory_reconciliation','storage_maintenance')),
	CONSTRAINT "task_plan_target" CHECK("task_plans"."target_kind" IN ('inventory','storage_area','model','group','batteries')),
	CONSTRAINT "task_plan_recurrence" CHECK("task_plans"."recurrence_basis" IN ('calendar','completion','dates')),
	CONSTRAINT "task_plan_unit" CHECK("task_plans"."interval_unit" IN ('days','weeks','months','years')),
	CONSTRAINT "task_plan_interval" CHECK("task_plans"."interval_count" BETWEEN 1 AND 120),
	CONSTRAINT "task_plan_advance" CHECK("task_plans"."reminder_days_before" BETWEEN 0 AND 365),
	CONSTRAINT "task_plan_confirmed" CHECK("task_plans"."applicability_confirmed" IN (0,1)),
	CONSTRAINT "task_plan_state" CHECK("task_plans"."state" IN ('draft','active','paused')),
	CONSTRAINT "task_plan_dates_json" CHECK(json_valid("task_plans"."scheduled_dates_json")),
	CONSTRAINT "task_plan_channels_json" CHECK(json_valid("task_plans"."channels_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_task_plans_scope_id` ON `task_plans` (`scope`,`id`);
--> statement-breakpoint
CREATE TRIGGER task_plans_insert_identity BEFORE INSERT ON task_plans
BEGIN
    SELECT RAISE(ABORT, 'task plan identity invalid') WHERE NEW.key <> NEW.scope || '/' || NEW.id OR NEW.version <> 1;
    SELECT RAISE(ABORT, 'task plan replacement forbidden') WHERE EXISTS(SELECT 1 FROM task_plans WHERE key=NEW.key OR (scope=NEW.scope AND id=NEW.id));
END;
--> statement-breakpoint
CREATE TRIGGER task_plans_update_identity BEFORE UPDATE ON task_plans
BEGIN
    SELECT RAISE(ABORT, 'task plan identity is immutable') WHERE NEW.key IS NOT OLD.key OR NEW.scope IS NOT OLD.scope OR NEW.id IS NOT OLD.id OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by;
    SELECT RAISE(ABORT, 'task plan version must advance') WHERE NEW.version <> OLD.version + 1;
END;
--> statement-breakpoint
CREATE TRIGGER task_plans_no_delete BEFORE DELETE ON task_plans
BEGIN
    SELECT RAISE(ABORT, 'task plan history cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER task_plan_assignees_insert_identity BEFORE INSERT ON task_plan_assignees
BEGIN
    SELECT RAISE(ABORT, 'task assignee identity invalid') WHERE NEW.key <> NEW.plan_key || '/' || NEW.account_id;
    SELECT RAISE(ABORT, 'task assignee must be active') WHERE NOT EXISTS(SELECT 1 FROM staff_accounts WHERE id=NEW.account_id AND active=1);
    SELECT RAISE(ABORT, 'task assignee replacement forbidden') WHERE EXISTS(SELECT 1 FROM task_plan_assignees WHERE key=NEW.key OR (plan_key=NEW.plan_key AND account_id=NEW.account_id));
END;
--> statement-breakpoint
CREATE TRIGGER task_plan_assignees_no_update BEFORE UPDATE ON task_plan_assignees
BEGIN
    SELECT RAISE(ABORT, 'task assignment identity cannot be rewritten');
END;
--> statement-breakpoint
CREATE TRIGGER task_plan_batteries_insert_identity BEFORE INSERT ON task_plan_batteries
BEGIN
    SELECT RAISE(ABORT, 'task battery identity invalid') WHERE NOT EXISTS(SELECT 1 FROM task_plans p JOIN batteries b ON b.scope=p.scope WHERE p.key=NEW.plan_key AND b.key=NEW.battery_key AND NEW.key=p.key || '/' || b.id);
    SELECT RAISE(ABORT, 'task battery replacement forbidden') WHERE EXISTS(SELECT 1 FROM task_plan_batteries WHERE key=NEW.key OR (plan_key=NEW.plan_key AND battery_key=NEW.battery_key));
END;
--> statement-breakpoint
CREATE TRIGGER task_plan_batteries_no_update BEFORE UPDATE ON task_plan_batteries
BEGIN
    SELECT RAISE(ABORT, 'task target identity cannot be rewritten');
END;
--> statement-breakpoint
CREATE TRIGGER task_cycles_insert_identity BEFORE INSERT ON task_cycles
BEGIN
    SELECT RAISE(ABORT, 'task cycle identity invalid') WHERE NEW.key <> NEW.scope || '/' || NEW.id OR NEW.version <> 1 OR NEW.status <> 'open';
    SELECT RAISE(ABORT, 'task cycle inventory mismatch') WHERE NOT EXISTS(SELECT 1 FROM task_plans WHERE key=NEW.plan_key AND scope=NEW.scope AND version=NEW.plan_version AND state='active');
    SELECT RAISE(ABORT, 'task cycle completion must be explicit') WHERE NEW.completed_at IS NOT NULL OR NEW.completed_by IS NOT NULL OR NEW.completed_by_name IS NOT NULL OR NEW.completion_notes IS NOT NULL;
    SELECT RAISE(ABORT, 'task cycle reminder status invalid') WHERE NEW.reminder_status NOT IN ('scheduled','ambiguous','nonexistent','unconfigured');
    SELECT RAISE(ABORT, 'task cycle replacement forbidden') WHERE EXISTS(SELECT 1 FROM task_cycles WHERE key=NEW.key OR (scope=NEW.scope AND id=NEW.id));
END;
--> statement-breakpoint
CREATE TRIGGER task_cycles_update_history BEFORE UPDATE ON task_cycles
BEGIN
    SELECT RAISE(ABORT, 'completed task cycle is immutable') WHERE OLD.status='completed';
    SELECT RAISE(ABORT, 'task cycle snapshot is immutable') WHERE NEW.key IS NOT OLD.key OR NEW.scope IS NOT OLD.scope OR NEW.id IS NOT OLD.id OR NEW.plan_key IS NOT OLD.plan_key OR NEW.plan_version IS NOT OLD.plan_version OR NEW.snapshot_json IS NOT OLD.snapshot_json OR NEW.due_on IS NOT OLD.due_on OR NEW.created_at IS NOT OLD.created_at;
    SELECT RAISE(ABORT, 'task cycle version must advance') WHERE NEW.version <> OLD.version + 1;
    SELECT RAISE(ABORT, 'task cycle reminder status invalid') WHERE NEW.reminder_status NOT IN ('scheduled','ambiguous','nonexistent','unconfigured');
    SELECT RAISE(ABORT, 'task completion evidence required') WHERE NEW.status='completed' AND (NEW.completed_at IS NULL OR NEW.completed_by IS NULL OR NEW.completed_by_name IS NULL OR length(trim(NEW.completion_notes)) < 5 OR NEW.completion_notes IS NULL);
    SELECT RAISE(ABORT, 'open task cannot contain completion evidence') WHERE NEW.status='open' AND (NEW.completed_at IS NOT NULL OR NEW.completed_by IS NOT NULL OR NEW.completed_by_name IS NOT NULL OR NEW.completion_notes IS NOT NULL);
END;
--> statement-breakpoint
CREATE TRIGGER task_cycles_no_delete BEFORE DELETE ON task_cycles
BEGIN
    SELECT RAISE(ABORT, 'task cycle history cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER task_messages_insert_identity BEFORE INSERT ON task_messages
BEGIN
    SELECT RAISE(ABORT, 'task message identity invalid') WHERE NEW.key <> NEW.scope || '/' || NEW.id OR NEW.read_at IS NOT NULL;
    SELECT RAISE(ABORT, 'task message inventory mismatch') WHERE NOT EXISTS(SELECT 1 FROM task_cycles WHERE key=NEW.cycle_key AND scope=NEW.scope);
    SELECT RAISE(ABORT, 'task message recipient must be active') WHERE NOT EXISTS(SELECT 1 FROM staff_accounts WHERE id=NEW.recipient_id AND active=1);
    SELECT RAISE(ABORT, 'task message replacement forbidden') WHERE EXISTS(SELECT 1 FROM task_messages WHERE key=NEW.key OR (scope=NEW.scope AND id=NEW.id) OR (cycle_key=NEW.cycle_key AND recipient_id=NEW.recipient_id AND occurrence=NEW.occurrence));
END;
--> statement-breakpoint
CREATE TRIGGER task_messages_update_read_state BEFORE UPDATE ON task_messages
BEGIN
    SELECT RAISE(ABORT, 'task message evidence is immutable') WHERE NEW.key IS NOT OLD.key OR NEW.scope IS NOT OLD.scope OR NEW.id IS NOT OLD.id OR NEW.cycle_key IS NOT OLD.cycle_key OR NEW.recipient_id IS NOT OLD.recipient_id OR NEW.occurrence IS NOT OLD.occurrence OR NEW.title IS NOT OLD.title OR NEW.body IS NOT OLD.body OR NEW.reminder_on IS NOT OLD.reminder_on OR NEW.reminder_time IS NOT OLD.reminder_time OR NEW.reminder_at_utc IS NOT OLD.reminder_at_utc OR NEW.created_at IS NOT OLD.created_at;
    SELECT RAISE(ABORT, 'task message read state cannot be rewritten') WHERE OLD.read_at IS NOT NULL OR NEW.read_at IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER task_messages_no_delete BEFORE DELETE ON task_messages
BEGIN
    SELECT RAISE(ABORT, 'task message history cannot be deleted');
END;
