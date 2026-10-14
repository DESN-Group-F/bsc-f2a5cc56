import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import ts from 'typescript';

test('mobile test imports are declared by the independent mobile package', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const declared = { ...manifest.dependencies, ...manifest.devDependencies };
  for (const filename of await readdir(new URL('./', import.meta.url))) {
    if (!filename.endsWith('.mjs')) continue;
    const source = await readFile(new URL(filename, import.meta.url), 'utf8');
    const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    function visit(node) {
      const specifier = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier;
      if (specifier && ts.isStringLiteral(specifier)) {
        const name = specifier.text;
        if (!name.startsWith('.') && !name.startsWith('/') && !isBuiltin(name)) {
          const packageName = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];
          assert.ok(Object.hasOwn(declared, packageName), `${filename} imports undeclared ${packageName}; ancestor dependencies cannot qualify the standalone tests.`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(parsed);
  }
});
