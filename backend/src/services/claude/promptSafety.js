export class ClaudePromptLimitError extends Error { constructor(maxChars) { super(`Claude prompt exceeds the ${maxChars}-character safety limit.`); this.name = 'ClaudePromptLimitError'; this.code = 'CLAUDE_PROMPT_LIMIT'; } }
export function sanitizeText(value, maxLength = 240) { return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength); }
export function sanitizeMetadata(value, maxLength = 240) { return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength); }
export function boundedJson(value, maxChars = 12000) { const json = JSON.stringify(value); if (json.length > maxChars) throw new ClaudePromptLimitError(maxChars); return json; }
