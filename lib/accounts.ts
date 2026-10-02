import { z } from "zod";
import { DomainError, datasetSchema } from "./domain";
import { constantEqual, digest, passwordHash, PASSWORD_ITERATIONS, randomToken, SESSION_SECONDS } from "./credentials";

export type StaffRole = "admin" | "staff";
export type StaffUser = { id: string; username: string; displayName: string; email: string; role: StaffRole; active: boolean; version: number; authVersion: number; defaultDataset: "demo" | "live"; createdAt: string; updatedAt: string };
type Row = Record<string, unknown>;
const username = z.string().trim().toLowerCase().min(2).max(64).regex(/^[a-z0-9][a-z0-9._-]+$/, "Use letters, numbers, dots, underscores or hyphens for the username.");
const password = z.string().min(12, "Use a password with at least 12 characters.").max(128);
const profile = z.object({ displayName: z.string().trim().min(2).max(120), email: z.union([z.literal(""), z.string().trim().email().max(254)]).default(""), defaultDataset: datasetSchema.default("demo") });
const accountInput = profile.extend({ username, role: z.enum(["admin", "staff"]), password });
const publicColumns = "id,username,display_name,email,role,active,version,auth_version,default_dataset,created_at,updated_at";
function publicUser(row: Row): StaffUser {
    return { id: String(row.id), username: String(row.username), displayName: String(row.display_name), email: String(row.email), role: row.role as StaffRole, active: row.active === 1, version: Number(row.version), authVersion: Number(row.auth_version), defaultDataset: row.default_dataset as "demo" | "live", createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}
export class AccountStore {
    constructor(private db: D1Database, private clock: () => Date = () => new Date()) {}
    private statement(sql: string, ...values: unknown[]) { return this.db.prepare(sql).bind(...values); }
    private async row(id: string) {
        const row = await this.statement("SELECT * FROM staff_accounts WHERE id=?", id).first<Row>();
        if (!row) throw new DomainError(404, "Account not found.");
        return row;
    }
    async needsSetup() { return Number(await this.statement("SELECT COUNT(*) FROM staff_accounts").first("COUNT(*)")) === 0; }
    async user(id: string) { return publicUser(await this.row(id)); }
    async authenticate(token: string | null): Promise<StaffUser | null> {
        if (!token) return null;
        const row = await this.statement(`SELECT a.* FROM staff_sessions s JOIN staff_accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>? AND a.active=1 AND s.auth_version=a.auth_version`, await digest(token), this.clock().toISOString()).first<Row>();
        return row ? publicUser(row) : null;
    }
    async signOut(token: string | null) {
        if (token) await this.statement("DELETE FROM staff_sessions WHERE token_hash=?", await digest(token)).run();
    }
    private audit(action: string, actor: Pick<StaffUser, "id" | "displayName">, targetId: string, details: unknown, at: string, guard: string, values: unknown[]) {
        return this.statement(`INSERT INTO staff_account_events(id,action,actor_id,actor_name,target_id,at,details_json,guard) SELECT ?,?,?,?,?,?,?,(${guard})`, crypto.randomUUID(), action, actor.id, actor.displayName, targetId, at, JSON.stringify(details), ...values);
    }
    private actorGuard(actor: StaffUser, admin: boolean) {
        return { sql: `EXISTS (SELECT 1 FROM staff_accounts WHERE id=? AND active=1 AND auth_version=?${admin ? " AND role='admin'" : ""})`, values: [actor.id, actor.authVersion] };
    }
    private async commit(statements: D1PreparedStatement[]) {
        try { await this.db.batch(statements); }
        catch (error) {
            const text = String(error);
            if (/last active administrator/i.test(text)) throw new DomainError(409, "Keep at least one active administrator.");
            if (/UNIQUE/i.test(text)) throw new DomainError(409, "That username is already registered.");
            if (/CHECK|guard/i.test(text)) throw new DomainError(409, "The account or your permissions changed. Reload before saving.", "record_conflict");
            throw error;
        }
    }
    async create(input: unknown, actor?: StaffUser) {
        if (actor && actor.role !== "admin") throw new DomainError(403, "Only administrators can create staff accounts.");
        const value = accountInput.parse(input), id = crypto.randomUUID(), at = this.clock().toISOString(), salt = randomToken();
        if (!actor && value.role !== "admin") throw new DomainError(400, "The first account must be an administrator.");
        const hash = await passwordHash(value.password, salt);
        const guard = actor ? this.actorGuard(actor, true) : { sql: "(SELECT COUNT(*) FROM staff_accounts)=0", values: [] };
        await this.commit([
            this.audit(actor ? "account_created" : "administrator_initialized", actor ?? { id, displayName: value.displayName }, id, { username: value.username, role: value.role, displayName: value.displayName, email: value.email }, at, guard.sql, guard.values),
            this.statement("INSERT INTO staff_accounts(id,username,display_name,email,role,password_hash,password_salt,hash_iterations,default_dataset,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)", id, value.username, value.displayName, value.email, value.role, hash, salt, PASSWORD_ITERATIONS, value.defaultDataset, at, at),
        ]);
        return this.user(id);
    }
    async signIn(input: unknown) {
        const value = z.object({ username, password: z.string().min(1).max(128) }).parse(input), key = await digest(value.username), now = this.clock(), at = now.toISOString();
        const attempt = await this.statement("SELECT * FROM sign_in_attempts WHERE key=?", key).first<Row>();
        const windowStart = new Date(now.getTime() - 15 * 60_000).toISOString();
        if (attempt && String(attempt.window_started_at) > windowStart && Number(attempt.failures) >= 10) throw new DomainError(429, "Too many unsuccessful attempts. Try again in 15 minutes.");
        const row = await this.statement("SELECT * FROM staff_accounts WHERE username=?", value.username).first<Row>();
        const candidate = await passwordHash(value.password, String(row?.password_salt ?? "unregistered-account-timing-salt"), Number(row?.hash_iterations ?? PASSWORD_ITERATIONS));
        if (!row || row.active !== 1 || !constantEqual(candidate, String(row.password_hash))) {
            await this.statement("INSERT INTO sign_in_attempts(key,failures,window_started_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET failures=CASE WHEN window_started_at<=? THEN 1 ELSE failures+1 END,window_started_at=CASE WHEN window_started_at<=? THEN ? ELSE window_started_at END", key, at, windowStart, windowStart, at).run();
            throw new DomainError(401, "The username or password is incorrect, or this account is disabled.");
        }
        const token = randomToken(), expires = new Date(now.getTime() + SESSION_SECONDS * 1000).toISOString();
        await this.commit([
            this.statement("DELETE FROM sign_in_attempts WHERE key=?", key),
            this.statement("DELETE FROM staff_sessions WHERE expires_at<=?", at),
            this.statement("INSERT INTO staff_sessions(token_hash,account_id,auth_version,created_at,expires_at) SELECT ?,id,auth_version,?,? FROM staff_accounts WHERE id=? AND active=1 AND auth_version=?", await digest(token), at, expires, row.id, row.auth_version),
        ]);
        const authenticated = await this.authenticate(token);
        if (!authenticated) throw new DomainError(401, "The account changed during sign-in. Try again.");
        return { token, user: authenticated };
    }
    async list(actor: StaffUser) {
        if (actor.role !== "admin") throw new DomainError(403, "Only administrators can manage accounts.");
        const result = await this.statement(`SELECT ${publicColumns} FROM staff_accounts ORDER BY username`).all<Row>();
        const events = (await this.statement("SELECT id,action,actor_name AS actorName,target_id AS targetId,at,details_json FROM staff_account_events ORDER BY at DESC,rowid DESC LIMIT 200").all<Row>()).results.map(({ details_json, ...event }) => ({ ...event, details: JSON.parse(String(details_json)) }));
        return { accounts: result.results.map(publicUser), events };
    }
    async update(input: unknown, actor: StaffUser, self = false) {
        const value = profile.extend({ id: z.string().uuid(), expectedVersion: z.number().int().positive(), role: z.enum(["admin", "staff"]).optional(), active: z.boolean().optional(), password: password.optional() }).parse(input);
        if (self ? value.id !== actor.id || value.role !== undefined || value.active !== undefined || value.password !== undefined : actor.role !== "admin") throw new DomainError(403, "You do not have permission to change this account.");
        const before = await this.row(value.id), at = this.clock().toISOString();
        const role = self ? before.role : value.role ?? before.role, active = self ? before.active : value.active === undefined ? before.active : Number(value.active);
        if (!self && value.id === actor.id && active === 0) throw new DomainError(400, "Ask another administrator to disable your account.");
        const changedAuth = role !== before.role || active !== before.active || !!value.password;
        const salt = value.password ? randomToken() : String(before.password_salt), hash = value.password ? await passwordHash(value.password, salt) : String(before.password_hash);
        const guard = this.actorGuard(actor, !self);
        await this.commit([
            this.audit(self ? "profile_updated" : "account_updated", actor, value.id, { before: publicUser(before), after: { displayName: value.displayName, email: value.email, role, active: active === 1, defaultDataset: value.defaultDataset }, passwordReset: !!value.password }, at, `${guard.sql} AND EXISTS(SELECT 1 FROM staff_accounts WHERE id=? AND version=?)`, [...guard.values, value.id, value.expectedVersion]),
            this.statement("UPDATE staff_accounts SET display_name=?,email=?,role=?,active=?,password_hash=?,password_salt=?,hash_iterations=?,default_dataset=?,updated_at=?,version=version+1,auth_version=auth_version+? WHERE id=? AND version=?", value.displayName, value.email, role, active, hash, salt, PASSWORD_ITERATIONS, value.defaultDataset, at, Number(changedAuth), value.id, value.expectedVersion),
            ...(changedAuth ? [this.statement("DELETE FROM staff_sessions WHERE account_id=?", value.id)] : []),
        ]);
        return this.user(value.id);
    }
    async changePassword(input: unknown, actor: StaffUser) {
        const value = z.object({ currentPassword: z.string().min(1).max(128), newPassword: password }).parse(input), row = await this.row(actor.id);
        if (!constantEqual(await passwordHash(value.currentPassword, String(row.password_salt), Number(row.hash_iterations)), String(row.password_hash))) throw new DomainError(400, "The current password is incorrect.");
        const salt = randomToken(), hash = await passwordHash(value.newPassword, salt), at = this.clock().toISOString(), guard = this.actorGuard(actor, false);
        await this.commit([
            this.audit("password_changed", actor, actor.id, { sessionsRevoked: true }, at, `${guard.sql} AND EXISTS(SELECT 1 FROM staff_accounts WHERE id=? AND version=?)`, [...guard.values, actor.id, actor.version]),
            this.statement("UPDATE staff_accounts SET password_hash=?,password_salt=?,hash_iterations=?,auth_version=auth_version+1,version=version+1,updated_at=? WHERE id=? AND version=?", hash, salt, PASSWORD_ITERATIONS, at, actor.id, actor.version),
            this.statement("DELETE FROM staff_sessions WHERE account_id=?", actor.id),
        ]);
        return { signInRequired: true };
    }
}
