ALTER TABLE `rooms` ADD `is_placeholder` integer DEFAULT 0 NOT NULL CONSTRAINT room_placeholder_flag CHECK(is_placeholder IN (0,1));
--> statement-breakpoint
ALTER TABLE `rooms` ADD `selectable` integer DEFAULT 0 NOT NULL CONSTRAINT room_selectable_flag CHECK(selectable IN (0,1));
--> statement-breakpoint
-- Existing room identities and evidence are unchanged. New choices are J18 only.
CREATE TRIGGER rooms_availability_insert BEFORE INSERT ON rooms BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: selectable rooms must be in J18') WHERE NEW.selectable=1
    AND NOT EXISTS (SELECT 1 FROM buildings WHERE key=NEW.building_key AND scope=NEW.scope AND id='J18');
END;
--> statement-breakpoint
CREATE TRIGGER rooms_availability_update BEFORE UPDATE ON rooms BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: selectable rooms must be in J18') WHERE NEW.selectable=1
    AND NOT EXISTS (SELECT 1 FROM buildings WHERE key=NEW.building_key AND scope=NEW.scope AND id='J18');
END;
--> statement-breakpoint
DROP TRIGGER observations_integrity_insert;
--> statement-breakpoint
CREATE TRIGGER observations_integrity_insert BEFORE INSERT ON observations BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: observation references must belong to its inventory') WHERE NOT EXISTS (SELECT 1 FROM batteries WHERE key=NEW.battery_key AND scope=NEW.scope)
    OR NOT EXISTS (SELECT 1 FROM rooms WHERE key=NEW.room_key AND scope=NEW.scope);
  SELECT RAISE(ABORT, 'CONSTRAINT: observation requires location labels at receipt') WHERE NEW.room_name IS NULL OR NEW.room_building IS NULL
    OR NOT EXISTS (SELECT 1 FROM rooms r LEFT JOIN buildings b ON b.key=r.building_key WHERE r.key=NEW.room_key AND r.scope=NEW.scope
      AND (CASE WHEN r.is_placeholder=1 THEN r.name || ' — Placeholder' WHEN r.number IS NULL THEN r.name ELSE r.number || ' - ' || r.name END)=NEW.room_name
      AND COALESCE(b.id || ' - ' || b.name,r.building)=NEW.room_building);
END;
