CREATE TABLE battery_inspections (
    id text PRIMARY KEY NOT NULL,
    scope text NOT NULL,
    battery_key text NOT NULL REFERENCES batteries(key),
    expected_battery_version integer NOT NULL,
    operation_id text NOT NULL UNIQUE REFERENCES operations(id),
    kind text NOT NULL CHECK (kind IN ('visual_check','functional_check','capacity_measurement','other')),
    outcome text NOT NULL CHECK (outcome IN ('no_concern_observed','concern_observed','inconclusive')),
    performed_at text NOT NULL,
    recorded_at text NOT NULL,
    inspector_account_id text NOT NULL REFERENCES staff_accounts(id),
    inspector_auth_version integer NOT NULL,
    inspector_name text NOT NULL,
    method text NOT NULL DEFAULT '',
    notes text NOT NULL DEFAULT '',
    reference text NOT NULL DEFAULT '',
    capacity_mah real,
    CONSTRAINT inspection_times CHECK (julianday(performed_at) IS NOT NULL AND julianday(recorded_at) IS NOT NULL AND julianday(performed_at)<=julianday(recorded_at)),
    CONSTRAINT inspection_text_lengths CHECK (length(method)<=1000 AND length(notes)<=2000 AND length(reference)<=1000 AND length(trim(inspector_name))>0),
    CONSTRAINT inspection_notes CHECK ((outcome<>'concern_observed' AND kind<>'other') OR length(trim(notes))>0),
    CONSTRAINT inspection_capacity CHECK ((kind='capacity_measurement' AND capacity_mah IS NOT NULL AND capacity_mah>0 AND capacity_mah<=1000000 AND length(trim(method))>0) OR (kind<>'capacity_measurement' AND capacity_mah IS NULL))
);
--> statement-breakpoint
CREATE INDEX idx_inspections_battery_time ON battery_inspections(scope,battery_key,performed_at,recorded_at);
--> statement-breakpoint
CREATE TRIGGER battery_inspections_insert_guard BEFORE INSERT ON battery_inspections
BEGIN
    SELECT RAISE(ABORT, 'inspection replacement forbidden') WHERE EXISTS(SELECT 1 FROM battery_inspections WHERE id=NEW.id OR operation_id=NEW.operation_id);
    SELECT RAISE(ABORT, 'inspection battery is stale or unavailable') WHERE NOT EXISTS(SELECT 1 FROM batteries WHERE key=NEW.battery_key AND scope=NEW.scope AND version=NEW.expected_battery_version AND lifecycle_status='active');
    SELECT RAISE(ABORT, 'inspection requires active native staff') WHERE NOT EXISTS(SELECT 1 FROM staff_accounts WHERE id=NEW.inspector_account_id AND auth_version=NEW.inspector_auth_version AND display_name=NEW.inspector_name AND active=1 AND role IN ('admin','staff'));
    SELECT RAISE(ABORT, 'inspection receipt mismatch') WHERE NOT EXISTS(SELECT 1 FROM operations o JOIN batteries b ON b.key=NEW.battery_key WHERE o.id=NEW.operation_id AND o.scope=NEW.scope AND o.kind='inspection' AND json_extract(o.result_json,'$.inspectionId')=NEW.id AND json_extract(o.result_json,'$.actorAccountId')=NEW.inspector_account_id AND json_extract(o.result_json,'$.batteryId')=b.id AND json_extract(o.result_json,'$.at')=NEW.recorded_at);
END;
--> statement-breakpoint
CREATE TRIGGER battery_inspections_no_update BEFORE UPDATE ON battery_inspections
BEGIN
    SELECT RAISE(ABORT, 'inspection evidence is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER battery_inspections_no_delete BEFORE DELETE ON battery_inspections
BEGIN
    SELECT RAISE(ABORT, 'inspection evidence cannot be deleted');
END;
--> statement-breakpoint
CREATE TABLE battery_inspection_voids (
    id text PRIMARY KEY NOT NULL,
    scope text NOT NULL,
    inspection_id text NOT NULL UNIQUE REFERENCES battery_inspections(id),
    operation_id text NOT NULL UNIQUE REFERENCES operations(id),
    voided_at text NOT NULL CHECK (julianday(voided_at) IS NOT NULL),
    actor_account_id text NOT NULL REFERENCES staff_accounts(id),
    actor_auth_version integer NOT NULL,
    actor_name text NOT NULL,
    reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 5 AND 1000)
);
--> statement-breakpoint
CREATE INDEX idx_inspection_voids_scope ON battery_inspection_voids(scope,inspection_id);
--> statement-breakpoint
CREATE TRIGGER battery_inspection_voids_insert_guard BEFORE INSERT ON battery_inspection_voids
BEGIN
    SELECT RAISE(ABORT, 'inspection correction replacement forbidden') WHERE EXISTS(SELECT 1 FROM battery_inspection_voids WHERE id=NEW.id OR inspection_id=NEW.inspection_id OR operation_id=NEW.operation_id);
    SELECT RAISE(ABORT, 'inspection correction scope or time mismatch') WHERE NOT EXISTS(SELECT 1 FROM battery_inspections WHERE id=NEW.inspection_id AND scope=NEW.scope AND julianday(recorded_at)<=julianday(NEW.voided_at));
    SELECT RAISE(ABORT, 'inspection correction requires active administrator') WHERE NOT EXISTS(SELECT 1 FROM staff_accounts WHERE id=NEW.actor_account_id AND auth_version=NEW.actor_auth_version AND display_name=NEW.actor_name AND active=1 AND role='admin');
    SELECT RAISE(ABORT, 'inspection correction receipt mismatch') WHERE NOT EXISTS(SELECT 1 FROM operations o JOIN battery_inspections i ON i.id=NEW.inspection_id JOIN batteries b ON b.key=i.battery_key WHERE o.id=NEW.operation_id AND o.scope=NEW.scope AND o.kind='inspection_void' AND json_extract(o.result_json,'$.inspectionId')=NEW.inspection_id AND json_extract(o.result_json,'$.actorAccountId')=NEW.actor_account_id AND json_extract(o.result_json,'$.batteryId')=b.id AND json_extract(o.result_json,'$.at')=NEW.voided_at);
END;
--> statement-breakpoint
CREATE TRIGGER battery_inspection_voids_no_update BEFORE UPDATE ON battery_inspection_voids
BEGIN
    SELECT RAISE(ABORT, 'inspection correction evidence is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER battery_inspection_voids_no_delete BEFORE DELETE ON battery_inspection_voids
BEGIN
    SELECT RAISE(ABORT, 'inspection correction evidence cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER inspection_operations_no_replace BEFORE INSERT ON operations
BEGIN
    SELECT RAISE(ABORT, 'inspection receipt replacement forbidden') WHERE EXISTS(SELECT 1 FROM operations WHERE id=NEW.id AND (kind IN ('inspection','inspection_void','inspection_rejected','inspection_void_rejected') OR NEW.kind IN ('inspection','inspection_void','inspection_rejected','inspection_void_rejected')));
END;
--> statement-breakpoint
CREATE TRIGGER inspection_operations_no_update BEFORE UPDATE ON operations
BEGIN
    SELECT RAISE(ABORT, 'inspection receipt is immutable') WHERE OLD.kind IN ('inspection','inspection_void','inspection_rejected','inspection_void_rejected') OR NEW.kind IN ('inspection','inspection_void','inspection_rejected','inspection_void_rejected');
END;
--> statement-breakpoint
CREATE TRIGGER inspection_operations_no_delete BEFORE DELETE ON operations
BEGIN
    SELECT RAISE(ABORT, 'inspection receipt cannot be deleted') WHERE OLD.kind IN ('inspection','inspection_void','inspection_rejected','inspection_void_rejected');
END;
--> statement-breakpoint
CREATE TRIGGER inspection_audit_no_replace BEFORE INSERT ON audit_events
BEGIN
    SELECT RAISE(ABORT, 'inspection audit replacement forbidden') WHERE EXISTS(SELECT 1 FROM audit_events WHERE id=NEW.id AND (action IN ('inspection_recorded','inspection_voided') OR NEW.action IN ('inspection_recorded','inspection_voided')));
END;
--> statement-breakpoint
CREATE TRIGGER inspection_audit_no_update BEFORE UPDATE ON audit_events
BEGIN
    SELECT RAISE(ABORT, 'inspection audit is immutable') WHERE OLD.action IN ('inspection_recorded','inspection_voided') OR NEW.action IN ('inspection_recorded','inspection_voided');
END;
--> statement-breakpoint
CREATE TRIGGER inspection_audit_no_delete BEFORE DELETE ON audit_events
BEGIN
    SELECT RAISE(ABORT, 'inspection audit cannot be deleted') WHERE OLD.action IN ('inspection_recorded','inspection_voided');
END;
