export class ClaudeUsageTracker {
  #records = new Map();
  record(websiteKey, operation, status = 'success') { const current = this.#records.get(websiteKey) ?? { claudeAttempted: false, claudeUsed: false, operations: [] }; current.claudeAttempted = true; current.claudeUsed ||= status === 'success'; current.operations.push({ operation, status }); this.#records.set(websiteKey, current); return this.get(websiteKey); }
  get(websiteKey) { return this.#records.get(websiteKey) ?? { claudeAttempted: false, claudeUsed: false, operations: [] }; }
}
