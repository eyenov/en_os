import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SourceTextModule, SyntheticModule } from 'node:vm';

const root = fileURLToPath(new URL('..', import.meta.url));

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(entries.map((entry) => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(filename);
    return /\.(m?js)$/.test(entry.name) ? [filename] : [];
  }));
  return groups.flat();
}

const files = (await Promise.all(['public/js', 'server', 'scripts', 'tests']
  .map((directory) => sourceFiles(path.join(root, directory))))).flat();
const modules = new Map();
const builtins = new Map();

for (const filename of files) {
  const identifier = pathToFileURL(filename).href;
  const module = new SourceTextModule(await readFile(filename, 'utf8'), { identifier });
  modules.set(identifier, module);
  for (const specifier of module.dependencySpecifiers) {
    if (!specifier.startsWith('.')) continue;
    await access(new URL(specifier, identifier));
  }
}

for (const module of modules.values()) {
  if (module.status !== 'unlinked') continue;
  await module.link(async (specifier, referencingModule) => {
    if (specifier.startsWith('.')) {
      const target = modules.get(new URL(specifier, referencingModule.identifier).href);
      assert.ok(target, `Missing module: ${specifier}`);
      return target;
    }
    assert.ok(specifier.startsWith('node:'), `Unexpected static dependency: ${specifier}`);
    if (!builtins.has(specifier)) {
      const namespace = await import(specifier);
      builtins.set(specifier, new SyntheticModule(Object.keys(namespace), function () {}));
    }
    return builtins.get(specifier);
  });
}

const html = await readFile(path.join(root, 'public/videos.html'), 'utf8');
for (const resource of ['/css/base.css', '/css/studio.css', '/js/videos.js']) {
  assert.ok(html.includes(`"${resource}"`), `Missing studio resource: ${resource}`);
  await access(path.join(root, 'public', resource));
}
assert.ok(!html.includes('rail-chat'), 'Retired standalone chat must not return');
console.log(`Checked ${files.length} JavaScript modules, relative imports and studio resources.`);