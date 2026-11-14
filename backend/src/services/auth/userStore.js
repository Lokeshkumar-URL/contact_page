import { randomBytes } from 'node:crypto';
import { createJsonStore } from './jsonStore.js';

/** Users, invitations and the session-signing secret, kept in one JSON file. */
export function createUserStore({ filePath, secret } = {}) {
  const store = createJsonStore({
    filePath,
    init(state) { state.users ??= []; state.invites ??= []; state.secret ??= randomBytes(48).toString('base64url'); },
  });
  return { ...store, async secret() { return secret || store.peek((state) => state.secret); } };
}
