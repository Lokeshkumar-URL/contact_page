import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NavigationError, assertSafePublicUrl, isPrivateAddress, navigateSafely } from '../src/services/browser/navigationService.js';
import { chooseSafePopupAction, closeCommonPopups } from '../src/services/browser/popupHandler.js';

const publicDns = async () => [{ address: '93.184.216.34' }];
const response = (status = 200, redirects = 0) => ({ status: () => status, request: () => ({ redirectChain: () => Array.from({ length: redirects }) }) });

test('URL safety blocks credentials, unsafe protocols, localhost, and private addresses', async () => {
  assert.equal(isPrivateAddress('127.0.0.1'), true); assert.equal(isPrivateAddress('192.168.1.2'), true); assert.equal(isPrivateAddress('93.184.216.34'), false); assert.equal(isPrivateAddress('::1'), true);
  for (const url of ['file:///tmp/a', 'http://user:pass@example.com', 'http://localhost', 'http://10.0.0.1']) await assert.rejects(() => assertSafePublicUrl(url, publicDns), NavigationError);
  assert.equal((await assertSafePublicUrl('https://example.com/path#part', publicDns)).href, 'https://example.com/path');
});

test('navigation reports redirects and successful final URLs', async () => {
  const page = { current: '', goto: async function () { this.current = 'https://example.com/contact'; return response(200, 1); }, url() { return this.current; } };
  const result = await navigateSafely({ page, url: 'https://example.com', resolveHost: publicDns });
  assert.equal(result.redirected, true); assert.equal(result.redirectCount, 1); assert.equal(result.status, 200);
});

test('timeouts, HTTP errors, excessive redirects, and private redirects are typed failures', async () => {
  const timeoutPage = { goto: async () => { const error = new Error('Navigation timeout'); error.name = 'TimeoutError'; throw error; }, url: () => '' };
  await assert.rejects(() => navigateSafely({ page: timeoutPage, url: 'https://example.com', resolveHost: publicDns }), (error) => error.code === 'NAVIGATION_TIMEOUT' && error.retryable);
  const serverError = { goto: async () => response(503), url: () => 'https://example.com' };
  await assert.rejects(() => navigateSafely({ page: serverError, url: 'https://example.com', resolveHost: publicDns }), (error) => error.code === 'HTTP_ERROR' && error.retryable && error.status === 503);
  const loop = { goto: async () => response(200, 6), url: () => 'https://example.com' };
  await assert.rejects(() => navigateSafely({ page: loop, url: 'https://example.com', resolveHost: publicDns }), (error) => error.code === 'TOO_MANY_REDIRECTS');
  const privateRedirect = { goto: async () => response(), url: () => 'http://127.0.0.1/admin' };
  await assert.rejects(() => navigateSafely({ page: privateRedirect, url: 'https://example.com', resolveHost: publicDns }), (error) => error.code === 'PRIVATE_NETWORK_BLOCKED');
});

test('popup policy prefers rejection or closing and never accepts consent', () => {
  const action = chooseSafePopupAction([{ text: 'Accept all' }, { text: 'Reject all' }, { text: 'Close' }]); assert.equal(action.text, 'Reject all');
  assert.equal(chooseSafePopupAction([{ text: 'Accept cookies' }, { text: 'I agree' }]), null);
  assert.equal(chooseSafePopupAction([{ text: 'No thanks' }]).text, 'No thanks');
});

test('popup handler performs bounded safe passes', async () => {
  const outcomes = [{ text: 'Reject all', type: 'reject' }, { text: 'Close', type: 'close' }, null];
  const page = { calls: 0, evaluate: async function () { const value = outcomes[this.calls]; this.calls += 1; return value; } };
  const result = await closeCommonPopups({ page, maxPasses: 5, waitBetweenPasses: 0 });
  assert.equal(result.handled, 2); assert.equal(page.calls, 3); assert.deepEqual(result.actions.map((item) => item.type), ['reject','close']);
});
