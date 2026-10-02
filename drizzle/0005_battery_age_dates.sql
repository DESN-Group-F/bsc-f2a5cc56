ALTER TABLE `batteries` ADD `manufactured_on` text;
--> statement-breakpoint
ALTER TABLE `batteries` ADD `first_used_on` text;
--> statement-breakpoint
CREATE TRIGGER batteries_lifecycle_dates_insert
BEFORE INSERT ON batteries
BEGIN
  SELECT RAISE(ABORT, 'Battery lifecycle dates must be valid calendar dates in chronological order')
  WHERE (NEW.manufactured_on IS NOT NULL AND (
    NEW.manufactured_on NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    OR NEW.manufactured_on < '0001-01-01'
    OR date(NEW.manufactured_on, '+0 days') IS NULL
    OR date(NEW.manufactured_on, '+0 days') <> NEW.manufactured_on
  )) OR (NEW.first_used_on IS NOT NULL AND (
    NEW.first_used_on NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    OR NEW.first_used_on < '0001-01-01'
    OR date(NEW.first_used_on, '+0 days') IS NULL
    OR date(NEW.first_used_on, '+0 days') <> NEW.first_used_on
  )) OR (NEW.manufactured_on IS NOT NULL AND NEW.first_used_on IS NOT NULL AND NEW.first_used_on < NEW.manufactured_on);
END;
--> statement-breakpoint
CREATE TRIGGER batteries_lifecycle_dates_update
BEFORE UPDATE OF manufactured_on, first_used_on ON batteries
BEGIN
  SELECT RAISE(ABORT, 'Battery lifecycle dates must be valid calendar dates in chronological order')
  WHERE (NEW.manufactured_on IS NOT NULL AND (
    NEW.manufactured_on NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    OR NEW.manufactured_on < '0001-01-01'
    OR date(NEW.manufactured_on, '+0 days') IS NULL
    OR date(NEW.manufactured_on, '+0 days') <> NEW.manufactured_on
  )) OR (NEW.first_used_on IS NOT NULL AND (
    NEW.first_used_on NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    OR NEW.first_used_on < '0001-01-01'
    OR date(NEW.first_used_on, '+0 days') IS NULL
    OR date(NEW.first_used_on, '+0 days') <> NEW.first_used_on
  )) OR (NEW.manufactured_on IS NOT NULL AND NEW.first_used_on IS NOT NULL AND NEW.first_used_on < NEW.manufactured_on);
END;
