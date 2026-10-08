-- Temporary teaching checkouts retain actual assets and exact historical loans.
CREATE TABLE teaching_checkouts (
 key text PRIMARY KEY NOT NULL, scope text NOT NULL, id text NOT NULL,
 actor_account_id text NOT NULL REFERENCES staff_accounts(id), group_id text NOT NULL,
 created_at text NOT NULL, snapshot_json text NOT NULL,
 UNIQUE(scope,id), CHECK(key=scope || '/' || id), CHECK(julianday(created_at) IS NOT NULL),
 CHECK(json_valid(snapshot_json) AND json_type(snapshot_json,'$.mappings')='array' AND json_array_length(snapshot_json,'$.mappings') BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE INDEX teaching_checkouts_actor_time ON teaching_checkouts(scope,actor_account_id,created_at);
--> statement-breakpoint
CREATE TRIGGER teaching_checkouts_insert BEFORE INSERT ON teaching_checkouts
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: teaching checkout identities cannot be replaced') WHERE EXISTS(SELECT 1 FROM teaching_checkouts WHERE key=NEW.key OR (scope=NEW.scope AND id=NEW.id));
 SELECT RAISE(ABORT,'CONSTRAINT: teaching checkout requires its immutable original receipt and native actor') WHERE NOT EXISTS(SELECT 1 FROM operations o JOIN staff_accounts a ON a.id=NEW.actor_account_id AND a.active=1 AND a.role IN ('staff','admin') WHERE o.id=NEW.key AND o.scope=NEW.scope AND o.kind='teaching_checkout' AND json_extract(o.result_json,'$.action')='checkout' AND json_extract(o.result_json,'$.run')=NEW.snapshot_json AND json_extract(NEW.snapshot_json,'$.id')=NEW.id AND json_extract(NEW.snapshot_json,'$.actorAccountId')=NEW.actor_account_id AND json_extract(NEW.snapshot_json,'$.createdAt')=NEW.created_at AND json_extract(NEW.snapshot_json,'$.teachingGroup.id')=NEW.group_id);
 SELECT RAISE(ABORT,'CONSTRAINT: teaching checkout actual members require distinct exact native loans in the same inventory') WHERE (SELECT COUNT(*) FROM json_each(NEW.snapshot_json,'$.mappings'))<>(SELECT COUNT(DISTINCT json_extract(value,'$.actual.batteryId')) FROM json_each(NEW.snapshot_json,'$.mappings')) OR EXISTS(SELECT 1 FROM json_each(NEW.snapshot_json,'$.mappings') j WHERE NOT EXISTS(SELECT 1 FROM loans l JOIN batteries b ON b.key=l.battery_key AND b.scope=l.scope WHERE l.scope=NEW.scope AND l.id=json_extract(j.value,'$.loanId') AND b.id=json_extract(j.value,'$.actual.batteryId') AND l.borrower_account_id=NEW.actor_account_id AND l.checked_out_at=NEW.created_at AND l.returned_at IS NULL AND l.cancelled_at IS NULL));
END;
--> statement-breakpoint
CREATE TRIGGER teaching_checkouts_update BEFORE UPDATE ON teaching_checkouts
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: teaching checkout identity and original actor are immutable') WHERE NEW.key IS NOT OLD.key OR NEW.scope IS NOT OLD.scope OR NEW.id IS NOT OLD.id OR NEW.actor_account_id IS NOT OLD.actor_account_id OR NEW.group_id IS NOT OLD.group_id OR NEW.created_at IS NOT OLD.created_at;
 SELECT RAISE(ABORT,'CONSTRAINT: teaching checkout evidence may change only during authorized permanent asset deletion') WHERE NOT EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 AND a.role='admin' WHERE c.scope=OLD.scope AND c.kind='purge');
END;
--> statement-breakpoint
CREATE TRIGGER teaching_checkouts_no_delete BEFORE DELETE ON teaching_checkouts
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: retain teaching checkout identity and minimum references');
END;
--> statement-breakpoint
CREATE TRIGGER teaching_checkouts_evidence_revision_insert AFTER INSERT ON teaching_checkouts
BEGIN
 INSERT INTO inventory_evidence_revisions(scope,version) VALUES(NEW.scope,1) ON CONFLICT(scope) DO UPDATE SET version=version+1;
END;
--> statement-breakpoint
CREATE TRIGGER teaching_checkouts_evidence_revision_update AFTER UPDATE ON teaching_checkouts
BEGIN
 INSERT INTO inventory_evidence_revisions(scope,version) VALUES(NEW.scope,1) ON CONFLICT(scope) DO UPDATE SET version=version+1;
END;
