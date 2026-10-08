-- Recovery and explicit administrator deletion, with minimum identity evidence.
CREATE TABLE retired_asset_context (
 scope text PRIMARY KEY NOT NULL, request_key text NOT NULL REFERENCES operations(id), actor_id text NOT NULL REFERENCES staff_accounts(id), actor_auth_version integer NOT NULL,
 kind text NOT NULL CHECK(kind IN ('recover','purge')), at text NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER retired_asset_context_insert BEFORE INSERT ON retired_asset_context
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: retired asset batch requires current native authority and its receipt') WHERE NOT EXISTS(SELECT 1 FROM staff_accounts a JOIN operations o ON o.id=NEW.request_key AND o.scope=NEW.scope WHERE a.id=NEW.actor_id AND a.auth_version=NEW.actor_auth_version AND a.active=1 AND a.role IN ('admin','staff') AND (NEW.kind='recover' OR a.role='admin') AND o.kind='retired_asset' AND json_extract(o.result_json,'$.kind')=NEW.kind AND json_extract(o.result_json,'$.actorAccountId')=NEW.actor_id AND json_extract(o.result_json,'$.at')=NEW.at);
END;
--> statement-breakpoint
CREATE TRIGGER retired_asset_context_no_update BEFORE UPDATE ON retired_asset_context
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: retired asset batch authorization is immutable');
END;
--> statement-breakpoint
CREATE TABLE purged_batteries (
 key text PRIMARY KEY NOT NULL, scope text NOT NULL, id text NOT NULL, actor_id text NOT NULL REFERENCES staff_accounts(id), at text NOT NULL,
 UNIQUE(scope,id), CHECK(key=scope || '/' || id), CHECK(julianday(at) IS NOT NULL)
);
--> statement-breakpoint
CREATE TRIGGER purged_batteries_insert BEFORE INSERT ON purged_batteries
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: purged battery identity cannot be replaced') WHERE EXISTS(SELECT 1 FROM purged_batteries WHERE key=NEW.key OR (scope=NEW.scope AND id=NEW.id));
 SELECT RAISE(ABORT,'CONSTRAINT: permanent deletion requires reviewed scrapped data and current administrator') WHERE NOT EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 AND a.role='admin' JOIN operations o ON o.id=c.request_key JOIN batteries b ON b.key=NEW.key AND b.scope=NEW.scope JOIN json_each(json_extract(o.result_json,'$.items')) j ON json_extract(j.value,'$.batteryId')=b.id AND json_extract(j.value,'$.version')=b.version+1 AND json_extract(j.value,'$.status')='deleted' WHERE c.scope=NEW.scope AND c.kind='purge' AND c.actor_id=NEW.actor_id AND c.at=NEW.at AND b.lifecycle_status='scrapped' AND NOT EXISTS(SELECT 1 FROM loans WHERE battery_key=b.key AND scope=b.scope AND returned_at IS NULL AND cancelled_at IS NULL));
END;
--> statement-breakpoint
CREATE TRIGGER purged_batteries_no_update BEFORE UPDATE ON purged_batteries
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: retain the minimum permanent deletion evidence');
END;
--> statement-breakpoint
CREATE TRIGGER purged_batteries_no_delete BEFORE DELETE ON purged_batteries
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: retain the minimum permanent deletion evidence');
END;
--> statement-breakpoint
CREATE TABLE purged_tag_reservations (scope text NOT NULL, tag_hash text NOT NULL, PRIMARY KEY(scope,tag_hash), CHECK(length(tag_hash)=71 AND substr(tag_hash,1,7)='sha256:'));
--> statement-breakpoint
CREATE TRIGGER purged_tag_reservations_insert BEFORE INSERT ON purged_tag_reservations
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: tag reservation requires a current authorized purge') WHERE NOT EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 AND a.role='admin' WHERE c.scope=NEW.scope AND c.kind='purge');
END;
--> statement-breakpoint
CREATE TRIGGER purged_tag_reservations_no_update BEFORE UPDATE ON purged_tag_reservations
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: purged registered tag reservations are permanent');
END;
--> statement-breakpoint
CREATE TRIGGER purged_tag_reservations_no_delete BEFORE DELETE ON purged_tag_reservations
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: purged registered tag reservations are permanent');
END;
--> statement-breakpoint
CREATE TRIGGER batteries_purged_identity_insert BEFORE INSERT ON batteries
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: permanently deleted battery IDs cannot be reused') WHERE EXISTS(SELECT 1 FROM purged_batteries WHERE scope=NEW.scope AND id=NEW.id);
END;
--> statement-breakpoint
DROP TRIGGER batteries_lifecycle_update;
--> statement-breakpoint
CREATE TRIGGER batteries_lifecycle_update BEFORE UPDATE ON batteries
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT: terminal battery records are immutable') WHERE OLD.lifecycle_status<>'active' AND NOT (OLD.lifecycle_status='scrapped' AND NEW.lifecycle_status='active' AND EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 AND a.role IN ('admin','staff') JOIN operations o ON o.id=c.request_key JOIN json_each(json_extract(o.result_json,'$.items')) j ON json_extract(j.value,'$.batteryId')=OLD.id AND json_extract(j.value,'$.version')=NEW.version AND json_extract(j.value,'$.status')='active' WHERE c.scope=OLD.scope AND c.kind='recover'));
    SELECT RAISE(ABORT, 'CONSTRAINT: active batteries cannot contain removal evidence') WHERE NEW.lifecycle_status='active' AND (NEW.lifecycle_at IS NOT NULL OR NEW.lifecycle_reason IS NOT NULL OR NEW.lifecycle_destination IS NOT NULL);
    SELECT RAISE(ABORT, 'CONSTRAINT: battery removal requires dated evidence and bounded optional details') WHERE NEW.lifecycle_status<>'active' AND (NEW.lifecycle_at IS NULL OR length(NEW.lifecycle_reason)>1000 OR length(NEW.lifecycle_destination)>200 OR (NEW.lifecycle_status='scrapped' AND NEW.lifecycle_destination IS NOT NULL));
    SELECT RAISE(ABORT, 'CONSTRAINT: return the active loan before removing its battery') WHERE NEW.lifecycle_status<>'active' AND EXISTS(SELECT 1 FROM loans WHERE scope=OLD.scope AND battery_key=OLD.key AND returned_at IS NULL AND cancelled_at IS NULL);
    SELECT RAISE(ABORT, 'CONSTRAINT: removal cannot modify saved battery specifications or responsibility') WHERE (NEW.lifecycle_status<>'active' OR OLD.lifecycle_status<>'active') AND (NEW.name IS NOT OLD.name OR NEW.chemistry IS NOT OLD.chemistry OR NEW.model IS NOT OLD.model OR NEW.capacity_mah IS NOT OLD.capacity_mah OR NEW.voltage IS NOT OLD.voltage OR NEW.tag_id IS NOT OLD.tag_id OR NEW.owner_key IS NOT OLD.owner_key OR NEW.home_building_key IS NOT OLD.home_building_key OR NEW.home_room_key IS NOT OLD.home_room_key OR NEW.manufactured_on IS NOT OLD.manufactured_on OR NEW.first_used_on IS NOT OLD.first_used_on OR NEW.created_at IS NOT OLD.created_at);
END;
--> statement-breakpoint
DROP TRIGGER batteries_no_delete;
--> statement-breakpoint
CREATE TRIGGER batteries_no_delete BEFORE DELETE ON batteries WHEN NOT (EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 WHERE c.scope=OLD.scope AND c.kind='purge' AND a.role='admin') AND OLD.lifecycle_status='scrapped' AND EXISTS(SELECT 1 FROM purged_batteries WHERE key=OLD.key AND scope=OLD.scope))
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT: retain battery identity and history; record its lifecycle instead');
END;
--> statement-breakpoint
DROP TRIGGER loans_terminal_history_no_delete;
--> statement-breakpoint
CREATE TRIGGER loans_terminal_history_no_delete BEFORE DELETE ON loans WHEN NOT (EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 WHERE c.scope=OLD.scope AND c.kind='purge' AND a.role='admin') AND EXISTS(SELECT 1 FROM purged_batteries WHERE key=OLD.battery_key AND scope=OLD.scope))
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT: retain terminal battery loan history') WHERE EXISTS(SELECT 1 FROM batteries WHERE key=OLD.battery_key AND scope=OLD.scope AND lifecycle_status<>'active');
END;
--> statement-breakpoint
DROP TRIGGER charges_terminal_history_no_delete;
--> statement-breakpoint
CREATE TRIGGER charges_terminal_history_no_delete BEFORE DELETE ON charges WHEN NOT (EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 WHERE c.scope=OLD.scope AND c.kind='purge' AND a.role='admin') AND EXISTS(SELECT 1 FROM purged_batteries WHERE key=OLD.battery_key AND scope=OLD.scope))
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT: retain terminal battery charging history') WHERE EXISTS(SELECT 1 FROM batteries WHERE key=OLD.battery_key AND scope=OLD.scope AND lifecycle_status<>'active');
END;
--> statement-breakpoint
DROP TRIGGER observations_terminal_history_no_delete;
--> statement-breakpoint
CREATE TRIGGER observations_terminal_history_no_delete BEFORE DELETE ON observations WHEN NOT (EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 WHERE c.scope=OLD.scope AND c.kind='purge' AND a.role='admin') AND EXISTS(SELECT 1 FROM purged_batteries WHERE key=OLD.battery_key AND scope=OLD.scope))
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT: retain terminal battery observation history') WHERE EXISTS(SELECT 1 FROM batteries WHERE key=OLD.battery_key AND scope=OLD.scope AND lifecycle_status<>'active');
END;
--> statement-breakpoint
DROP TRIGGER lifecycle_operations_no_update;
--> statement-breakpoint
CREATE TRIGGER lifecycle_operations_no_update BEFORE UPDATE ON operations WHEN NOT (EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 WHERE c.scope=OLD.scope AND c.kind='purge' AND a.role='admin'))
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT: lifecycle request outcome is immutable') WHERE OLD.kind IN ('battery_lifecycle','battery_lifecycle_rejected');
END;
--> statement-breakpoint
DROP TRIGGER lifecycle_audit_no_update;
--> statement-breakpoint
CREATE TRIGGER lifecycle_audit_no_update BEFORE UPDATE ON audit_events WHEN NOT (EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 WHERE c.scope=OLD.scope AND c.kind='purge' AND a.role='admin'))
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT: lifecycle audit is immutable') WHERE OLD.action IN ('battery_scrapped','battery_permanently_removed');
END;
--> statement-breakpoint
DROP TRIGGER lifecycle_audit_no_delete;
--> statement-breakpoint
CREATE TRIGGER lifecycle_audit_no_delete BEFORE DELETE ON audit_events WHEN NOT (EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 WHERE c.scope=OLD.scope AND c.kind='purge' AND a.role='admin') AND EXISTS(SELECT 1 FROM purged_batteries WHERE id=OLD.battery_id AND scope=OLD.scope))
BEGIN
    SELECT RAISE(ABORT, 'CONSTRAINT: lifecycle audit cannot be deleted') WHERE OLD.action IN ('battery_scrapped','battery_permanently_removed');
END;
--> statement-breakpoint
DROP TRIGGER inspection_operations_no_update;
--> statement-breakpoint
CREATE TRIGGER inspection_operations_no_update BEFORE UPDATE ON operations WHEN NOT (EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 WHERE c.scope=OLD.scope AND c.kind='purge' AND a.role='admin'))
BEGIN
    SELECT RAISE(ABORT, 'inspection receipt is immutable') WHERE OLD.kind IN ('inspection','inspection_void','inspection_rejected','inspection_void_rejected') OR NEW.kind IN ('inspection','inspection_void','inspection_rejected','inspection_void_rejected');
END;
--> statement-breakpoint
DROP TRIGGER inspection_audit_no_update;
--> statement-breakpoint
CREATE TRIGGER inspection_audit_no_update BEFORE UPDATE ON audit_events WHEN NOT (EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 WHERE c.scope=OLD.scope AND c.kind='purge' AND a.role='admin'))
BEGIN
    SELECT RAISE(ABORT, 'inspection audit is immutable') WHERE OLD.action IN ('inspection_recorded','inspection_voided') OR NEW.action IN ('inspection_recorded','inspection_voided');
END;
--> statement-breakpoint
DROP TRIGGER inspection_audit_no_delete;
--> statement-breakpoint
CREATE TRIGGER inspection_audit_no_delete BEFORE DELETE ON audit_events WHEN NOT (EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 WHERE c.scope=OLD.scope AND c.kind='purge' AND a.role='admin') AND EXISTS(SELECT 1 FROM purged_batteries WHERE id=OLD.battery_id AND scope=OLD.scope))
BEGIN
    SELECT RAISE(ABORT, 'inspection audit cannot be deleted') WHERE OLD.action IN ('inspection_recorded','inspection_voided');
END;
--> statement-breakpoint
DROP TRIGGER battery_inspections_no_delete;
--> statement-breakpoint
CREATE TRIGGER battery_inspections_no_delete BEFORE DELETE ON battery_inspections WHEN NOT (EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 WHERE c.scope=OLD.scope AND c.kind='purge' AND a.role='admin') AND EXISTS(SELECT 1 FROM purged_batteries WHERE key=OLD.battery_key AND scope=OLD.scope))
BEGIN
    SELECT RAISE(ABORT, 'inspection evidence cannot be deleted');
END;
--> statement-breakpoint
DROP TRIGGER battery_inspection_voids_no_delete;
--> statement-breakpoint
CREATE TRIGGER battery_inspection_voids_no_delete BEFORE DELETE ON battery_inspection_voids WHEN NOT (EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 WHERE c.scope=OLD.scope AND c.kind='purge' AND a.role='admin') AND EXISTS(SELECT 1 FROM battery_inspections i JOIN purged_batteries p ON p.key=i.battery_key AND p.scope=i.scope WHERE i.id=OLD.inspection_id AND i.scope=OLD.scope))
BEGIN
    SELECT RAISE(ABORT, 'inspection correction evidence cannot be deleted');
END;
--> statement-breakpoint
DROP TRIGGER teaching_group_operations_no_update;
--> statement-breakpoint
CREATE TRIGGER teaching_group_operations_no_update BEFORE UPDATE ON teaching_group_operations WHEN NOT (EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 WHERE c.scope=OLD.scope AND c.kind='purge' AND a.role='admin'))
BEGIN
    SELECT RAISE(ABORT,'CONSTRAINT: teaching group request outcomes are immutable');
END;
--> statement-breakpoint
DROP TRIGGER teaching_group_events_no_update;
--> statement-breakpoint
CREATE TRIGGER teaching_group_events_no_update BEFORE UPDATE ON teaching_group_events WHEN NOT (EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 WHERE c.scope=OLD.scope AND c.kind='purge' AND a.role='admin'))
BEGIN
    SELECT RAISE(ABORT,'CONSTRAINT: teaching group evidence is immutable');
END;
--> statement-breakpoint
DROP TRIGGER intake_sessions_no_update;
--> statement-breakpoint
CREATE TRIGGER intake_sessions_no_update BEFORE UPDATE ON intake_sessions WHEN NOT (EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 WHERE c.scope=OLD.scope AND c.kind='purge' AND a.role='admin'))
BEGIN
    SELECT RAISE(ABORT, 'intake session configuration is immutable');
END;
--> statement-breakpoint
DROP TRIGGER task_cycles_update_history;
--> statement-breakpoint
CREATE TRIGGER task_cycles_update_history BEFORE UPDATE ON task_cycles WHEN NOT (EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 WHERE c.scope=OLD.scope AND c.kind='purge' AND a.role='admin'))
BEGIN
    SELECT RAISE(ABORT, 'completed task cycle is immutable') WHERE OLD.status='completed';
    SELECT RAISE(ABORT, 'task cycle snapshot is immutable') WHERE NEW.key IS NOT OLD.key OR NEW.scope IS NOT OLD.scope OR NEW.id IS NOT OLD.id OR NEW.plan_key IS NOT OLD.plan_key OR NEW.plan_version IS NOT OLD.plan_version OR NEW.snapshot_json IS NOT OLD.snapshot_json OR NEW.due_on IS NOT OLD.due_on OR NEW.created_at IS NOT OLD.created_at;
    SELECT RAISE(ABORT, 'task cycle version must advance') WHERE NEW.version <> OLD.version + 1;
    SELECT RAISE(ABORT, 'task cycle reminder status invalid') WHERE NEW.reminder_status NOT IN ('scheduled','ambiguous','nonexistent','unconfigured');
    SELECT RAISE(ABORT, 'task completion evidence required') WHERE NEW.status='completed' AND (NEW.completed_at IS NULL OR NEW.completed_by IS NULL OR NEW.completed_by_name IS NULL);
    SELECT RAISE(ABORT, 'task completion notes exceed maximum length') WHERE NEW.completion_notes IS NOT NULL AND length(NEW.completion_notes) > 2000;
    SELECT RAISE(ABORT, 'open task cannot contain completion evidence') WHERE NEW.status='open' AND (NEW.completed_at IS NOT NULL OR NEW.completed_by IS NOT NULL OR NEW.completed_by_name IS NOT NULL OR NEW.completion_notes IS NOT NULL);
END;
--> statement-breakpoint
DROP TRIGGER task_cycles_update_current_plan;
--> statement-breakpoint
CREATE TRIGGER task_cycles_update_current_plan BEFORE UPDATE ON task_cycles WHEN NOT (EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 WHERE c.scope=OLD.scope AND c.kind='purge' AND a.role='admin'))
BEGIN
    SELECT RAISE(ABORT, 'removed task plan cannot change cycles') WHERE EXISTS(SELECT 1 FROM task_plans WHERE key=OLD.plan_key AND removed_at IS NOT NULL);
END;
--> statement-breakpoint
CREATE TRIGGER operations_purge_update_identity BEFORE UPDATE ON operations WHEN EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 WHERE c.scope=OLD.scope AND c.kind='purge' AND a.role='admin')
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: purge may redact structured evidence only') WHERE NEW.id IS NOT OLD.id OR NEW.scope IS NOT OLD.scope OR NEW.kind IS NOT OLD.kind OR NEW.created_at IS NOT OLD.created_at OR NEW.guard IS NOT OLD.guard;
END;
--> statement-breakpoint
CREATE TRIGGER audit_events_purge_update_identity BEFORE UPDATE ON audit_events WHEN EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 WHERE c.scope=OLD.scope AND c.kind='purge' AND a.role='admin')
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: purge may redact structured evidence only') WHERE NEW.id IS NOT OLD.id OR NEW.scope IS NOT OLD.scope OR NEW.action IS NOT OLD.action OR NEW.battery_id IS NOT OLD.battery_id OR NEW.actor_id IS NOT OLD.actor_id OR NEW.actor_name IS NOT OLD.actor_name OR NEW.at IS NOT OLD.at;
END;
--> statement-breakpoint
CREATE TRIGGER intake_sessions_purge_update_identity BEFORE UPDATE ON intake_sessions WHEN EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 WHERE c.scope=OLD.scope AND c.kind='purge' AND a.role='admin')
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: purge may redact structured evidence only') WHERE NEW.key IS NOT OLD.key OR NEW.scope IS NOT OLD.scope OR NEW.id IS NOT OLD.id OR NEW.actor_id IS NOT OLD.actor_id OR NEW.actor_name IS NOT OLD.actor_name OR NEW.created_at IS NOT OLD.created_at;
END;
--> statement-breakpoint
CREATE TRIGGER teaching_group_operations_purge_update_identity BEFORE UPDATE ON teaching_group_operations WHEN EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 WHERE c.scope=OLD.scope AND c.kind='purge' AND a.role='admin')
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: purge may redact structured evidence only') WHERE NEW.key IS NOT OLD.key OR NEW.scope IS NOT OLD.scope OR NEW.owner_account_id IS NOT OLD.owner_account_id OR NEW.request_id IS NOT OLD.request_id OR NEW.outcome IS NOT OLD.outcome OR NEW.created_at IS NOT OLD.created_at OR NEW.guard IS NOT OLD.guard;
END;
--> statement-breakpoint
CREATE TRIGGER teaching_group_events_purge_update_identity BEFORE UPDATE ON teaching_group_events WHEN EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 WHERE c.scope=OLD.scope AND c.kind='purge' AND a.role='admin')
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: purge may redact structured evidence only') WHERE NEW.id IS NOT OLD.id OR NEW.scope IS NOT OLD.scope OR NEW.owner_account_id IS NOT OLD.owner_account_id OR NEW.group_key IS NOT OLD.group_key OR NEW.action IS NOT OLD.action OR NEW.at IS NOT OLD.at OR NEW.request_id IS NOT OLD.request_id;
END;
--> statement-breakpoint
CREATE TRIGGER task_cycles_purge_update_identity BEFORE UPDATE ON task_cycles WHEN EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 WHERE c.scope=OLD.scope AND c.kind='purge' AND a.role='admin')
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: purge may redact structured evidence only') WHERE NEW.key IS NOT OLD.key OR NEW.scope IS NOT OLD.scope OR NEW.id IS NOT OLD.id OR NEW.plan_key IS NOT OLD.plan_key OR NEW.plan_version IS NOT OLD.plan_version OR NEW.due_on IS NOT OLD.due_on OR NEW.reminder_on IS NOT OLD.reminder_on OR NEW.reminder_time IS NOT OLD.reminder_time OR NEW.reminder_status IS NOT OLD.reminder_status OR NEW.reminder_at_utc IS NOT OLD.reminder_at_utc OR NEW.status IS NOT OLD.status OR NEW.version IS NOT OLD.version OR NEW.created_at IS NOT OLD.created_at OR NEW.completed_at IS NOT OLD.completed_at OR NEW.completed_by IS NOT OLD.completed_by OR NEW.completed_by_name IS NOT OLD.completed_by_name OR NEW.completion_notes IS NOT OLD.completion_notes;
END;
--> statement-breakpoint
DROP TRIGGER task_plan_batteries_insert_identity;
--> statement-breakpoint
DROP TRIGGER task_plan_batteries_no_update;
--> statement-breakpoint
CREATE TABLE __new_task_plan_batteries (key text PRIMARY KEY NOT NULL,plan_key text NOT NULL REFERENCES task_plans(key),battery_key text NOT NULL);
--> statement-breakpoint
INSERT INTO __new_task_plan_batteries(key,plan_key,battery_key) SELECT key,plan_key,battery_key FROM task_plan_batteries;
--> statement-breakpoint
DROP TABLE task_plan_batteries;
--> statement-breakpoint
ALTER TABLE __new_task_plan_batteries RENAME TO task_plan_batteries;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_task_plan_battery ON task_plan_batteries(plan_key,battery_key);
--> statement-breakpoint
CREATE TABLE task_target_retentions (scope text NOT NULL,plan_key text NOT NULL REFERENCES task_plans(key),battery_key text NOT NULL REFERENCES purged_batteries(key),actor_id text NOT NULL REFERENCES staff_accounts(id),actor_auth_version integer NOT NULL,plan_version integer NOT NULL,PRIMARY KEY(plan_key,battery_key));
--> statement-breakpoint
CREATE TRIGGER task_target_retentions_insert BEFORE INSERT ON task_target_retentions
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: retained deleted Task target requires the loaded existing assignment and native administrator') WHERE NOT EXISTS(SELECT 1 FROM task_plan_batteries t JOIN task_plans p ON p.key=t.plan_key JOIN purged_batteries deleted ON deleted.key=t.battery_key AND deleted.scope=p.scope JOIN staff_accounts a ON a.id=NEW.actor_id AND a.auth_version=NEW.actor_auth_version AND a.role='admin' AND a.active=1 JOIN operations o ON o.scope=p.scope AND o.kind='task_plan_change' AND json_extract(o.result_json,'$.id')=p.id AND json_extract(o.result_json,'$.version')=p.version+1 WHERE p.key=NEW.plan_key AND p.scope=NEW.scope AND p.version=NEW.plan_version AND t.battery_key=NEW.battery_key);
END;
--> statement-breakpoint
CREATE TRIGGER task_target_retentions_no_update BEFORE UPDATE ON task_target_retentions
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: loaded Task target retention cannot be changed');
END;
--> statement-breakpoint
CREATE TRIGGER task_plan_batteries_insert_identity BEFORE INSERT ON task_plan_batteries
BEGIN
    SELECT RAISE(ABORT, 'task battery identity invalid') WHERE NOT EXISTS(SELECT 1 FROM task_plans p JOIN batteries b ON b.scope=p.scope WHERE p.key=NEW.plan_key AND b.key=NEW.battery_key AND NEW.key=p.key || '/' || b.id) AND NOT EXISTS(SELECT 1 FROM task_target_retentions retained JOIN task_plans p ON p.key=retained.plan_key AND p.scope=retained.scope AND p.version=retained.plan_version+1 JOIN purged_batteries deleted ON deleted.key=retained.battery_key AND deleted.scope=p.scope WHERE retained.plan_key=NEW.plan_key AND retained.battery_key=NEW.battery_key AND NEW.key=p.key || '/' || deleted.id);
    SELECT RAISE(ABORT, 'task battery replacement forbidden') WHERE EXISTS(SELECT 1 FROM task_plan_batteries WHERE key=NEW.key OR (plan_key=NEW.plan_key AND battery_key=NEW.battery_key));
END;
--> statement-breakpoint
CREATE TRIGGER task_plan_batteries_no_update BEFORE UPDATE ON task_plan_batteries
BEGIN
 SELECT RAISE(ABORT,'task battery targets are immutable; replace the reviewed assignment');
END;
--> statement-breakpoint
DROP TRIGGER teaching_groups_update;
--> statement-breakpoint
CREATE TRIGGER teaching_groups_update BEFORE UPDATE ON teaching_groups
BEGIN
    SELECT RAISE(ABORT,'CONSTRAINT: teaching group identity and owner are immutable') WHERE NEW.key IS NOT OLD.key OR NEW.scope IS NOT OLD.scope OR NEW.id IS NOT OLD.id OR NEW.owner_account_id IS NOT OLD.owner_account_id OR NEW.created_at IS NOT OLD.created_at;
    SELECT RAISE(ABORT,'CONSTRAINT: teaching group changes require current version and active state') WHERE OLD.state<>'active' OR NEW.version<>OLD.version+1;
    SELECT RAISE(ABORT,'CONSTRAINT: archiving preserves teaching group membership and details') WHERE NEW.state='archived' AND (NEW.name IS NOT OLD.name OR NEW.notes IS NOT OLD.notes OR NEW.member_ids_json IS NOT OLD.member_ids_json);
    SELECT RAISE(ABORT,'CONSTRAINT: teaching group members must be distinct batteries in its inventory') WHERE (SELECT COUNT(*) FROM json_each(NEW.member_ids_json))<>(SELECT COUNT(DISTINCT value) FROM json_each(NEW.member_ids_json)) OR EXISTS(SELECT 1 FROM json_each(NEW.member_ids_json) j WHERE j.type<>'text' OR NOT EXISTS(SELECT 1 FROM batteries WHERE scope=NEW.scope AND id=j.value) AND NOT (EXISTS(SELECT 1 FROM purged_batteries WHERE scope=NEW.scope AND id=j.value) AND EXISTS(SELECT 1 FROM json_each(OLD.member_ids_json) previous WHERE previous.value=j.value)));
END;
--> statement-breakpoint
CREATE TRIGGER retired_operations_no_replace BEFORE INSERT ON operations
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: retired asset request outcomes cannot be replaced') WHERE EXISTS(SELECT 1 FROM operations WHERE id=NEW.id AND (kind IN ('retired_asset','retired_asset_rejected') OR NEW.kind IN ('retired_asset','retired_asset_rejected')));
END;
--> statement-breakpoint
CREATE TRIGGER retired_operations_no_update BEFORE UPDATE ON operations WHEN NOT (EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 WHERE c.scope=OLD.scope AND c.kind='purge' AND a.role='admin'))
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: retired asset request outcomes are immutable') WHERE OLD.kind IN ('retired_asset','retired_asset_rejected') OR NEW.kind IN ('retired_asset','retired_asset_rejected');
END;
--> statement-breakpoint
CREATE TRIGGER retired_operations_no_delete BEFORE DELETE ON operations
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: retired asset request outcomes must remain reserved') WHERE OLD.kind IN ('retired_asset','retired_asset_rejected') OR json_extract(OLD.result_json,'$.purgedBatteryIds') IS NOT NULL;
END;
--> statement-breakpoint
CREATE TRIGGER recovered_audit_no_update BEFORE UPDATE ON audit_events WHEN NOT (EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 WHERE c.scope=OLD.scope AND c.kind='purge' AND a.role='admin'))
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: recovery evidence is immutable') WHERE OLD.action='battery_recovered' OR NEW.action='battery_recovered';
END;
--> statement-breakpoint
CREATE TRIGGER recovered_audit_no_delete BEFORE DELETE ON audit_events WHEN NOT (EXISTS(SELECT 1 FROM retired_asset_context c JOIN staff_accounts a ON a.id=c.actor_id AND a.auth_version=c.actor_auth_version AND a.active=1 WHERE c.scope=OLD.scope AND c.kind='purge' AND a.role='admin') AND EXISTS(SELECT 1 FROM purged_batteries WHERE id=OLD.battery_id AND scope=OLD.scope))
BEGIN
 SELECT RAISE(ABORT,'CONSTRAINT: recovery evidence cannot be deleted') WHERE OLD.action='battery_recovered';
END;
--> statement-breakpoint
CREATE TABLE inventory_evidence_revisions (scope text PRIMARY KEY NOT NULL,version integer NOT NULL CHECK(version>=0));
--> statement-breakpoint
INSERT INTO inventory_evidence_revisions(scope,version) SELECT DISTINCT scope,0 FROM operations WHERE 1 ON CONFLICT(scope) DO NOTHING;
--> statement-breakpoint
INSERT INTO inventory_evidence_revisions(scope,version) SELECT DISTINCT scope,0 FROM audit_events WHERE 1 ON CONFLICT(scope) DO NOTHING;
--> statement-breakpoint
INSERT INTO inventory_evidence_revisions(scope,version) SELECT DISTINCT scope,0 FROM task_cycles WHERE 1 ON CONFLICT(scope) DO NOTHING;
--> statement-breakpoint
INSERT INTO inventory_evidence_revisions(scope,version) SELECT DISTINCT scope,0 FROM intake_sessions WHERE 1 ON CONFLICT(scope) DO NOTHING;
--> statement-breakpoint
INSERT INTO inventory_evidence_revisions(scope,version) SELECT DISTINCT scope,0 FROM teaching_group_operations WHERE 1 ON CONFLICT(scope) DO NOTHING;
--> statement-breakpoint
INSERT INTO inventory_evidence_revisions(scope,version) SELECT DISTINCT scope,0 FROM teaching_group_events WHERE 1 ON CONFLICT(scope) DO NOTHING;
--> statement-breakpoint
CREATE TRIGGER operations_evidence_revision_insert AFTER INSERT ON operations
BEGIN
 INSERT INTO inventory_evidence_revisions(scope,version) VALUES(NEW.scope,1) ON CONFLICT(scope) DO UPDATE SET version=version+1;
END;
--> statement-breakpoint
CREATE TRIGGER operations_evidence_revision_update AFTER UPDATE ON operations
BEGIN
 INSERT INTO inventory_evidence_revisions(scope,version) VALUES(NEW.scope,1) ON CONFLICT(scope) DO UPDATE SET version=version+1;
END;
--> statement-breakpoint
CREATE TRIGGER operations_evidence_revision_delete AFTER DELETE ON operations
BEGIN
 INSERT INTO inventory_evidence_revisions(scope,version) VALUES(OLD.scope,1) ON CONFLICT(scope) DO UPDATE SET version=version+1;
END;
--> statement-breakpoint
CREATE TRIGGER audit_events_evidence_revision_insert AFTER INSERT ON audit_events
BEGIN
 INSERT INTO inventory_evidence_revisions(scope,version) VALUES(NEW.scope,1) ON CONFLICT(scope) DO UPDATE SET version=version+1;
END;
--> statement-breakpoint
CREATE TRIGGER audit_events_evidence_revision_update AFTER UPDATE ON audit_events
BEGIN
 INSERT INTO inventory_evidence_revisions(scope,version) VALUES(NEW.scope,1) ON CONFLICT(scope) DO UPDATE SET version=version+1;
END;
--> statement-breakpoint
CREATE TRIGGER audit_events_evidence_revision_delete AFTER DELETE ON audit_events
BEGIN
 INSERT INTO inventory_evidence_revisions(scope,version) VALUES(OLD.scope,1) ON CONFLICT(scope) DO UPDATE SET version=version+1;
END;
--> statement-breakpoint
CREATE TRIGGER task_cycles_evidence_revision_insert AFTER INSERT ON task_cycles
BEGIN
 INSERT INTO inventory_evidence_revisions(scope,version) VALUES(NEW.scope,1) ON CONFLICT(scope) DO UPDATE SET version=version+1;
END;
--> statement-breakpoint
CREATE TRIGGER task_cycles_evidence_revision_update AFTER UPDATE ON task_cycles
BEGIN
 INSERT INTO inventory_evidence_revisions(scope,version) VALUES(NEW.scope,1) ON CONFLICT(scope) DO UPDATE SET version=version+1;
END;
--> statement-breakpoint
CREATE TRIGGER task_cycles_evidence_revision_delete AFTER DELETE ON task_cycles
BEGIN
 INSERT INTO inventory_evidence_revisions(scope,version) VALUES(OLD.scope,1) ON CONFLICT(scope) DO UPDATE SET version=version+1;
END;
--> statement-breakpoint
CREATE TRIGGER intake_sessions_evidence_revision_insert AFTER INSERT ON intake_sessions
BEGIN
 INSERT INTO inventory_evidence_revisions(scope,version) VALUES(NEW.scope,1) ON CONFLICT(scope) DO UPDATE SET version=version+1;
END;
--> statement-breakpoint
CREATE TRIGGER intake_sessions_evidence_revision_update AFTER UPDATE ON intake_sessions
BEGIN
 INSERT INTO inventory_evidence_revisions(scope,version) VALUES(NEW.scope,1) ON CONFLICT(scope) DO UPDATE SET version=version+1;
END;
--> statement-breakpoint
CREATE TRIGGER intake_sessions_evidence_revision_delete AFTER DELETE ON intake_sessions
BEGIN
 INSERT INTO inventory_evidence_revisions(scope,version) VALUES(OLD.scope,1) ON CONFLICT(scope) DO UPDATE SET version=version+1;
END;
--> statement-breakpoint
CREATE TRIGGER teaching_group_operations_evidence_revision_insert AFTER INSERT ON teaching_group_operations
BEGIN
 INSERT INTO inventory_evidence_revisions(scope,version) VALUES(NEW.scope,1) ON CONFLICT(scope) DO UPDATE SET version=version+1;
END;
--> statement-breakpoint
CREATE TRIGGER teaching_group_operations_evidence_revision_update AFTER UPDATE ON teaching_group_operations
BEGIN
 INSERT INTO inventory_evidence_revisions(scope,version) VALUES(NEW.scope,1) ON CONFLICT(scope) DO UPDATE SET version=version+1;
END;
--> statement-breakpoint
CREATE TRIGGER teaching_group_operations_evidence_revision_delete AFTER DELETE ON teaching_group_operations
BEGIN
 INSERT INTO inventory_evidence_revisions(scope,version) VALUES(OLD.scope,1) ON CONFLICT(scope) DO UPDATE SET version=version+1;
END;
--> statement-breakpoint
CREATE TRIGGER teaching_group_events_evidence_revision_insert AFTER INSERT ON teaching_group_events
BEGIN
 INSERT INTO inventory_evidence_revisions(scope,version) VALUES(NEW.scope,1) ON CONFLICT(scope) DO UPDATE SET version=version+1;
END;
--> statement-breakpoint
CREATE TRIGGER teaching_group_events_evidence_revision_update AFTER UPDATE ON teaching_group_events
BEGIN
 INSERT INTO inventory_evidence_revisions(scope,version) VALUES(NEW.scope,1) ON CONFLICT(scope) DO UPDATE SET version=version+1;
END;
--> statement-breakpoint
CREATE TRIGGER teaching_group_events_evidence_revision_delete AFTER DELETE ON teaching_group_events
BEGIN
 INSERT INTO inventory_evidence_revisions(scope,version) VALUES(OLD.scope,1) ON CONFLICT(scope) DO UPDATE SET version=version+1;
END;
