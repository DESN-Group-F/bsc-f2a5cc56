-- SQLite replacement can bypass UPDATE triggers. Existing records must use
-- guarded updates; evidence is appended with a new identifier.
CREATE TRIGGER people_replacement_guard BEFORE INSERT ON people BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: update existing people with their version; do not replace records') WHERE EXISTS (SELECT 1 FROM people WHERE key=NEW.key);
END;
--> statement-breakpoint
CREATE TRIGGER rooms_replacement_guard BEFORE INSERT ON rooms BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: update existing rooms with their version; do not replace records') WHERE EXISTS (SELECT 1 FROM rooms WHERE key=NEW.key);
END;
--> statement-breakpoint
CREATE TRIGGER batteries_replacement_guard BEFORE INSERT ON batteries BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: update existing batteries with their version; do not replace records or assigned tags') WHERE EXISTS (SELECT 1 FROM batteries WHERE key=NEW.key)
    OR (NEW.tag_id IS NOT NULL AND EXISTS (SELECT 1 FROM batteries WHERE scope=NEW.scope AND tag_id=NEW.tag_id));
END;
--> statement-breakpoint
CREATE TRIGGER loans_replacement_guard BEFORE INSERT ON loans BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: update loan state instead of replacing its history') WHERE EXISTS (SELECT 1 FROM loans WHERE id=NEW.id);
END;
--> statement-breakpoint
CREATE TRIGGER observations_replacement_guard BEFORE INSERT ON observations BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: append observation evidence instead of replacing its history') WHERE EXISTS (SELECT 1 FROM observations WHERE id=NEW.id);
END;
--> statement-breakpoint
CREATE TRIGGER charges_replacement_guard BEFORE INSERT ON charges BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: append charging evidence instead of replacing its history') WHERE EXISTS (SELECT 1 FROM charges WHERE id=NEW.id);
END;
