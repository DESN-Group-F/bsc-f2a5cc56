-- Apply this complete migration in one D1 transaction. Preserve every saved task and its child history.
PRAGMA defer_foreign_keys=ON;
--> statement-breakpoint
DROP TRIGGER task_plan_batteries_insert_identity;
--> statement-breakpoint
DROP TRIGGER task_cycles_insert_identity;
--> statement-breakpoint
DROP TRIGGER task_cycles_insert_current_plan;
--> statement-breakpoint
DROP TRIGGER task_cycles_update_current_plan;
--> statement-breakpoint
DROP TRIGGER task_messages_insert_current_state;
--> statement-breakpoint
CREATE TABLE `__new_task_plans` (
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
	`removed_at` text,
	FOREIGN KEY (`created_by`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "task_plan_category" CHECK("__new_task_plans"."category" IN ('storage_review','inventory_reconciliation','storage_maintenance','custom')),
	CONSTRAINT "task_plan_target" CHECK("__new_task_plans"."target_kind" IN ('inventory','storage_area','model','group','batteries')),
	CONSTRAINT "task_plan_recurrence" CHECK("__new_task_plans"."recurrence_basis" IN ('calendar','completion','dates')),
	CONSTRAINT "task_plan_unit" CHECK("__new_task_plans"."interval_unit" IN ('days','weeks','months','years')),
	CONSTRAINT "task_plan_interval" CHECK("__new_task_plans"."interval_count" BETWEEN 1 AND 120),
	CONSTRAINT "task_plan_advance" CHECK("__new_task_plans"."reminder_days_before" BETWEEN 0 AND 365),
	CONSTRAINT "task_plan_confirmed" CHECK("__new_task_plans"."applicability_confirmed" IN (0,1)),
	CONSTRAINT "task_plan_state" CHECK("__new_task_plans"."state" IN ('draft','active','paused')),
	CONSTRAINT "task_plan_dates_json" CHECK(json_valid("__new_task_plans"."scheduled_dates_json")),
	CONSTRAINT "task_plan_channels_json" CHECK(json_valid("__new_task_plans"."channels_json"))
);
--> statement-breakpoint
INSERT INTO __new_task_plans(key,scope,id,title,description,category,scope_note,basis,target_kind,target_ref,recurrence_basis,first_due_on,interval_count,interval_unit,scheduled_dates_json,reminder_days_before,reminder_time,channels_json,applicability_confirmed,state,version,created_at,updated_at,created_by,updated_by,removed_at) SELECT key,scope,id,title,description,category,scope_note,basis,target_kind,target_ref,recurrence_basis,first_due_on,interval_count,interval_unit,scheduled_dates_json,reminder_days_before,reminder_time,channels_json,applicability_confirmed,state,version,created_at,updated_at,created_by,updated_by,removed_at FROM task_plans ORDER BY rowid;
--> statement-breakpoint
DROP TABLE task_plans;
--> statement-breakpoint
ALTER TABLE __new_task_plans RENAME TO task_plans;
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
CREATE TRIGGER task_plans_insert_removal BEFORE INSERT ON task_plans
BEGIN
    SELECT RAISE(ABORT, 'new task plan cannot be removed') WHERE NEW.removed_at IS NOT NULL;
END;
--> statement-breakpoint
CREATE TRIGGER task_plan_batteries_insert_identity BEFORE INSERT ON task_plan_batteries
BEGIN
    SELECT RAISE(ABORT, 'task battery identity invalid') WHERE NOT EXISTS(SELECT 1 FROM task_plans p JOIN batteries b ON b.scope=p.scope WHERE p.key=NEW.plan_key AND b.key=NEW.battery_key AND NEW.key=p.key || '/' || b.id);
    SELECT RAISE(ABORT, 'task battery replacement forbidden') WHERE EXISTS(SELECT 1 FROM task_plan_batteries WHERE key=NEW.key OR (plan_key=NEW.plan_key AND battery_key=NEW.battery_key));
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
CREATE TRIGGER task_cycles_insert_current_plan BEFORE INSERT ON task_cycles
BEGIN
    SELECT RAISE(ABORT, 'removed task plan cannot generate cycles') WHERE EXISTS(SELECT 1 FROM task_plans WHERE key=NEW.plan_key AND removed_at IS NOT NULL);
END;
--> statement-breakpoint
CREATE TRIGGER task_cycles_update_current_plan BEFORE UPDATE ON task_cycles
BEGIN
    SELECT RAISE(ABORT, 'removed task plan cannot change cycles') WHERE EXISTS(SELECT 1 FROM task_plans WHERE key=OLD.plan_key AND removed_at IS NOT NULL);
END;
--> statement-breakpoint
CREATE TRIGGER task_messages_insert_current_state BEFORE INSERT ON task_messages
BEGIN
    SELECT RAISE(ABORT, 'new task message state invalid') WHERE NEW.removed_at IS NOT NULL OR NEW.version <> 1;
    SELECT RAISE(ABORT, 'removed task plan cannot generate messages') WHERE EXISTS(SELECT 1 FROM task_cycles c JOIN task_plans p ON p.key=c.plan_key WHERE c.key=NEW.cycle_key AND p.removed_at IS NOT NULL);
END;
--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;
