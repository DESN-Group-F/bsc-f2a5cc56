-- Apply this complete migration in one D1 transaction. Existing child histories use NO ACTION.
PRAGMA defer_foreign_keys=ON;
--> statement-breakpoint
CREATE TABLE `buildings` (
	`key` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_buildings_scope_id ON buildings(scope,id);
--> statement-breakpoint
ALTER TABLE rooms ADD building_key text REFERENCES buildings(key);
--> statement-breakpoint
ALTER TABLE rooms ADD number text;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_rooms_building_number ON rooms(scope,building_key,number);
--> statement-breakpoint
ALTER TABLE charges ADD duration_minutes real CONSTRAINT charge_duration_range CHECK(duration_minutes IS NULL OR (duration_minutes>0 AND duration_minutes<=525600));
--> statement-breakpoint
DROP TRIGGER people_integrity_update;
--> statement-breakpoint
DROP TRIGGER loans_integrity_insert;
--> statement-breakpoint
DROP TRIGGER loans_integrity_update;
--> statement-breakpoint
DROP TRIGGER observations_integrity_insert;
--> statement-breakpoint
DROP TRIGGER charges_integrity_insert;
--> statement-breakpoint
DROP TRIGGER charges_integrity_update;
--> statement-breakpoint
DROP TRIGGER rooms_integrity_insert;
--> statement-breakpoint
DROP TRIGGER rooms_integrity_update;
--> statement-breakpoint
CREATE TABLE `__new_batteries` (
	`key` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`chemistry` text DEFAULT '' NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`capacity_mah` real,
	`voltage` real,
	`tag_id` text,
	`owner_key` text NOT NULL,
	`home_building_key` text,
	`home_room_key` text,
	`created_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`owner_key`) REFERENCES `people`(`key`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`home_building_key`) REFERENCES `buildings`(`key`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`home_room_key`) REFERENCES `rooms`(`key`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "battery_storage_required" CHECK("__new_batteries"."home_building_key" IS NOT NULL OR "__new_batteries"."home_room_key" IS NOT NULL),
	CONSTRAINT "positive_capacity" CHECK("__new_batteries"."capacity_mah" IS NULL OR "__new_batteries"."capacity_mah">0),
	CONSTRAINT "positive_voltage" CHECK("__new_batteries"."voltage" IS NULL OR "__new_batteries"."voltage">0)
);
--> statement-breakpoint
INSERT INTO __new_batteries(key,scope,id,name,chemistry,model,capacity_mah,voltage,tag_id,owner_key,home_building_key,home_room_key,created_at,version) SELECT key,scope,id,name,chemistry,model,capacity_mah,voltage,tag_id,owner_key,NULL,home_room_key,created_at,version FROM batteries;
--> statement-breakpoint
DROP TABLE batteries;
--> statement-breakpoint
ALTER TABLE __new_batteries RENAME TO batteries;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_batteries_scope_id ON batteries(scope,id);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_batteries_scope_tag ON batteries(scope,tag_id);
--> statement-breakpoint
CREATE TRIGGER people_integrity_update BEFORE UPDATE ON people BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: person identity is immutable and version must advance') WHERE NEW.key IS NOT OLD.key OR NEW.scope IS NOT OLD.scope OR NEW.id IS NOT OLD.id
    OR typeof(NEW.version) != 'integer' OR NEW.version != OLD.version + 1;
  SELECT RAISE(ABORT, 'CONSTRAINT: reassign owned batteries before changing staff role') WHERE NEW.role != 'staff' AND EXISTS (SELECT 1 FROM batteries WHERE owner_key=OLD.key);
END;
--> statement-breakpoint
CREATE TRIGGER buildings_integrity_insert BEFORE INSERT ON buildings BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: invalid building identity or version') WHERE NEW.key IS NOT (NEW.scope || '/' || NEW.id) OR typeof(NEW.version) != 'integer' OR NEW.version < 1;
END;
--> statement-breakpoint
CREATE TRIGGER rooms_integrity_insert BEFORE INSERT ON rooms BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: invalid room identity or version') WHERE NEW.key IS NOT (NEW.scope || '/' || NEW.id) OR typeof(NEW.version) != 'integer' OR NEW.version < 1;
  SELECT RAISE(ABORT, 'CONSTRAINT: room requires a building and number together') WHERE (NEW.building_key IS NULL) != (NEW.number IS NULL)
    OR (NEW.number IS NOT NULL AND (length(trim(NEW.number))=0 OR length(NEW.number)>40))
    OR (NEW.building_key IS NOT NULL AND NOT EXISTS (SELECT 1 FROM buildings WHERE key=NEW.building_key AND scope=NEW.scope));
  SELECT RAISE(ABORT, 'CONSTRAINT: reassign batteries before moving their room to another building') WHERE EXISTS (SELECT 1 FROM batteries WHERE home_room_key=NEW.key AND home_building_key IS NOT NULL AND home_building_key IS NOT NEW.building_key);
END;
--> statement-breakpoint
CREATE TRIGGER batteries_integrity_insert BEFORE INSERT ON batteries BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: invalid battery identity or version') WHERE NEW.key IS NOT (NEW.scope || '/' || NEW.id) OR typeof(NEW.version) != 'integer' OR NEW.version < 1;
  SELECT RAISE(ABORT, 'CONSTRAINT: battery requires a staff owner in its inventory') WHERE NOT EXISTS (SELECT 1 FROM people WHERE key=NEW.owner_key AND scope=NEW.scope AND role='staff');
  SELECT RAISE(ABORT, 'CONSTRAINT: battery building must belong to its inventory') WHERE NEW.home_building_key IS NOT NULL AND NOT EXISTS (SELECT 1 FROM buildings WHERE key=NEW.home_building_key AND scope=NEW.scope);
  SELECT RAISE(ABORT, 'CONSTRAINT: battery room must belong to its selected building and inventory') WHERE NEW.home_room_key IS NOT NULL AND NOT EXISTS (SELECT 1 FROM rooms WHERE key=NEW.home_room_key AND scope=NEW.scope AND building_key IS NEW.home_building_key);
END;
--> statement-breakpoint
CREATE TRIGGER buildings_integrity_update BEFORE UPDATE ON buildings BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: invalid building identity or version') WHERE NEW.key IS NOT OLD.key OR NEW.scope IS NOT OLD.scope OR NEW.id IS NOT OLD.id OR typeof(NEW.version) != 'integer' OR NEW.version != OLD.version + 1;
END;
--> statement-breakpoint
CREATE TRIGGER rooms_integrity_update BEFORE UPDATE ON rooms BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: invalid room identity or version') WHERE NEW.key IS NOT OLD.key OR NEW.scope IS NOT OLD.scope OR NEW.id IS NOT OLD.id OR typeof(NEW.version) != 'integer' OR NEW.version != OLD.version + 1;
  SELECT RAISE(ABORT, 'CONSTRAINT: room requires a building and number together') WHERE (NEW.building_key IS NULL) != (NEW.number IS NULL)
    OR (NEW.number IS NOT NULL AND (length(trim(NEW.number))=0 OR length(NEW.number)>40))
    OR (NEW.building_key IS NOT NULL AND NOT EXISTS (SELECT 1 FROM buildings WHERE key=NEW.building_key AND scope=NEW.scope));
  SELECT RAISE(ABORT, 'CONSTRAINT: reassign batteries before moving their room to another building') WHERE EXISTS (SELECT 1 FROM batteries WHERE home_room_key=NEW.key AND home_building_key IS NOT NULL AND home_building_key IS NOT NEW.building_key);
END;
--> statement-breakpoint
CREATE TRIGGER batteries_integrity_update BEFORE UPDATE ON batteries BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: invalid battery identity or version') WHERE NEW.key IS NOT OLD.key OR NEW.scope IS NOT OLD.scope OR NEW.id IS NOT OLD.id OR typeof(NEW.version) != 'integer' OR NEW.version != OLD.version + 1;
  SELECT RAISE(ABORT, 'CONSTRAINT: battery requires a staff owner in its inventory') WHERE NOT EXISTS (SELECT 1 FROM people WHERE key=NEW.owner_key AND scope=NEW.scope AND role='staff');
  SELECT RAISE(ABORT, 'CONSTRAINT: battery building must belong to its inventory') WHERE NEW.home_building_key IS NOT NULL AND NOT EXISTS (SELECT 1 FROM buildings WHERE key=NEW.home_building_key AND scope=NEW.scope);
  SELECT RAISE(ABORT, 'CONSTRAINT: battery room must belong to its selected building and inventory') WHERE NEW.home_room_key IS NOT NULL AND NOT EXISTS (SELECT 1 FROM rooms WHERE key=NEW.home_room_key AND scope=NEW.scope AND building_key IS NEW.home_building_key);
END;
--> statement-breakpoint
CREATE TRIGGER buildings_replacement_guard BEFORE INSERT ON buildings BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: update existing buildings with their version; do not replace records') WHERE EXISTS (SELECT 1 FROM buildings WHERE key=NEW.key);
END;
--> statement-breakpoint
CREATE TRIGGER batteries_replacement_guard BEFORE INSERT ON batteries BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: update existing batteries with their version; do not replace records or assigned tags') WHERE EXISTS (SELECT 1 FROM batteries WHERE key=NEW.key)
    OR (NEW.tag_id IS NOT NULL AND EXISTS (SELECT 1 FROM batteries WHERE scope=NEW.scope AND tag_id=NEW.tag_id));
END;
--> statement-breakpoint
CREATE TRIGGER loans_integrity_insert BEFORE INSERT ON loans BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: loan references must belong to its inventory') WHERE NOT EXISTS (SELECT 1 FROM batteries WHERE key=NEW.battery_key AND scope=NEW.scope)
    OR NOT EXISTS (SELECT 1 FROM people WHERE key=NEW.borrower_key AND scope=NEW.scope);
END;
--> statement-breakpoint
CREATE TRIGGER loans_integrity_update BEFORE UPDATE ON loans BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: loan identity and references are immutable') WHERE NEW.id IS NOT OLD.id OR NEW.scope IS NOT OLD.scope OR NEW.battery_key IS NOT OLD.battery_key
    OR NEW.borrower_key IS NOT OLD.borrower_key;
  SELECT RAISE(ABORT, 'CONSTRAINT: loan references must belong to its inventory') WHERE NOT EXISTS (SELECT 1 FROM batteries WHERE key=NEW.battery_key AND scope=NEW.scope)
    OR NOT EXISTS (SELECT 1 FROM people WHERE key=NEW.borrower_key AND scope=NEW.scope);
END;
--> statement-breakpoint
CREATE TRIGGER charges_integrity_insert BEFORE INSERT ON charges BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: charge battery must belong to its inventory') WHERE NOT EXISTS (SELECT 1 FROM batteries WHERE key=NEW.battery_key AND scope=NEW.scope);
END;
--> statement-breakpoint
CREATE TRIGGER charges_integrity_update BEFORE UPDATE ON charges BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: append charging evidence instead of rewriting it');
END;
--> statement-breakpoint
CREATE TRIGGER observations_integrity_insert BEFORE INSERT ON observations BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: observation references must belong to its inventory') WHERE NOT EXISTS (SELECT 1 FROM batteries WHERE key=NEW.battery_key AND scope=NEW.scope)
    OR NOT EXISTS (SELECT 1 FROM rooms WHERE key=NEW.room_key AND scope=NEW.scope);
  SELECT RAISE(ABORT, 'CONSTRAINT: observation requires location labels at receipt') WHERE NEW.room_name IS NULL OR NEW.room_building IS NULL
    OR NOT EXISTS (SELECT 1 FROM rooms r LEFT JOIN buildings b ON b.key=r.building_key WHERE r.key=NEW.room_key AND r.scope=NEW.scope
      AND (CASE WHEN r.number IS NULL THEN r.name ELSE r.number || ' - ' || r.name END)=NEW.room_name
      AND COALESCE(b.id || ' - ' || b.name,r.building)=NEW.room_building);
END;
--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;
