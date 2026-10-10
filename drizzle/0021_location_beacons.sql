-- Room beacon configuration is not a hardware acceptance or battery location record.
CREATE TABLE location_beacons (
 key text PRIMARY KEY NOT NULL, scope text NOT NULL, id text NOT NULL,
 label text NOT NULL, identifier text NOT NULL, room_key text NOT NULL REFERENCES rooms(key),
 active integer NOT NULL CHECK(active IN (0,1)), version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at text NOT NULL, updated_at text NOT NULL,
 updated_by text NOT NULL REFERENCES staff_accounts(id), updated_auth_version integer NOT NULL,
 CHECK(key=scope || '/' || id),
 CHECK(length(trim(label)) BETWEEN 1 AND 120 AND length(trim(identifier)) BETWEEN 1 AND 128),
 CHECK(julianday(created_at) IS NOT NULL AND julianday(updated_at) IS NOT NULL AND julianday(updated_at)>=julianday(created_at))
);
--> statement-breakpoint
CREATE UNIQUE INDEX location_beacons_scope_id ON location_beacons(scope,id);
--> statement-breakpoint
CREATE UNIQUE INDEX location_beacons_scope_identifier ON location_beacons(scope,identifier);
--> statement-breakpoint
CREATE TRIGGER location_beacons_insert BEFORE INSERT ON location_beacons
BEGIN
 SELECT RAISE(ABORT, 'CONSTRAINT: room beacon identity cannot be replaced') WHERE EXISTS(SELECT 1 FROM location_beacons WHERE key=NEW.key OR (scope=NEW.scope AND (id=NEW.id OR identifier=NEW.identifier)));
 SELECT RAISE(ABORT, 'CONSTRAINT: new room beacon version must be one') WHERE NEW.version<>1;
 SELECT RAISE(ABORT, 'CONSTRAINT: room beacon requires an active native administrator') WHERE NOT EXISTS(SELECT 1 FROM staff_accounts WHERE id=NEW.updated_by AND active=1 AND role='admin' AND auth_version=NEW.updated_auth_version);
 SELECT RAISE(ABORT, 'CONSTRAINT: room beacon requires a selectable J18 room in the same inventory') WHERE NOT EXISTS(SELECT 1 FROM rooms r JOIN buildings b ON b.key=r.building_key AND b.scope=r.scope WHERE r.key=NEW.room_key AND r.scope=NEW.scope AND r.selectable=1 AND b.id='J18');
END;
--> statement-breakpoint
CREATE TRIGGER location_beacons_update BEFORE UPDATE ON location_beacons
BEGIN
 SELECT RAISE(ABORT, 'CONSTRAINT: room beacon identity and creation time are immutable') WHERE NEW.key<>OLD.key OR NEW.scope<>OLD.scope OR NEW.id<>OLD.id OR NEW.created_at<>OLD.created_at;
 SELECT RAISE(ABORT, 'CONSTRAINT: room beacon version must advance once') WHERE NEW.version<>OLD.version+1;
 SELECT RAISE(ABORT, 'CONSTRAINT: room beacon requires an active native administrator') WHERE NOT EXISTS(SELECT 1 FROM staff_accounts WHERE id=NEW.updated_by AND active=1 AND role='admin' AND auth_version=NEW.updated_auth_version);
 SELECT RAISE(ABORT, 'CONSTRAINT: room beacon requires a selectable J18 room in the same inventory') WHERE NOT EXISTS(SELECT 1 FROM rooms r JOIN buildings b ON b.key=r.building_key AND b.scope=r.scope WHERE r.key=NEW.room_key AND r.scope=NEW.scope AND r.selectable=1 AND b.id='J18');
END;
--> statement-breakpoint
CREATE TRIGGER location_beacons_no_delete BEFORE DELETE ON location_beacons
BEGIN
 SELECT RAISE(ABORT, 'CONSTRAINT: deactivate room beacons without deleting mapping history');
END;
--> statement-breakpoint
CREATE TRIGGER location_operations_no_replace BEFORE INSERT ON operations
BEGIN
 SELECT RAISE(ABORT, 'CONSTRAINT: location request outcomes cannot be replaced') WHERE EXISTS(SELECT 1 FROM operations WHERE id=NEW.id AND (kind IN ('location_beacon','location_capture') OR NEW.kind IN ('location_beacon','location_capture')));
END;
--> statement-breakpoint
CREATE TRIGGER location_operations_no_update BEFORE UPDATE ON operations WHEN NOT (EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 WHERE c.scope=OLD.scope AND c.kind='purge' AND a.role='admin'))
BEGIN
 SELECT RAISE(ABORT, 'CONSTRAINT: location request outcomes are immutable') WHERE OLD.kind IN ('location_beacon','location_capture');
END;
--> statement-breakpoint
CREATE TRIGGER location_operations_no_delete BEFORE DELETE ON operations
BEGIN
 SELECT RAISE(ABORT, 'CONSTRAINT: retain location request reservations') WHERE OLD.kind IN ('location_beacon','location_capture');
END;
--> statement-breakpoint
CREATE TRIGGER location_audit_no_replace BEFORE INSERT ON audit_events
BEGIN
 SELECT RAISE(ABORT, 'CONSTRAINT: location audit cannot be replaced') WHERE EXISTS(SELECT 1 FROM audit_events WHERE id=NEW.id AND (action IN ('location_beacon_created','location_beacon_updated','location_observation_recorded','location_scan_unresolved') OR NEW.action IN ('location_beacon_created','location_beacon_updated','location_observation_recorded','location_scan_unresolved')));
END;
--> statement-breakpoint
CREATE TRIGGER location_audit_no_update BEFORE UPDATE ON audit_events WHEN NOT (EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 WHERE c.scope=OLD.scope AND c.kind='purge' AND a.role='admin'))
BEGIN
 SELECT RAISE(ABORT, 'CONSTRAINT: location audit is immutable') WHERE OLD.action IN ('location_beacon_created','location_beacon_updated','location_observation_recorded','location_scan_unresolved');
END;
--> statement-breakpoint
CREATE TRIGGER location_audit_no_delete BEFORE DELETE ON audit_events WHEN NOT (EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 WHERE c.scope=OLD.scope AND c.kind='purge' AND a.role='admin') AND EXISTS(SELECT 1 FROM purged_batteries WHERE id=OLD.battery_id AND scope=OLD.scope))
BEGIN
 SELECT RAISE(ABORT, 'CONSTRAINT: retain location audit history') WHERE OLD.action IN ('location_beacon_created','location_beacon_updated','location_observation_recorded','location_scan_unresolved');
END;
