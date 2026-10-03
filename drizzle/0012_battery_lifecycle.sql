ALTER TABLE batteries ADD lifecycle_status text NOT NULL DEFAULT 'active' CONSTRAINT battery_lifecycle_status CHECK(lifecycle_status IN ('active','scrapped','permanently_removed'));
--> statement-breakpoint
ALTER TABLE batteries ADD lifecycle_at text;
--> statement-breakpoint
ALTER TABLE batteries ADD lifecycle_reason text;
--> statement-breakpoint
ALTER TABLE batteries ADD lifecycle_destination text;
--> statement-breakpoint
CREATE TRIGGER batteries_lifecycle_insert BEFORE INSERT ON batteries
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT: new batteries must start active') WHERE NEW.lifecycle_status<>'active' OR NEW.lifecycle_at IS NOT NULL OR NEW.lifecycle_reason IS NOT NULL OR NEW.lifecycle_destination IS NOT NULL;
END;
--> statement-breakpoint
CREATE TRIGGER batteries_lifecycle_update BEFORE UPDATE ON batteries
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT: terminal battery records are immutable') WHERE OLD.lifecycle_status<>'active';
    SELECT RAISE(ABORT, 'CONSTRAINT: active batteries cannot contain removal evidence') WHERE NEW.lifecycle_status='active' AND (NEW.lifecycle_at IS NOT NULL OR NEW.lifecycle_reason IS NOT NULL OR NEW.lifecycle_destination IS NOT NULL);
    SELECT RAISE(ABORT, 'CONSTRAINT: battery removal requires dated reasoned evidence') WHERE NEW.lifecycle_status<>'active' AND (NEW.lifecycle_at IS NULL OR NEW.lifecycle_reason IS NULL OR length(trim(NEW.lifecycle_reason))<1 OR length(NEW.lifecycle_reason)>1000 OR length(NEW.lifecycle_destination)>200 OR (NEW.lifecycle_status='scrapped' AND NEW.lifecycle_destination IS NOT NULL));
    SELECT RAISE(ABORT, 'CONSTRAINT: return the active loan before removing its battery') WHERE NEW.lifecycle_status<>'active' AND EXISTS(SELECT 1 FROM loans WHERE scope=OLD.scope AND battery_key=OLD.key AND returned_at IS NULL AND cancelled_at IS NULL);
    SELECT RAISE(ABORT, 'CONSTRAINT: removal cannot modify saved battery specifications or responsibility') WHERE NEW.lifecycle_status<>'active' AND (NEW.name IS NOT OLD.name OR NEW.chemistry IS NOT OLD.chemistry OR NEW.model IS NOT OLD.model OR NEW.capacity_mah IS NOT OLD.capacity_mah OR NEW.voltage IS NOT OLD.voltage OR NEW.tag_id IS NOT OLD.tag_id OR NEW.owner_key IS NOT OLD.owner_key OR NEW.home_building_key IS NOT OLD.home_building_key OR NEW.home_room_key IS NOT OLD.home_room_key OR NEW.manufactured_on IS NOT OLD.manufactured_on OR NEW.first_used_on IS NOT OLD.first_used_on OR NEW.created_at IS NOT OLD.created_at);
END;
--> statement-breakpoint
CREATE TRIGGER batteries_no_delete BEFORE DELETE ON batteries
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT: retain battery identity and history; record its lifecycle instead');
END;
--> statement-breakpoint
CREATE TRIGGER loans_active_battery_insert BEFORE INSERT ON loans
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT: loan requires an active battery') WHERE NOT EXISTS(SELECT 1 FROM batteries WHERE key=NEW.battery_key AND scope=NEW.scope AND lifecycle_status='active');
END;
--> statement-breakpoint
CREATE TRIGGER loans_active_battery_update BEFORE UPDATE ON loans
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT: terminal battery loan history cannot change') WHERE NOT EXISTS(SELECT 1 FROM batteries WHERE key=OLD.battery_key AND scope=OLD.scope AND lifecycle_status='active');
END;
--> statement-breakpoint
CREATE TRIGGER loans_terminal_history_no_delete BEFORE DELETE ON loans
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT: retain terminal battery loan history') WHERE EXISTS(SELECT 1 FROM batteries WHERE key=OLD.battery_key AND scope=OLD.scope AND lifecycle_status<>'active');
END;
--> statement-breakpoint
CREATE TRIGGER charges_active_battery_insert BEFORE INSERT ON charges
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT: charging requires an active battery') WHERE NOT EXISTS(SELECT 1 FROM batteries WHERE key=NEW.battery_key AND scope=NEW.scope AND lifecycle_status='active');
END;
--> statement-breakpoint
CREATE TRIGGER charges_active_battery_update BEFORE UPDATE ON charges
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT: terminal battery charging history cannot change') WHERE NOT EXISTS(SELECT 1 FROM batteries WHERE key=OLD.battery_key AND scope=OLD.scope AND lifecycle_status='active');
END;
--> statement-breakpoint
CREATE TRIGGER charges_terminal_history_no_delete BEFORE DELETE ON charges
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT: retain terminal battery charging history') WHERE EXISTS(SELECT 1 FROM batteries WHERE key=OLD.battery_key AND scope=OLD.scope AND lifecycle_status<>'active');
END;
--> statement-breakpoint
CREATE TRIGGER observations_active_battery_insert BEFORE INSERT ON observations
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT: new observations require an active battery') WHERE NOT EXISTS(SELECT 1 FROM batteries WHERE key=NEW.battery_key AND scope=NEW.scope AND lifecycle_status='active');
END;
--> statement-breakpoint
CREATE TRIGGER observations_terminal_history_no_delete BEFORE DELETE ON observations
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT: retain terminal battery observation history') WHERE EXISTS(SELECT 1 FROM batteries WHERE key=OLD.battery_key AND scope=OLD.scope AND lifecycle_status<>'active');
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_operations_no_replace BEFORE INSERT ON operations
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT: lifecycle request outcome cannot be replaced') WHERE EXISTS(SELECT 1 FROM operations WHERE id=NEW.id AND (kind IN ('battery_lifecycle','battery_lifecycle_rejected') OR NEW.kind IN ('battery_lifecycle','battery_lifecycle_rejected')));
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_operations_no_update BEFORE UPDATE ON operations
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT: lifecycle request outcome is immutable') WHERE OLD.kind IN ('battery_lifecycle','battery_lifecycle_rejected');
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_operations_no_delete BEFORE DELETE ON operations
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT: lifecycle request outcome cannot be deleted') WHERE OLD.kind IN ('battery_lifecycle','battery_lifecycle_rejected');
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_audit_no_replace BEFORE INSERT ON audit_events
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT: lifecycle audit cannot be replaced') WHERE EXISTS(SELECT 1 FROM audit_events WHERE id=NEW.id AND (action IN ('battery_scrapped','battery_permanently_removed') OR NEW.action IN ('battery_scrapped','battery_permanently_removed')));
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_audit_no_update BEFORE UPDATE ON audit_events
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT: lifecycle audit is immutable') WHERE OLD.action IN ('battery_scrapped','battery_permanently_removed');
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_audit_no_delete BEFORE DELETE ON audit_events
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT: lifecycle audit cannot be deleted') WHERE OLD.action IN ('battery_scrapped','battery_permanently_removed');
END;
