ALTER TABLE `batteries` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `observations` ADD `room_name` text;--> statement-breakpoint
ALTER TABLE `observations` ADD `room_building` text;--> statement-breakpoint
ALTER TABLE `people` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `version` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
-- Parent identities are stable; metadata updates must advance their version.
CREATE TRIGGER people_integrity_insert BEFORE INSERT ON people BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: invalid person identity or version') WHERE NEW.key IS NOT (NEW.scope || '/' || NEW.id)
    OR typeof(NEW.version) != 'integer' OR NEW.version < 1;
END;
--> statement-breakpoint
CREATE TRIGGER people_integrity_update BEFORE UPDATE ON people BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: person identity is immutable and version must advance') WHERE NEW.key IS NOT OLD.key OR NEW.scope IS NOT OLD.scope OR NEW.id IS NOT OLD.id
    OR typeof(NEW.version) != 'integer' OR NEW.version != OLD.version + 1;
  SELECT RAISE(ABORT, 'CONSTRAINT: reassign owned batteries before changing staff role') WHERE NEW.role != 'staff' AND EXISTS (SELECT 1 FROM batteries WHERE owner_key=OLD.key);
END;
--> statement-breakpoint
CREATE TRIGGER rooms_integrity_insert BEFORE INSERT ON rooms BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: invalid room identity or version') WHERE NEW.key IS NOT (NEW.scope || '/' || NEW.id)
    OR typeof(NEW.version) != 'integer' OR NEW.version < 1;
END;
--> statement-breakpoint
CREATE TRIGGER rooms_integrity_update BEFORE UPDATE ON rooms BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: room identity is immutable and version must advance') WHERE NEW.key IS NOT OLD.key OR NEW.scope IS NOT OLD.scope OR NEW.id IS NOT OLD.id
    OR typeof(NEW.version) != 'integer' OR NEW.version != OLD.version + 1;
END;
--> statement-breakpoint
CREATE TRIGGER batteries_integrity_insert BEFORE INSERT ON batteries BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: invalid battery identity or version') WHERE NEW.key IS NOT (NEW.scope || '/' || NEW.id)
    OR typeof(NEW.version) != 'integer' OR NEW.version < 1;
  SELECT RAISE(ABORT, 'CONSTRAINT: battery requires a staff owner and room in its inventory') WHERE NOT EXISTS (SELECT 1 FROM people WHERE key=NEW.owner_key AND scope=NEW.scope AND role='staff')
    OR NOT EXISTS (SELECT 1 FROM rooms WHERE key=NEW.home_room_key AND scope=NEW.scope);
END;
--> statement-breakpoint
CREATE TRIGGER batteries_integrity_update BEFORE UPDATE ON batteries BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: battery identity is immutable and version must advance') WHERE NEW.key IS NOT OLD.key OR NEW.scope IS NOT OLD.scope OR NEW.id IS NOT OLD.id
    OR typeof(NEW.version) != 'integer' OR NEW.version != OLD.version + 1;
  SELECT RAISE(ABORT, 'CONSTRAINT: battery requires a staff owner and room in its inventory') WHERE NOT EXISTS (SELECT 1 FROM people WHERE key=NEW.owner_key AND scope=NEW.scope AND role='staff')
    OR NOT EXISTS (SELECT 1 FROM rooms WHERE key=NEW.home_room_key AND scope=NEW.scope);
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
-- Capture room labels at receipt; existing NULL snapshots remain explicitly unknown.
CREATE TRIGGER observations_integrity_insert BEFORE INSERT ON observations BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: observation references must belong to its inventory') WHERE NOT EXISTS (SELECT 1 FROM batteries WHERE key=NEW.battery_key AND scope=NEW.scope)
    OR NOT EXISTS (SELECT 1 FROM rooms WHERE key=NEW.room_key AND scope=NEW.scope);
  SELECT RAISE(ABORT, 'CONSTRAINT: observation requires the room labels at receipt') WHERE NEW.room_name IS NULL OR NEW.room_building IS NULL
    OR NOT EXISTS (SELECT 1 FROM rooms WHERE key=NEW.room_key AND scope=NEW.scope
      AND name=NEW.room_name AND building=NEW.room_building);
END;
--> statement-breakpoint
CREATE TRIGGER observations_integrity_update BEFORE UPDATE ON observations BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: append observation evidence instead of rewriting it');
END;
--> statement-breakpoint
CREATE TRIGGER charges_integrity_insert BEFORE INSERT ON charges BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: charge battery must belong to its inventory') WHERE NOT EXISTS (SELECT 1 FROM batteries WHERE key=NEW.battery_key AND scope=NEW.scope);
END;
--> statement-breakpoint
CREATE TRIGGER charges_integrity_update BEFORE UPDATE ON charges BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: charge identity and inventory are immutable') WHERE NEW.id IS NOT OLD.id OR NEW.scope IS NOT OLD.scope OR NEW.battery_key IS NOT OLD.battery_key
    OR NOT EXISTS (SELECT 1 FROM batteries WHERE key=NEW.battery_key AND scope=NEW.scope);
END;
