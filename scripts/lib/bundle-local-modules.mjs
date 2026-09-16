import path from 'node:path';

// The userscript is a single classic script. Keep each local ESM module in its
// own closure so private names and exported bindings cannot collide.
export function bundleLocalModules(sources, entries) {
  const visiting = new Set();
  const built = new Set();
  const chunks = ['const localModules = Object.create(null);'];
  function visit(id) {
    if (built.has(id)) return;
    if (visiting.has(id)) throw new Error(`Circular userscript module: ${id}`);
    const source = sources[id];
    if (typeof source !== 'string') throw new Error(`Missing userscript module: ${id}`);
    visiting.add(id);
    const bindings = [];
    let body = source.replace(/^import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?\s*$/gm, (_, names, request) => {
      if (!request.startsWith('./') && !request.startsWith('../')) throw new Error(`External userscript import: ${request}`);
      const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(id), request));
      if (dependency.startsWith('../')) throw new Error('Userscript import leaves the repository.');
      visit(dependency);
      const pairs = names.split(',').map(value => value.trim()).filter(Boolean).map(value => {
        const match = value.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
        if (!match) throw new Error(`Unsupported userscript binding: ${value}`);
        return match[2] ? `${match[1]}: ${match[2]}` : match[1];
      });
      bindings.push(`const { ${pairs.join(', ')} } = localModules[${JSON.stringify(dependency)}];`);
      return '';
    });
    const exports = [];
    body = body.replace(/^export\s+((?:async\s+)?function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm, (_, type, name) => {
      exports.push(name);
      return `${type} ${name}`;
    });
    if (/^\s*(?:import|export)\s/m.test(body)) throw new Error(`Unsupported userscript module syntax: ${id}`);
    chunks.push(`localModules[${JSON.stringify(id)}] = (() => {\n${bindings.join('\n')}\n${body}\nreturn Object.freeze({ ${exports.join(', ')} });\n})();`);
    visiting.delete(id);
    built.add(id);
  }
  entries.forEach(visit);
  return chunks.join('\n');
}
