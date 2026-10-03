CREATE TABLE battery_models (
    key text PRIMARY KEY NOT NULL,
    scope text NOT NULL,
    id text NOT NULL,
    identity_key text NOT NULL,
    brand text NOT NULL DEFAULT '',
    model text NOT NULL,
    variant text NOT NULL DEFAULT '',
    name text NOT NULL,
    chemistry text NOT NULL DEFAULT '',
    capacity_mah real,
    voltage real,
    notes text NOT NULL DEFAULT '',
    version integer NOT NULL DEFAULT 1,
    created_at text NOT NULL,
    created_by text NOT NULL REFERENCES staff_accounts(id),
    actor_name text NOT NULL,
    updated_at text NOT NULL,
    updated_by text NOT NULL REFERENCES staff_accounts(id),
    updated_actor_name text NOT NULL,
    CONSTRAINT battery_model_lengths CHECK (
        length(brand)<=80 AND length(model) BETWEEN 1 AND 120 AND
        length(variant)<=120 AND length(name) BETWEEN 2 AND 120 AND
        length(chemistry)<=40 AND length(notes)<=1000
    ),
    CONSTRAINT battery_model_capacity CHECK (capacity_mah IS NULL OR (capacity_mah>0 AND capacity_mah<=1000000)),
    CONSTRAINT battery_model_voltage CHECK (voltage IS NULL OR (voltage>0 AND voltage<=1000)),
    CONSTRAINT battery_model_version CHECK (version>0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_battery_models_scope_id ON battery_models(scope,id);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_battery_models_identity ON battery_models(scope,identity_key);
--> statement-breakpoint
CREATE TRIGGER battery_models_insert_identity BEFORE INSERT ON battery_models
BEGIN
    SELECT RAISE(ABORT, 'battery model identity invalid') WHERE NEW.key <> NEW.scope || '/' || NEW.id OR NEW.version<>1 OR NEW.updated_at IS NOT NEW.created_at OR NEW.updated_by IS NOT NEW.created_by OR NEW.updated_actor_name IS NOT NEW.actor_name;
    SELECT RAISE(ABORT, 'battery model author must be active staff') WHERE NOT EXISTS(SELECT 1 FROM staff_accounts WHERE id=NEW.created_by AND active=1 AND role IN ('admin','staff'));
    SELECT RAISE(ABORT, 'battery model replacement forbidden') WHERE EXISTS(SELECT 1 FROM battery_models WHERE key=NEW.key OR (scope=NEW.scope AND (id=NEW.id OR identity_key=NEW.identity_key)));
END;
--> statement-breakpoint
CREATE TRIGGER battery_models_update_identity BEFORE UPDATE ON battery_models
BEGIN
    SELECT RAISE(ABORT, 'battery model identity is immutable') WHERE NEW.key IS NOT OLD.key OR NEW.scope IS NOT OLD.scope OR NEW.id IS NOT OLD.id OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by OR NEW.actor_name IS NOT OLD.actor_name;
    SELECT RAISE(ABORT, 'battery model version must advance') WHERE NEW.version<>OLD.version+1;
    SELECT RAISE(ABORT, 'battery model editor must be an active administrator') WHERE NOT EXISTS(SELECT 1 FROM staff_accounts WHERE id=NEW.updated_by AND active=1 AND role='admin');
END;
--> statement-breakpoint
CREATE TRIGGER battery_models_no_delete BEFORE DELETE ON battery_models
BEGIN
    SELECT RAISE(ABORT, 'battery model history cannot be deleted');
END;
