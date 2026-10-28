const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const ts = require('typescript');

// Runs server-side TS units with explicit mocks, no database or build output.
// Type checking remains the responsibility of tsc --noEmit.
module.exports = function createLoader(mocks = {}) {
  const cache = new Map();
  const root = path.resolve(__dirname, '../..');
  function load(filename) {
    filename = path.resolve(root, filename);
    if (cache.has(filename)) return cache.get(filename).exports;
    const mod = { exports: {} };
    cache.set(filename, mod);
    const nativeRequire = createRequire(filename);
    function localRequire(id) {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      if (id.startsWith('.') || id.startsWith('@/')) {
        const target = id.startsWith('@/')
          ? path.join(root, 'src', id.slice(2))
          : path.resolve(path.dirname(filename), id);
        for (const candidate of [
          target,
          `${target}.ts`,
          path.join(target, 'index.ts')
        ]) {
          if (candidate.endsWith('.ts') && fs.existsSync(candidate))
            return load(candidate);
        }
        if (id.startsWith('@/')) return nativeRequire(target);
      }
      return nativeRequire(id);
    }
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true
      },
      fileName: filename
    }).outputText;
    const wrapper = vm.runInThisContext(
      `(function(require,module,exports,__filename,__dirname){${compiled}\n})`,
      { filename }
    );
    wrapper(localRequire, mod, mod.exports, filename, path.dirname(filename));
    return mod.exports;
  }
  return load;
};
