import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Tiny JSON-file store. Mutations run one at a time and are written atomically. */
export function createJsonStore({ filePath, init = () => {} } = {}) {
  let state = null;
  let queue = Promise.resolve();

  async function load() {
    if (state) return state;
    let parsed = {};
    try { parsed = JSON.parse(await readFile(filePath, 'utf8')); } catch { /* first run */ }
    state = parsed;
    init(state);
    return state;
  }

  async function persist() {
    if (!filePath) return;
    await mkdir(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
    await rename(temp, filePath);
  }

  function mutate(fn) {
    const run = queue.then(async () => { const current = await load(); const result = await fn(current); await persist(); return result; });
    queue = run.catch(() => {});
    return run;
  }

  return {
    mutate,
    // Waits for pending writes first, so a read right after a write sees it.
    async read(fn) { await queue.catch(() => {}); return fn(await load()); },
    // Does not wait for the write queue; safe to call from inside a mutation.
    async peek(fn) { return fn(await load()); },
  };
}
