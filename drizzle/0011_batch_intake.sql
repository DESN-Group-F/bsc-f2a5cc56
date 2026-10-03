CREATE TABLE intake_counters (
    scope text PRIMARY KEY NOT NULL,
    last_number integer NOT NULL,
    CONSTRAINT intake_counter_range CHECK (last_number BETWEEN 1 AND 99999999)
);
--> statement-breakpoint
CREATE TRIGGER intake_counters_no_replace BEFORE INSERT ON intake_counters
BEGIN
    SELECT RAISE(ABORT, 'intake counter replacement forbidden') WHERE EXISTS(SELECT 1 FROM intake_counters WHERE scope=NEW.scope);
END;
--> statement-breakpoint
CREATE TRIGGER intake_counters_update_sequence BEFORE UPDATE ON intake_counters
BEGIN
    SELECT RAISE(ABORT, 'intake counter identity is immutable') WHERE NEW.scope IS NOT OLD.scope;
    SELECT RAISE(ABORT, 'intake counter must advance') WHERE NEW.last_number<=OLD.last_number;
END;
--> statement-breakpoint
CREATE TRIGGER intake_counters_no_delete BEFORE DELETE ON intake_counters
BEGIN
    SELECT RAISE(ABORT, 'intake counter cannot be deleted');
END;
--> statement-breakpoint
CREATE TABLE intake_sessions (
    key text PRIMARY KEY NOT NULL,
    scope text NOT NULL,
    id text NOT NULL,
    actor_id text NOT NULL REFERENCES staff_accounts(id),
    actor_name text NOT NULL,
    configuration_json text NOT NULL,
    context_json text NOT NULL,
    created_at text NOT NULL,
    CONSTRAINT intake_session_configuration_json CHECK (json_valid(configuration_json)),
    CONSTRAINT intake_session_context_json CHECK (json_valid(context_json))
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_intake_sessions_scope_id ON intake_sessions(scope,id);
--> statement-breakpoint
CREATE TRIGGER intake_sessions_insert_identity BEFORE INSERT ON intake_sessions
BEGIN
    SELECT RAISE(ABORT, 'intake session identity invalid') WHERE NEW.key<>NEW.scope || '/' || NEW.id;
    SELECT RAISE(ABORT, 'intake session author must be active staff') WHERE NOT EXISTS(SELECT 1 FROM staff_accounts WHERE id=NEW.actor_id AND active=1 AND role IN ('admin','staff'));
    SELECT RAISE(ABORT, 'intake session replacement forbidden') WHERE EXISTS(SELECT 1 FROM intake_sessions WHERE key=NEW.key OR (scope=NEW.scope AND id=NEW.id));
END;
--> statement-breakpoint
CREATE TRIGGER intake_sessions_no_update BEFORE UPDATE ON intake_sessions
BEGIN
    SELECT RAISE(ABORT, 'intake session configuration is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER intake_sessions_no_delete BEFORE DELETE ON intake_sessions
BEGIN
    SELECT RAISE(ABORT, 'intake session history cannot be deleted');
END;
