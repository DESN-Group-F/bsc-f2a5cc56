CREATE TABLE teaching_groups (
    key text PRIMARY KEY NOT NULL, scope text NOT NULL, id text NOT NULL,
    owner_account_id text NOT NULL REFERENCES staff_accounts(id),
    name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80), notes text NOT NULL DEFAULT '' CHECK(length(notes)<=500),
    member_ids_json text NOT NULL CHECK(json_valid(member_ids_json) AND json_type(member_ids_json)='array' AND json_array_length(member_ids_json) BETWEEN 1 AND 100),
    version integer NOT NULL DEFAULT 1 CHECK(version>0), state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','archived')),
    created_at text NOT NULL, updated_at text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX teaching_groups_identity ON teaching_groups(scope,owner_account_id,id);
--> statement-breakpoint
CREATE UNIQUE INDEX teaching_groups_active_name ON teaching_groups(scope,owner_account_id,name COLLATE NOCASE) WHERE state='active';
--> statement-breakpoint
CREATE TRIGGER teaching_groups_insert BEFORE INSERT ON teaching_groups
BEGIN
    SELECT RAISE(ABORT,'CONSTRAINT: teaching group identity cannot be replaced') WHERE EXISTS(SELECT 1 FROM teaching_groups WHERE key=NEW.key OR (scope=NEW.scope AND owner_account_id=NEW.owner_account_id AND id=NEW.id));
    SELECT RAISE(ABORT,'CONSTRAINT: new teaching groups require active native ownership') WHERE NEW.version<>1 OR NEW.state<>'active' OR NOT EXISTS(SELECT 1 FROM staff_accounts WHERE id=NEW.owner_account_id AND active=1 AND role IN ('admin','staff'));
    SELECT RAISE(ABORT,'CONSTRAINT: teaching group members must be distinct batteries in its inventory') WHERE (SELECT COUNT(*) FROM json_each(NEW.member_ids_json))<>(SELECT COUNT(DISTINCT value) FROM json_each(NEW.member_ids_json)) OR EXISTS(SELECT 1 FROM json_each(NEW.member_ids_json) j WHERE j.type<>'text' OR NOT EXISTS(SELECT 1 FROM batteries WHERE scope=NEW.scope AND id=j.value));
END;
--> statement-breakpoint
CREATE TRIGGER teaching_groups_update BEFORE UPDATE ON teaching_groups
BEGIN
    SELECT RAISE(ABORT,'CONSTRAINT: teaching group identity and owner are immutable') WHERE NEW.key IS NOT OLD.key OR NEW.scope IS NOT OLD.scope OR NEW.id IS NOT OLD.id OR NEW.owner_account_id IS NOT OLD.owner_account_id OR NEW.created_at IS NOT OLD.created_at;
    SELECT RAISE(ABORT,'CONSTRAINT: teaching group changes require current version and active state') WHERE OLD.state<>'active' OR NEW.version<>OLD.version+1;
    SELECT RAISE(ABORT,'CONSTRAINT: archiving preserves teaching group membership and details') WHERE NEW.state='archived' AND (NEW.name IS NOT OLD.name OR NEW.notes IS NOT OLD.notes OR NEW.member_ids_json IS NOT OLD.member_ids_json);
    SELECT RAISE(ABORT,'CONSTRAINT: teaching group members must be distinct batteries in its inventory') WHERE (SELECT COUNT(*) FROM json_each(NEW.member_ids_json))<>(SELECT COUNT(DISTINCT value) FROM json_each(NEW.member_ids_json)) OR EXISTS(SELECT 1 FROM json_each(NEW.member_ids_json) j WHERE j.type<>'text' OR NOT EXISTS(SELECT 1 FROM batteries WHERE scope=NEW.scope AND id=j.value));
END;
--> statement-breakpoint
CREATE TRIGGER teaching_groups_no_delete BEFORE DELETE ON teaching_groups
BEGIN
    SELECT RAISE(ABORT,'CONSTRAINT: archive teaching groups instead of deleting their identity');
END;
--> statement-breakpoint
CREATE TABLE teaching_group_operations (
    key text PRIMARY KEY NOT NULL, scope text NOT NULL, owner_account_id text NOT NULL REFERENCES staff_accounts(id), request_id text NOT NULL,
    fingerprint text NOT NULL, outcome text NOT NULL CHECK(outcome IN ('saved','rejected')), result_json text NOT NULL CHECK(json_valid(result_json)),
    created_at text NOT NULL, guard integer NOT NULL CHECK(guard=1)
);
--> statement-breakpoint
CREATE TRIGGER teaching_group_operations_no_replace BEFORE INSERT ON teaching_group_operations
BEGIN
    SELECT RAISE(ABORT,'CONSTRAINT: teaching group request outcomes cannot be replaced') WHERE EXISTS(SELECT 1 FROM teaching_group_operations WHERE key=NEW.key);
END;
--> statement-breakpoint
CREATE TRIGGER teaching_group_operations_no_update BEFORE UPDATE ON teaching_group_operations
BEGIN
    SELECT RAISE(ABORT,'CONSTRAINT: teaching group request outcomes are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER teaching_group_operations_no_delete BEFORE DELETE ON teaching_group_operations
BEGIN
    SELECT RAISE(ABORT,'CONSTRAINT: teaching group request outcomes must be retained');
END;
--> statement-breakpoint
CREATE TABLE teaching_group_events (
    id text PRIMARY KEY NOT NULL, scope text NOT NULL, owner_account_id text NOT NULL REFERENCES staff_accounts(id), group_key text NOT NULL REFERENCES teaching_groups(key),
    action text NOT NULL CHECK(action IN ('create','update','remove')), at text NOT NULL, before_json text, after_json text NOT NULL CHECK(json_valid(after_json)), request_id text NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER teaching_group_events_insert BEFORE INSERT ON teaching_group_events
BEGIN
    SELECT RAISE(ABORT,'CONSTRAINT: teaching group evidence cannot be replaced') WHERE EXISTS(SELECT 1 FROM teaching_group_events WHERE id=NEW.id);
    SELECT RAISE(ABORT,'CONSTRAINT: teaching group evidence requires its native private context') WHERE NOT EXISTS(SELECT 1 FROM teaching_groups WHERE key=NEW.group_key AND scope=NEW.scope AND owner_account_id=NEW.owner_account_id);
END;
--> statement-breakpoint
CREATE TRIGGER teaching_group_events_no_update BEFORE UPDATE ON teaching_group_events
BEGIN
    SELECT RAISE(ABORT,'CONSTRAINT: teaching group evidence is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER teaching_group_events_no_delete BEFORE DELETE ON teaching_group_events
BEGIN
    SELECT RAISE(ABORT,'CONSTRAINT: teaching group evidence must be retained');
END;
