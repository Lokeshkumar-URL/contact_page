// Holds the signed-in user's session token. Kept in localStorage so a refresh does not sign you out.
const KEY = 'formpilot.session';
const listeners = new Set();
const storage = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };

function read() {
  try { const value = JSON.parse(storage()?.getItem(KEY) ?? 'null'); return value?.token && Date.parse(value.expiresAt) > Date.now() ? value : null; } catch { return null; }
}

let current = read();

export const getSessionToken = () => current?.token ?? '';

export function setSession(session) {
  current = session ? { token: session.token, expiresAt: session.expiresAt } : null;
  try { current ? storage()?.setItem(KEY, JSON.stringify(current)) : storage()?.removeItem(KEY); } catch { /* storage unavailable */ }
  listeners.forEach((listener) => listener(current));
}

export const clearSession = () => setSession(null);

export function subscribeSession(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
