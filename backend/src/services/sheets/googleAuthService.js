import { google } from 'googleapis';
import { env } from '../../config/env.js';

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

export function createGoogleAuth(credentials = {}) {
  const clientEmail = credentials.clientEmail ?? env.googleServiceAccountEmail;
  const privateKey = (credentials.privateKey ?? env.googlePrivateKey)?.replace(/\\n/g, '\n');
  if (!clientEmail || !privateKey) throw new Error('Google service-account credentials are not configured.');
  return new google.auth.JWT({ email: clientEmail, key: privateKey, scopes: [SHEETS_SCOPE] });
}

export function createSheetsClient(credentials) {
  return google.sheets({ version: 'v4', auth: createGoogleAuth(credentials) });
}
