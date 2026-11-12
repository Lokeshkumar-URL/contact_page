export function parseClaudeJson(text) {
  const cleaned = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(cleaned); } catch { throw new Error('Claude returned invalid JSON.'); }
}
export function validateClaudeResponse(text, schema) { return schema.parse(parseClaudeJson(text)); }
