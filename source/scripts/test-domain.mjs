import "./sites-env.mjs";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import ts from "typescript";
// Transpile only the domain under test. Real D1 semantics come from Miniflare.
await mkdir("work/qa",{recursive:true});
for(const name of ["battery-age","location-catalog","domain","fixtures","store","client-utils","accounts","credentials","shared-inventory","inventory-query","exports","downloads","return-path","task-schedule","task-plans","scan-session","movement-session","task-create-session"]){
  const source=await readFile(`lib/${name}.ts`,"utf8");
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/from "(\.\/[^"]+)"/g,(_,specifier)=>`from "${specifier}.mjs"`);
  await writeFile(`work/qa/${name}.mjs`,compiled);
}
const result=spawnSync(process.execPath,["--test","tests/domain.test.mjs","tests/staff.test.mjs","tests/battery-age.test.mjs","tests/battery-age-exports.test.mjs","tests/selected-exports.test.mjs","tests/inventory-filters.test.mjs","tests/workflow-reliability.test.mjs","tests/personal-inventory.test.mjs","tests/personal-activity.test.mjs","tests/location-catalog.test.mjs","tests/task-schedule.test.mjs","tests/task-plans.test.mjs","tests/scanning.test.mjs","tests/scan-session.test.mjs","tests/movement-session.test.mjs","tests/export-downloads.test.mjs","tests/export-unicode.test.mjs","tests/staff-choice-identity.test.mjs","tests/directory-import-traceability.test.mjs","tests/task-create-session.test.mjs","tests/scan-workflows-ui.test.mjs"],{stdio:"inherit",env:process.env});
process.exitCode=result.status??1;
