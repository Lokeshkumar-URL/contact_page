import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env.js';

export function createClaudeClient({ apiKey = env.anthropicApiKey, timeout = env.claudeTimeoutMs, maxRetries = env.claudeMaxRetries, required = false } = {}) {
  if (!apiKey) { if (required) throw new Error('ANTHROPIC_API_KEY is required.'); return null; }
  return new Anthropic({ apiKey, timeout, maxRetries });
}
