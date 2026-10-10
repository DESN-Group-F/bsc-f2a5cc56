-- Append reviewed continuations and exchanges without rewriting an original checkout.
DROP TRIGGER teaching_checkouts_insert;
--> statement-breakpoint
CREATE TRIGGER teaching_checkouts_insert BEFORE INSERT ON teaching_checkouts
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: teaching checkout identities cannot be replaced') WHERE EXISTS(SELECT 1 FROM teaching_checkouts WHERE key=NEW.key OR (scope=NEW.scope AND id=NEW.id));
 SELECT RAISE(ABORT,'CONSTRAINT: teaching checkout requires its immutable original receipt and native actor') WHERE NOT EXISTS(SELECT 1 FROM operations o JOIN staff_accounts a ON a.id=NEW.actor_account_id AND a.active=1 AND a.role IN ('staff','admin') WHERE o.id=NEW.key AND o.scope=NEW.scope AND o.kind='teaching_checkout' AND json_extract(o.result_json,'$.action')='checkout' AND json_extract(o.result_json,'$.run')=NEW.snapshot_json AND json_extract(NEW.snapshot_json,'$.id')=NEW.id AND json_extract(NEW.snapshot_json,'$.actorAccountId')=NEW.actor_account_id AND json_extract(NEW.snapshot_json,'$.createdAt')=NEW.created_at AND json_extract(NEW.snapshot_json,'$.teachingGroup.id')=NEW.group_id);
 SELECT RAISE(ABORT,'CONSTRAINT: teaching checkout requires distinct exact native loans in the same inventory') WHERE (SELECT COUNT(*) FROM json_each(NEW.snapshot_json,'$.mappings'))<>(SELECT COUNT(DISTINCT json_extract(value,'$.actual.batteryId')) FROM json_each(NEW.snapshot_json,'$.mappings')) OR EXISTS(SELECT 1 FROM json_each(NEW.snapshot_json,'$.mappings') j WHERE NOT EXISTS(SELECT 1 FROM loans l JOIN batteries b ON b.key=l.battery_key AND b.scope=l.scope WHERE l.scope=NEW.scope AND l.id=json_extract(j.value,'$.loanId') AND b.id=json_extract(j.value,'$.actual.batteryId') AND l.borrower_account_id=NEW.actor_account_id AND (l.checked_out_at=NEW.created_at OR json_extract(j.value,'$.loanOrigin')='existing') AND l.returned_at IS NULL AND l.cancelled_at IS NULL));
END;
--> statement-breakpoint
CREATE TABLE teaching_checkout_changes (
 key text PRIMARY KEY NOT NULL, scope text NOT NULL, id text NOT NULL,
 run_key text NOT NULL REFERENCES teaching_checkouts(key), revision integer NOT NULL,
 actor_account_id text NOT NULL REFERENCES staff_accounts(id), created_at text NOT NULL,
 snapshot_json text NOT NULL, UNIQUE(scope,id), UNIQUE(run_key,revision),
 CHECK(key=scope || '/' || id), CHECK(revision>=2), CHECK(julianday(created_at) IS NOT NULL),
 CHECK(json_valid(snapshot_json) AND json_type(snapshot_json,'$.mappings')='array' AND json_array_length(snapshot_json,'$.mappings') BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TRIGGER teaching_checkout_changes_insert BEFORE INSERT ON teaching_checkout_changes
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: teaching changes cannot be replaced') WHERE EXISTS(SELECT 1 FROM teaching_checkout_changes WHERE key=NEW.key OR (scope=NEW.scope AND id=NEW.id) OR (run_key=NEW.run_key AND revision=NEW.revision));
 SELECT RAISE(ABORT,'CONSTRAINT: teaching change requires an exact original receipt, run and native actor') WHERE NOT EXISTS(SELECT 1 FROM operations o JOIN teaching_checkouts c ON c.key=NEW.run_key AND c.scope=NEW.scope AND c.actor_account_id=NEW.actor_account_id JOIN staff_accounts a ON a.id=NEW.actor_account_id AND a.active=1 AND a.role IN ('staff','admin') WHERE o.id=NEW.key AND o.scope=NEW.scope AND o.kind='teaching_checkout' AND json_extract(o.result_json,'$.action') IN ('continue','exchange') AND json_extract(o.result_json,'$.change')=NEW.snapshot_json AND json_extract(NEW.snapshot_json,'$.id')=NEW.id AND json_extract(NEW.snapshot_json,'$.runId')=c.id AND json_extract(NEW.snapshot_json,'$.revision')=NEW.revision AND json_extract(NEW.snapshot_json,'$.actorAccountId')=NEW.actor_account_id AND json_extract(NEW.snapshot_json,'$.at')=NEW.created_at);
 SELECT RAISE(ABORT,'CONSTRAINT: teaching change revision must follow the current run') WHERE NEW.revision<>COALESCE((SELECT MAX(revision) FROM teaching_checkout_changes WHERE run_key=NEW.run_key),1)+1;
 SELECT RAISE(ABORT,'CONSTRAINT: teaching change requires exact active native loans') WHERE EXISTS(SELECT 1 FROM json_each(NEW.snapshot_json,'$.mappings') j WHERE NOT EXISTS(SELECT 1 FROM loans l JOIN batteries b ON b.key=l.battery_key AND b.scope=l.scope WHERE l.scope=NEW.scope AND l.id=json_extract(j.value,'$.loanId') AND b.id=json_extract(j.value,'$.actual.batteryId') AND l.borrower_account_id=NEW.actor_account_id AND (l.checked_out_at=NEW.created_at OR json_extract(j.value,'$.loanOrigin')='existing') AND l.returned_at IS NULL AND l.cancelled_at IS NULL));
END;
--> statement-breakpoint
CREATE TRIGGER teaching_checkout_changes_update BEFORE UPDATE ON teaching_checkout_changes
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: teaching change identities are immutable') WHERE NEW.key IS NOT OLD.key OR NEW.scope IS NOT OLD.scope OR NEW.id IS NOT OLD.id OR NEW.run_key IS NOT OLD.run_key OR NEW.revision IS NOT OLD.revision OR NEW.actor_account_id IS NOT OLD.actor_account_id OR NEW.created_at IS NOT OLD.created_at;
 SELECT RAISE(ABORT,'CONSTRAINT: teaching change evidence changes only during authorized asset deletion') WHERE NOT EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 AND a.role='admin' WHERE c.scope=OLD.scope AND c.kind='purge');
END;
--> statement-breakpoint
CREATE TRIGGER teaching_checkout_changes_no_delete BEFORE DELETE ON teaching_checkout_changes
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: retain teaching change identity and minimum references');
END;
--> statement-breakpoint
CREATE TRIGGER teaching_checkout_changes_revision_insert AFTER INSERT ON teaching_checkout_changes
BEGIN
 INSERT INTO inventory_evidence_revisions(scope,version) VALUES(NEW.scope,1) ON CONFLICT(scope) DO UPDATE SET version=version+1;
END;
--> statement-breakpoint
CREATE TRIGGER teaching_checkout_changes_revision_update AFTER UPDATE ON teaching_checkout_changes
BEGIN
 INSERT INTO inventory_evidence_revisions(scope,version) VALUES(NEW.scope,1) ON CONFLICT(scope) DO UPDATE SET version=version+1;
END;
