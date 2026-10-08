CREATE TABLE inventory_arrival_counters (
 scope text PRIMARY KEY NOT NULL,
 last_sequence integer NOT NULL CHECK(last_sequence BETWEEN 0 AND 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE inventory_arrivals (
 battery_key text PRIMARY KEY NOT NULL REFERENCES batteries(key),
 scope text NOT NULL,
 sequence integer NOT NULL CHECK(sequence BETWEEN 1 AND 9007199254740991),
 actor_account_id text NOT NULL REFERENCES staff_accounts(id),
 registered_at text NOT NULL CHECK(julianday(registered_at) IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX inventory_arrivals_scope_sequence ON inventory_arrivals(scope,sequence);
--> statement-breakpoint
CREATE INDEX inventory_arrivals_scope_time ON inventory_arrivals(scope,registered_at);
--> statement-breakpoint
CREATE TABLE inventory_arrival_acknowledgements (
 key text PRIMARY KEY NOT NULL,
 scope text NOT NULL,
 account_id text NOT NULL REFERENCES staff_accounts(id),
 through_sequence integer NOT NULL CHECK(through_sequence BETWEEN 0 AND 9007199254740991),
 CHECK(key=scope || '/' || account_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX inventory_arrival_acknowledgements_account ON inventory_arrival_acknowledgements(scope,account_id);
--> statement-breakpoint
-- Backfill only attributed first-registration evidence, never demo fixture creation.
WITH registrations AS (
 SELECT b.key AS battery_key,b.scope,e.actor_id,b.created_at AS registered_at,
 ROW_NUMBER() OVER(PARTITION BY b.key ORDER BY e.rowid) AS first_record
 FROM batteries b JOIN audit_events e ON e.scope=b.scope AND e.battery_id=b.id AND e.at=b.created_at
 JOIN staff_accounts account ON account.id=e.actor_id
 WHERE e.action='battery_registered'
)
INSERT INTO inventory_arrival_counters(scope,last_sequence)
SELECT scope,COUNT(*) FROM registrations WHERE first_record=1 GROUP BY scope;
--> statement-breakpoint
WITH registrations AS (
 SELECT b.key AS battery_key,b.scope,e.actor_id,b.created_at AS registered_at,
 ROW_NUMBER() OVER(PARTITION BY b.key ORDER BY e.rowid) AS first_record
 FROM batteries b JOIN audit_events e ON e.scope=b.scope AND e.battery_id=b.id AND e.at=b.created_at
 JOIN staff_accounts account ON account.id=e.actor_id
 WHERE e.action='battery_registered'
), first_registrations AS (
 SELECT battery_key,scope,actor_id,registered_at FROM registrations WHERE first_record=1
)
INSERT INTO inventory_arrivals(battery_key,scope,sequence,actor_account_id,registered_at)
SELECT battery_key,scope,ROW_NUMBER() OVER(PARTITION BY scope ORDER BY registered_at,battery_key),actor_id,registered_at FROM first_registrations;
--> statement-breakpoint
-- The new notification feature starts without turning historical stock into unread alerts.
INSERT INTO inventory_arrival_acknowledgements(key,scope,account_id,through_sequence)
SELECT counter.scope || '/' || account.id,counter.scope,account.id,counter.last_sequence
FROM inventory_arrival_counters counter CROSS JOIN staff_accounts account;
--> statement-breakpoint
CREATE TRIGGER inventory_arrival_counters_insert BEFORE INSERT ON inventory_arrival_counters
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: arrival sequence cannot be replaced or initialized ahead') WHERE NEW.last_sequence<>0 OR EXISTS(SELECT 1 FROM inventory_arrival_counters WHERE scope=NEW.scope);
END;
--> statement-breakpoint
CREATE TRIGGER inventory_arrival_counters_update BEFORE UPDATE ON inventory_arrival_counters
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: arrival sequence must advance monotonically') WHERE NEW.scope<>OLD.scope OR NEW.last_sequence<>OLD.last_sequence+1;
END;
--> statement-breakpoint
CREATE TRIGGER inventory_arrival_counters_no_delete BEFORE DELETE ON inventory_arrival_counters
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: arrival sequence cannot be reused');
END;
--> statement-breakpoint
CREATE TRIGGER inventory_arrivals_insert BEFORE INSERT ON inventory_arrivals
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: arrival requires matching native registration evidence') WHERE NOT EXISTS(
  SELECT 1 FROM batteries b JOIN inventory_arrival_counters counter ON counter.scope=b.scope
  JOIN staff_accounts account ON account.id=NEW.actor_account_id AND account.active=1 AND account.role IN ('staff','admin')
  JOIN audit_events event ON event.scope=b.scope AND event.battery_id=b.id AND event.action='battery_registered' AND event.actor_id=account.id AND event.at=b.created_at
  WHERE b.key=NEW.battery_key AND b.scope=NEW.scope AND b.created_at=NEW.registered_at AND counter.last_sequence=NEW.sequence
 ) OR EXISTS(SELECT 1 FROM inventory_arrivals WHERE battery_key=NEW.battery_key OR (scope=NEW.scope AND sequence=NEW.sequence));
END;
--> statement-breakpoint
CREATE TRIGGER inventory_arrivals_no_update BEFORE UPDATE ON inventory_arrivals
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: first-registration arrival evidence is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER inventory_arrivals_no_delete BEFORE DELETE ON inventory_arrivals WHEN NOT (
 EXISTS(SELECT 1 FROM retired_asset_context context JOIN staff_accounts account ON account.id=context.actor_id AND account.auth_version=context.actor_auth_version AND account.active=1 WHERE context.scope=OLD.scope AND context.kind='purge' AND account.role='admin')
 AND EXISTS(SELECT 1 FROM purged_batteries WHERE key=OLD.battery_key AND scope=OLD.scope)
)
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: arrival evidence can only be cleared by an authenticated battery purge');
END;
--> statement-breakpoint
CREATE TRIGGER inventory_arrival_acknowledgements_insert BEFORE INSERT ON inventory_arrival_acknowledgements
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: arrival acknowledgement identity or cursor is invalid') WHERE NEW.key<>NEW.scope || '/' || NEW.account_id OR NEW.through_sequence>COALESCE((SELECT last_sequence FROM inventory_arrival_counters WHERE scope=NEW.scope),0) OR EXISTS(SELECT 1 FROM inventory_arrival_acknowledgements WHERE key=NEW.key OR (scope=NEW.scope AND account_id=NEW.account_id));
END;
--> statement-breakpoint
CREATE TRIGGER inventory_arrival_acknowledgements_update BEFORE UPDATE ON inventory_arrival_acknowledgements
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: arrival acknowledgement cannot change identity or move backward') WHERE NEW.key<>OLD.key OR NEW.scope<>OLD.scope OR NEW.account_id<>OLD.account_id OR NEW.through_sequence<OLD.through_sequence OR NEW.through_sequence>COALESCE((SELECT last_sequence FROM inventory_arrival_counters WHERE scope=NEW.scope),0);
END;
--> statement-breakpoint
CREATE TRIGGER inventory_arrival_acknowledgements_no_delete BEFORE DELETE ON inventory_arrival_acknowledgements
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: account arrival acknowledgement is retained');
END;
--> statement-breakpoint
-- Each actual committed registration joins the notification sequence once.
CREATE TRIGGER audit_registration_arrival AFTER INSERT ON audit_events WHEN NEW.action='battery_registered'
 AND EXISTS(SELECT 1 FROM batteries WHERE scope=NEW.scope AND id=NEW.battery_id AND created_at=NEW.at)
 AND EXISTS(SELECT 1 FROM staff_accounts WHERE id=NEW.actor_id AND active=1 AND role IN ('staff','admin'))
 AND NOT EXISTS(SELECT 1 FROM inventory_arrivals WHERE battery_key=NEW.scope || '/' || NEW.battery_id)
BEGIN
 INSERT INTO inventory_arrival_counters(scope,last_sequence) SELECT NEW.scope,0 WHERE NOT EXISTS(SELECT 1 FROM inventory_arrival_counters WHERE scope=NEW.scope);
 UPDATE inventory_arrival_counters SET last_sequence=last_sequence+1 WHERE scope=NEW.scope;
 INSERT INTO inventory_arrivals(battery_key,scope,sequence,actor_account_id,registered_at)
 SELECT NEW.scope || '/' || NEW.battery_id,NEW.scope,last_sequence,NEW.actor_id,NEW.at FROM inventory_arrival_counters WHERE scope=NEW.scope;
END;
--> statement-breakpoint
-- New accounts receive notifications only for registrations after account creation.
CREATE TRIGGER staff_accounts_initial_arrival_ack AFTER INSERT ON staff_accounts
BEGIN
 INSERT INTO inventory_arrival_acknowledgements(key,scope,account_id,through_sequence)
 SELECT scope || '/' || NEW.id,scope,NEW.id,last_sequence FROM inventory_arrival_counters;
END;
