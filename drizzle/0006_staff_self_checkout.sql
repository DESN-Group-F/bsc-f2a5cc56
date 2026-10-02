ALTER TABLE `loans` ADD `borrower_account_id` text REFERENCES staff_accounts(id);--> statement-breakpoint
ALTER TABLE `people` ADD `account_id` text REFERENCES staff_accounts(id);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_people_scope_account` ON `people` (`scope`,`account_id`);
--> statement-breakpoint
-- Account linkage is explicit and immutable. Existing directory rows remain unlinked.
CREATE TRIGGER people_account_link_insert BEFORE INSERT ON people BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: invalid staff account directory association') WHERE NEW.account_id IS NOT NULL
    AND (NEW.role != 'staff' OR NEW.id IS NOT ('staff-' || NEW.account_id)
      OR NOT EXISTS (SELECT 1 FROM staff_accounts WHERE id=NEW.account_id));
END;
--> statement-breakpoint
CREATE TRIGGER people_account_link_update BEFORE UPDATE ON people BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: staff account directory association is immutable') WHERE NEW.account_id IS NOT OLD.account_id;
  SELECT RAISE(ABORT, 'CONSTRAINT: linked staff directory role must remain staff') WHERE NEW.account_id IS NOT NULL AND NEW.role != 'staff';
END;
--> statement-breakpoint
CREATE TRIGGER loans_staff_identity_insert BEFORE INSERT ON loans BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: staff must check out to their authenticated account') WHERE NEW.borrower_account_id IS NOT NULL
    AND (NEW.checkout_actor_id IS NOT NEW.borrower_account_id
      OR NOT EXISTS (SELECT 1 FROM people p JOIN staff_accounts a ON a.id=p.account_id WHERE p.key=NEW.borrower_key
        AND p.scope=NEW.scope AND p.role='staff' AND a.id=NEW.borrower_account_id AND a.active=1
        AND NEW.borrower_name=a.display_name AND NEW.checkout_actor_name=a.display_name));
END;
--> statement-breakpoint
CREATE TRIGGER loans_staff_identity_update BEFORE UPDATE ON loans BEGIN
  SELECT RAISE(ABORT, 'CONSTRAINT: original loan responsibility and checkout evidence are immutable') WHERE NEW.borrower_account_id IS NOT OLD.borrower_account_id
    OR NEW.borrower_name IS NOT OLD.borrower_name OR NEW.checked_out_at IS NOT OLD.checked_out_at
    OR NEW.checkout_actor_id IS NOT OLD.checkout_actor_id OR NEW.checkout_actor_name IS NOT OLD.checkout_actor_name;
END;
