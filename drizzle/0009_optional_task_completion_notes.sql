DROP TRIGGER task_cycles_update_history;
--> statement-breakpoint
CREATE TRIGGER task_cycles_update_history BEFORE UPDATE ON task_cycles
BEGIN
    SELECT RAISE(ABORT, 'completed task cycle is immutable') WHERE OLD.status='completed';
    SELECT RAISE(ABORT, 'task cycle snapshot is immutable') WHERE NEW.key IS NOT OLD.key OR NEW.scope IS NOT OLD.scope OR NEW.id IS NOT OLD.id OR NEW.plan_key IS NOT OLD.plan_key OR NEW.plan_version IS NOT OLD.plan_version OR NEW.snapshot_json IS NOT OLD.snapshot_json OR NEW.due_on IS NOT OLD.due_on OR NEW.created_at IS NOT OLD.created_at;
    SELECT RAISE(ABORT, 'task cycle version must advance') WHERE NEW.version <> OLD.version + 1;
    SELECT RAISE(ABORT, 'task cycle reminder status invalid') WHERE NEW.reminder_status NOT IN ('scheduled','ambiguous','nonexistent','unconfigured');
    SELECT RAISE(ABORT, 'task completion evidence required') WHERE NEW.status='completed' AND (NEW.completed_at IS NULL OR NEW.completed_by IS NULL OR NEW.completed_by_name IS NULL);
    SELECT RAISE(ABORT, 'task completion notes exceed maximum length') WHERE NEW.completion_notes IS NOT NULL AND length(NEW.completion_notes) > 2000;
    SELECT RAISE(ABORT, 'open task cannot contain completion evidence') WHERE NEW.status='open' AND (NEW.completed_at IS NOT NULL OR NEW.completed_by IS NOT NULL OR NEW.completed_by_name IS NOT NULL OR NEW.completion_notes IS NOT NULL);
END;
