CREATE TRIGGER csv_import_operations_no_replace BEFORE INSERT ON operations
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT: CSV import request outcome cannot be replaced') WHERE EXISTS(SELECT 1 FROM operations WHERE id=NEW.id AND (kind IN ('csv_import','csv_import_rejected') OR NEW.kind IN ('csv_import','csv_import_rejected')));
END;
--> statement-breakpoint
CREATE TRIGGER csv_import_operations_no_update BEFORE UPDATE ON operations
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT: CSV import request outcome is immutable') WHERE OLD.kind IN ('csv_import','csv_import_rejected') AND (NEW.fingerprint IS NOT OLD.fingerprint OR NOT EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 WHERE c.scope=OLD.scope AND c.kind='purge' AND a.role='admin'));
END;
--> statement-breakpoint
CREATE TRIGGER csv_import_operations_no_delete BEFORE DELETE ON operations
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT: CSV import request outcome cannot be deleted') WHERE OLD.kind IN ('csv_import','csv_import_rejected');
END;
--> statement-breakpoint
CREATE TRIGGER model_create_operations_no_replace BEFORE INSERT ON operations
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT: model create request outcome cannot be replaced') WHERE EXISTS(SELECT 1 FROM operations WHERE id=NEW.id AND (kind IN ('battery_model_registered','battery_model_registered_rejected') OR NEW.kind IN ('battery_model_registered','battery_model_registered_rejected')));
END;
--> statement-breakpoint
CREATE TRIGGER model_create_operations_no_update BEFORE UPDATE ON operations
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT: model create request outcome is immutable') WHERE OLD.kind IN ('battery_model_registered','battery_model_registered_rejected') AND (NEW.fingerprint IS NOT OLD.fingerprint OR NOT EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 WHERE c.scope=OLD.scope AND c.kind='purge' AND a.role='admin'));
END;
--> statement-breakpoint
CREATE TRIGGER model_create_operations_no_delete BEFORE DELETE ON operations
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT: model create request outcome cannot be deleted') WHERE OLD.kind IN ('battery_model_registered','battery_model_registered_rejected');
END;
