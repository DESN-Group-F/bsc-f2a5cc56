ALTER TABLE task_plans ADD COLUMN removed_at text;
--> statement-breakpoint
ALTER TABLE task_messages ADD COLUMN removed_at text;
--> statement-breakpoint
ALTER TABLE task_messages ADD COLUMN version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE INDEX idx_task_messages_current_recipient ON task_messages(scope,recipient_id,removed_at,created_at);
--> statement-breakpoint
CREATE TRIGGER task_plans_insert_removal BEFORE INSERT ON task_plans
BEGIN
    SELECT RAISE(ABORT, 'new task plan cannot be removed') WHERE NEW.removed_at IS NOT NULL;
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
DROP TRIGGER task_messages_update_read_state;
--> statement-breakpoint
CREATE TRIGGER task_messages_update_read_state BEFORE UPDATE ON task_messages
BEGIN
    SELECT RAISE(ABORT, 'task message evidence is immutable') WHERE NEW.key IS NOT OLD.key OR NEW.scope IS NOT OLD.scope OR NEW.id IS NOT OLD.id OR NEW.cycle_key IS NOT OLD.cycle_key OR NEW.recipient_id IS NOT OLD.recipient_id OR NEW.occurrence IS NOT OLD.occurrence OR NEW.title IS NOT OLD.title OR NEW.body IS NOT OLD.body OR NEW.reminder_on IS NOT OLD.reminder_on OR NEW.reminder_time IS NOT OLD.reminder_time OR NEW.reminder_at_utc IS NOT OLD.reminder_at_utc OR NEW.created_at IS NOT OLD.created_at;
    SELECT RAISE(ABORT, 'task message read state cannot be rewritten') WHERE OLD.read_at IS NOT NULL AND NEW.read_at IS NOT OLD.read_at;
    SELECT RAISE(ABORT, 'task message version must advance') WHERE NEW.version <> OLD.version + 1;
END;
