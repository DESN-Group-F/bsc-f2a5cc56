import "./sites-env.mjs";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import ts from "typescript";
// Transpile only the domain under test. Real D1 semantics come from Miniflare.
await mkdir("work/qa",{recursive:true});
for(const name of ["domain","fixtures","store","client-utils"]){
  const source=await readFile(`lib/${name}.ts`,"utf8");
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/from "(\.\/[^"]+)"/g,(_,specifier)=>`from "${specifier}.mjs"`);
  await writeFile(`work/qa/${name}.mjs`,compiled);
}
const result=spawnSync(process.execPath,["--test","tests/domain.test.mjs"],{stdio:"inherit",env:process.env});
process.exitCode=result.status??1;
