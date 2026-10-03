DROP TRIGGER batteries_lifecycle_update;
--> statement-breakpoint
CREATE TRIGGER batteries_lifecycle_update BEFORE UPDATE ON batteries
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT: terminal battery records are immutable') WHERE OLD.lifecycle_status<>'active';
    SELECT RAISE(ABORT, 'CONSTRAINT: active batteries cannot contain removal evidence') WHERE NEW.lifecycle_status='active' AND (NEW.lifecycle_at IS NOT NULL OR NEW.lifecycle_reason IS NOT NULL OR NEW.lifecycle_destination IS NOT NULL);
    SELECT RAISE(ABORT, 'CONSTRAINT: battery removal requires dated evidence and bounded optional details') WHERE NEW.lifecycle_status<>'active' AND (NEW.lifecycle_at IS NULL OR length(NEW.lifecycle_reason)>1000 OR length(NEW.lifecycle_destination)>200 OR (NEW.lifecycle_status='scrapped' AND NEW.lifecycle_destination IS NOT NULL));
    SELECT RAISE(ABORT, 'CONSTRAINT: return the active loan before removing its battery') WHERE NEW.lifecycle_status<>'active' AND EXISTS(SELECT 1 FROM loans WHERE scope=OLD.scope AND battery_key=OLD.key AND returned_at IS NULL AND cancelled_at IS NULL);
    SELECT RAISE(ABORT, 'CONSTRAINT: removal cannot modify saved battery specifications or responsibility') WHERE NEW.lifecycle_status<>'active' AND (NEW.name IS NOT OLD.name OR NEW.chemistry IS NOT OLD.chemistry OR NEW.model IS NOT OLD.model OR NEW.capacity_mah IS NOT OLD.capacity_mah OR NEW.voltage IS NOT OLD.voltage OR NEW.tag_id IS NOT OLD.tag_id OR NEW.owner_key IS NOT OLD.owner_key OR NEW.home_building_key IS NOT OLD.home_building_key OR NEW.home_room_key IS NOT OLD.home_room_key OR NEW.manufactured_on IS NOT OLD.manufactured_on OR NEW.first_used_on IS NOT OLD.first_used_on OR NEW.created_at IS NOT OLD.created_at);
END;
