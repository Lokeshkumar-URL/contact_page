import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../errors/AppError.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { extractSpreadsheetId } from '../services/sheets/sheetId.js';

const accountBody = z.object({ label: z.string().trim().max(80).optional(), credentials: z.union([z.string().min(20).max(20000), z.record(z.string(), z.unknown())]) }).strict();
const testBody = z.object({ spreadsheetId: z.string().trim().min(1).max(300), sheetName: z.string().trim().max(100).optional(), googleAccountId: z.union([z.string().uuid(), z.literal('')]).optional() }).strict();

function explain(error, clientEmail) {
  const status = error?.code ?? error?.response?.status;
  const detail = String(error?.message ?? '');
  if (status === 404) return new AppError(404, 'SHEET_NOT_FOUND', 'No spreadsheet was found with that ID. Check the ID or URL.');
  if (status === 403) return new AppError(403, 'SHEET_NOT_SHARED', `This account can't open the sheet. Share it with ${clientEmail} as an Editor, and make sure the Google Sheets API is enabled for the project.`);
  if (/invalid_grant|invalid_client|unauthorized_client|DECODER|PEM/i.test(detail)) return new AppError(400, 'BAD_CREDENTIALS', 'Google rejected these credentials. Re-download the service-account key and add it again.');
  return new AppError(502, 'GOOGLE_UNREACHABLE', 'Could not reach Google Sheets. Please try again.');
}

export function createGoogleRouter({ accountStore, createSheetsClient, defaultAccount }) {
  const router = Router();
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  const ownerOf = (req) => req.user.id;

  router.get('/accounts', wrap(async (req, res) => res.json({ accounts: await accountStore.list(ownerOf(req)), serverDefault: defaultAccount() })));
  router.post('/accounts', validateRequest({ body: accountBody }), wrap(async (req, res) => res.status(201).json({ account: await accountStore.add(ownerOf(req), req.body) })));
  router.delete('/accounts/:id', validateRequest({ params: z.object({ id: z.string().uuid() }) }), wrap(async (req, res) => { await accountStore.remove(ownerOf(req), req.params.id); res.status(204).end(); }));

  // Checks that the chosen account can open the sheet, and lists its tabs.
  router.post('/test', validateRequest({ body: testBody }), wrap(async (req, res) => {
    const { googleAccountId, sheetName } = req.body;
    const spreadsheetId = extractSpreadsheetId(req.body.spreadsheetId);
    const credentials = googleAccountId ? await accountStore.resolve(ownerOf(req), googleAccountId) : undefined;
    const info = defaultAccount();
    const clientEmail = credentials?.clientEmail ?? info.clientEmail ?? 'the service account';
    if (!credentials && !info.configured) throw new AppError(400, 'NO_GOOGLE_ACCOUNT', 'No Google account is selected. Add one first.');
    try {
      const response = await createSheetsClient(credentials).spreadsheets.get({ spreadsheetId, fields: 'properties.title,sheets.properties.title' });
      const tabs = (response.data.sheets ?? []).map((s) => s.properties.title);
      const wanted = sheetName?.trim().toLowerCase();
      res.json({ ok: true, title: response.data.properties?.title ?? '', spreadsheetId, tabs, tabFound: wanted ? tabs.some((t) => t.toLowerCase() === wanted) : null, clientEmail });
    } catch (error) { throw explain(error, clientEmail); }
  }));
  return router;
}
