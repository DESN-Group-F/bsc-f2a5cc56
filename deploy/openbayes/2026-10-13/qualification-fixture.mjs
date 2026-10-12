import { Miniflare } from "miniflare";
import { randomBytes, randomUUID, webcrypto } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [release, project, credentialFile] = process.argv.slice(2);
if (!release || !project || !credentialFile) throw new Error("Select the synthetic qualification release, project and private credential file.");
const previous = "2026-10-12-workspace-1.0.0", data = path.join(project, `data-${previous}`), now = new Date().toISOString();
const runtime = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('synthetic release fixture')}}", compatibilityDate: "2026-05-15", d1Databases: { DB: "battery-inventory-portable" }, d1Persist: path.join(data, "d1") });
try {
  const db = await runtime.getD1Database("DB"), journal = JSON.parse(await readFile(path.join(release, "migrations/meta/_journal.json"), "utf8"));
  for (const entry of journal.entries) await db.batch((await readFile(path.join(release, "migrations", `${entry.tag}.sql`), "utf8")).split("--> statement-breakpoint").filter(sql => sql.trim()).map(sql => db.prepare(sql)));
  await db.prepare("CREATE TABLE portable_migrations(name TEXT PRIMARY KEY,sha256 TEXT NOT NULL,applied_at TEXT NOT NULL)").run();
  for (const entry of JSON.parse(await readFile(path.join(release, "migration-compatibility.json"), "utf8")).entries) await db.prepare("INSERT INTO portable_migrations VALUES(?,?,?)").bind(entry.name, entry.sha256, now).run();
  const password = randomBytes(24).toString("base64url"), salt = randomBytes(32).toString("hex"), encoder = new TextEncoder();
  const key = await webcrypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const passwordHash = Buffer.from(await webcrypto.subtle.deriveBits({ name: "PBKDF2", salt: encoder.encode(salt), iterations: 600000, hash: "SHA-256" }, key, 256)).toString("hex");
  const accountId = randomUUID(), personId = `staff-${accountId}`, scope = "shared:demo", ownerKey = `${scope}/${personId}`, buildingKey = `${scope}/J18`;
  for (let index = 0; index < 8; index++) await db.prepare("INSERT INTO staff_accounts(id,username,display_name,role,password_hash,password_salt,hash_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(index ? randomUUID() : accountId, index ? `qualification-staff-${index}` : "qualification-admin", index ? `Fictional qualification staff ${index}` : "Fictional qualification administrator", index ? "staff" : "admin", passwordHash, salt, 600000, now, now).run();
  await db.prepare("INSERT INTO workspaces(scope,created_at) VALUES(?,?)").bind(scope, now).run();
  await db.prepare("INSERT INTO shared_inventories(dataset,scope) VALUES('demo',?)").bind(scope).run();
  await db.prepare("INSERT INTO people(key,scope,id,name,role,account_id) VALUES(?,?,?,?,'staff',?)").bind(ownerKey, scope, personId, "Fictional qualification administrator", accountId).run();
  await db.prepare("INSERT INTO buildings(key,scope,id,name) VALUES(?,?,'J18','Willis Annexe')").bind(buildingKey, scope).run();
  await db.prepare("INSERT INTO batteries(key,scope,id,name,owner_key,home_building_key,created_at) VALUES(?,?,'QA-PRESERVED','Fictional preserved battery',?,?,?)").bind(`${scope}/QA-PRESERVED`, scope, ownerKey, buildingKey, now).run();
  await writeFile(credentialFile, JSON.stringify({ username: "qualification-admin", password, accountId }) + "\n", { mode: 0o600 });
} finally { await runtime.dispose(); }
await writeFile(path.join(data, "upgrade-complete.json"), JSON.stringify({ deploymentName: previous, migrations: 23, schemaVerified: true, originalPreserved: true }) + "\n", { mode: 0o600 });
console.log(JSON.stringify({ event: "synthetic_predecessor_ready", accounts: 8, migrations: 23, realBusinessDatabaseAccessed: false }));
