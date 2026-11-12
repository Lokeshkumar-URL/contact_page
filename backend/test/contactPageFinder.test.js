import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ContactPageNotFoundError,
  findContactPage,
  rankContactCandidates,
  scoreContactCandidate,
  validateSelectedCandidate,
} from '../src/services/browser/contactPageFinder.js';
import { resolveContactLink } from '../src/services/claude/contactLinkResolver.js';

function mockPage({ baseUrl = 'https://example.com/', links = [], paths = {} } = {}) {
  let currentUrl = baseUrl; const calls = { evaluate: 0, goto: [] };
  return {
    calls,
    url: () => currentUrl,
    evaluate: async () => { calls.evaluate += 1; return links; },
    goto: async (url) => {
      calls.goto.push(url); const outcome = paths[new URL(url).pathname];
      if (!outcome) throw new Error('404');
      currentUrl = outcome.redirect ?? url;
      return { status: () => outcome.status ?? 200 };
    },
  };
}

test('candidate ranking prefers same-site contact navigation and removes unsafe links', () => {
  const ranked = rankContactCandidates([
    { href: '/about', text: 'About', context: 'nav' },
    { href: '/contact-us', text: 'Contact us', context: 'footer' },
    { href: 'https://evil.example/contact', text: 'Contact', context: 'nav' },
    { href: 'mailto:test@example.com', text: 'Email us', context: 'footer' },
  ], 'https://example.com/');
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].url, 'https://example.com/contact-us');
  assert.ok(ranked[0].score >= 55);
  assert.ok(scoreContactCandidate({ url: 'https://example.com/careers', text: 'Careers', context: 'footer' }).score < 0);
});

test('rule-based discovery selects a strong link without Claude or path probes', async () => {
  const page = mockPage({ links: [{ href: '/contact', text: 'Contact', context: 'nav' }] });
  let claudeCalls = 0;
  const result = await findContactPage({ page, resolveWithClaude: async () => { claudeCalls += 1; } });
  assert.equal(result.url, 'https://example.com/contact'); assert.equal(result.method, 'rules');
  assert.equal(claudeCalls, 0); assert.equal(page.calls.goto.length, 0);
});

test('common paths are tried when scanned links are not reliable', async () => {
  const page = mockPage({ links: [], paths: { '/contact-us': { status: 200 } } });
  const result = await findContactPage({ page, commonPaths: ['/missing', '/contact-us'] });
  assert.equal(result.url, 'https://example.com/contact-us'); assert.equal(result.method, 'common-path');
  assert.equal(page.calls.goto.length, 2);
});

test('Claude is used only for uncertain candidates and its choice is validated', async () => {
  const page = mockPage({ links: [{ href: '/sales', text: 'Sales', context: 'body' }] });
  const result = await findContactPage({ page, commonPaths: [], resolveWithClaude: async (candidates) => ({ url: candidates[0].url }) });
  assert.equal(result.method, 'claude'); assert.equal(result.url, 'https://example.com/sales');
  assert.equal(validateSelectedCandidate('https://evil.example/contact', [result], 'https://example.com/'), null);
});

test('discovery records a typed failure when no reliable page exists', async () => {
  const page = mockPage({ links: [{ href: '/about', text: 'About', context: 'nav' }] });
  await assert.rejects(() => findContactPage({ page, commonPaths: [], resolveWithClaude: async () => ({ url: 'https://evil.example/contact' }) }), (error) => error instanceof ContactPageNotFoundError && error.code === 'CONTACT_PAGE_NOT_FOUND' && error.retryable === false);
});

test('Claude resolver sends only candidates and rejects invented selections', async () => {
  const candidates = [{ url: 'https://example.com/sales', text: 'Sales', context: 'body', score: 25 }];
  let request;
  const client = { messages: { create: async (input) => { request = input; return { content: [{ type: 'text', text: '{"url":"https://example.com/sales","confidence":"medium"}' }] }; } } };
  const selection = await resolveContactLink({ client, model: 'test-model', candidates });
  assert.equal(selection.url, candidates[0].url); assert.doesNotMatch(request.messages[0].content, /<html/i);
  const badClient = { messages: { create: async () => ({ content: [{ type: 'text', text: '{"url":"https://evil.example/contact","confidence":"high"}' }] }) } };
  await assert.rejects(() => resolveContactLink({ client: badClient, model: 'test-model', candidates }), /outside the validated candidate list/);
});
