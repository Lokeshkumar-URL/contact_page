import { createCipheriv, createDecipheriv, createPrivateKey, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import { AppError } from '../../errors/AppError.js';
import { createJsonStore } from '../auth/jsonStore.js';

const MAX_ACCOUNTS_PER_USER = 10;
const lower = (value) => String(value ?? '').trim().toLowerCase();
const publicAccount = (a) => ({ id: a.id, label: a.label, clientEmail: a.clientEmail, createdAt: a.createdAt });

/** Accepts the downloaded service-account JSON (string or object) and returns the two values we need. */
export function parseServiceAccount(input) {
  let json = input;
  if (typeof input === 'string') { try { json = JSON.parse(input); } catch { throw new AppError(400, 'INVALID_CREDENTIALS_FILE', 'That is not valid JSON. Paste the full contents of the service-account key file.'); } }
  const clientEmail = String(json?.client_email ?? json?.clientEmail ?? '').trim();
  const privateKey = String(json?.private_key ?? json?.privateKey ?? '').replace(/\\n/g, '\n');
  if (!clientEmail.includes('@') || !privateKey.includes('PRIVATE KEY')) throw new AppError(400, 'INVALID_CREDENTIALS_FILE', 'The JSON must contain "client_email" and "private_key" (a Google service-account key).');
  try { createPrivateKey(privateKey); } catch { throw new AppError(400, 'INVALID_PRIVATE_KEY', 'The private key could not be read. Re-download the key file from Google Cloud.'); }
  return { clientEmail, privateKey };
}

/**
 * Per-user Google service accounts. Private keys are encrypted at rest (AES-256-GCM) with a key
 * derived from the server secret, and are only ever decrypted server-side to open a Sheets connection.
 */
export function createGoogleAccountStore({ filePath, getSecret }) {
  const store = createJsonStore({ filePath, init(state) { state.accounts ??= []; } });
  const deriveKey = async () => Buffer.from(hkdfSync('sha256', String(await getSecret()), 'formpilot-google-accounts', 'aes-256-gcm', 32));

  async function encrypt(plain) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', await deriveKey(), iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
  }
  async function decrypt(box) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', await deriveKey(), Buffer.from(box.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString('utf8');
    } catch { throw new AppError(500, 'ACCOUNT_UNREADABLE', 'This saved Google account can no longer be decrypted (the server secret changed). Remove it and add it again.'); }
  }

  return {
    list: (ownerId) => store.read((s) => s.accounts.filter((a) => a.ownerId === ownerId).map(publicAccount)),

    async add(ownerId, { label, credentials }) {
      const { clientEmail, privateKey } = parseServiceAccount(credentials);
      const encryptedKey = await encrypt(privateKey);
      return store.mutate((s) => {
        const mine = s.accounts.filter((a) => a.ownerId === ownerId);
        if (mine.length >= MAX_ACCOUNTS_PER_USER) throw new AppError(409, 'TOO_MANY_ACCOUNTS', `You can save up to ${MAX_ACCOUNTS_PER_USER} Google accounts.`);
        if (mine.some((a) => lower(a.clientEmail) === lower(clientEmail))) throw new AppError(409, 'ACCOUNT_EXISTS', 'You have already added this Google account.');
        const account = { id: randomUUID(), ownerId, label: label?.trim() || clientEmail, clientEmail, encryptedKey, createdAt: new Date().toISOString() };
        s.accounts.push(account);
        return publicAccount(account);
      });
    },

    async remove(ownerId, id) {
      await store.mutate((s) => {
        const before = s.accounts.length;
        s.accounts = s.accounts.filter((a) => !(a.id === id && a.ownerId === ownerId));
        if (s.accounts.length === before) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Google account not found.');
      });
    },

    /** Returns { clientEmail, privateKey } for the owner's account; never for someone else's. */
    async resolve(ownerId, id) {
      const account = await store.read((s) => s.accounts.find((a) => a.id === id && a.ownerId === ownerId));
      if (!account) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'The selected Google account was not found. Choose another one in Settings.');
      return { clientEmail: account.clientEmail, privateKey: await decrypt(account.encryptedKey) };
    },
  };
}
