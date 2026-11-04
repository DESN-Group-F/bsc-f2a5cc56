CREATE TRIGGER metadata_edit_operations_no_replace BEFORE INSERT ON operations
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT: metadata edit request outcome cannot be replaced') WHERE EXISTS(SELECT 1 FROM operations WHERE id=NEW.id AND (kind IN ('metadata_edit','metadata_edit_rejected') OR NEW.kind IN ('metadata_edit','metadata_edit_rejected')));
END;
--> statement-breakpoint
CREATE TRIGGER metadata_edit_operations_no_update BEFORE UPDATE ON operations
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT: metadata edit request outcome is immutable') WHERE OLD.kind IN ('metadata_edit','metadata_edit_rejected') AND (NEW.fingerprint IS NOT OLD.fingerprint OR NOT EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 WHERE c.scope=OLD.scope AND c.kind='purge' AND a.role='admin'));
END;
--> statement-breakpoint
CREATE TRIGGER metadata_edit_operations_no_delete BEFORE DELETE ON operations
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT: metadata edit request outcome cannot be deleted') WHERE OLD.kind IN ('metadata_edit','metadata_edit_rejected');
END;
