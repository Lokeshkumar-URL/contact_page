export async function processBatch({ items, concurrency = 3, processor, beforeEach = async () => true }) {
  if (!Array.isArray(items) || !items.length) return { completed: [], unprocessed: [] };
  const queue = [...items]; const completed = []; let halted = false;
  async function worker() {
    while (!halted) {
      const allowed = await beforeEach(); if (!allowed) { halted = true; break; }
      const item = queue.shift(); if (!item) break;
      try { completed.push({ item, value: await processor(item) }); } catch (error) { completed.push({ item, error }); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => worker()));
  return { completed, unprocessed: queue };
}
