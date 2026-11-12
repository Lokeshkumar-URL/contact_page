import { createBrowser } from '../browser/browserManager.js';
import { navigateSafely } from '../browser/navigationService.js';
import { closeCommonPopups } from '../browser/popupHandler.js';
import { findContactPage } from '../browser/contactPageFinder.js';
import { extractForms, selectContactForm } from '../browser/formExtractor.js';
import { mapFieldsWithClaudeFallback } from '../claude/fieldMappingResolver.js';
import { createSafeContactLinkFallback } from '../claude/contactLinkResolver.js';
import { fillForm } from '../browser/formFiller.js';
import { captureScreenshot } from '../browser/screenshotService.js';
import { submitForm } from '../browser/formSubmitter.js';
import { verifySubmission } from '../browser/submissionVerifier.js';

let defaultManagerPromise;
const defaults = { navigateSafely, closeCommonPopups, findContactPage, extractForms, selectContactForm, mapFieldsWithClaudeFallback, createSafeContactLinkFallback, fillForm, captureScreenshot, submitForm, verifySubmission };

async function getDefaultManager(config = {}) {
  if (!defaultManagerPromise) defaultManagerPromise = createBrowser({ headless: config.browserMode !== 'visible', navigationTimeout: (config.timeoutSeconds ?? 45) * 1000 });
  return defaultManagerPromise;
}

function abortIfRequested(signal) {
  if (signal?.aborted) { const error = new Error('Website processing was stopped.'); error.code = 'RUN_STOPPED'; error.stage = 'automation'; error.retryable = false; throw error; }
}

export async function processWebsite(row, options = {}) {
  const { runId = 'standalone', config = {}, profile = config.contactProfile ?? {}, signal, claudeClient, claudeModel, claudeTracker, browserManager, previousSubmissionUncertain = false, liveConfirmed = config.liveConfirmed === true, services = {} } = options;
  const api = { ...defaults, ...services }; const manager = browserManager ?? await getDefaultManager(config); let page; let screenshot = ''; let contactPageUrl = ''; let stage = 'setup'; let claudeUsed = false;
  try {
    abortIfRequested(signal); page = await manager.createPage();
    stage = 'navigation'; await api.navigateSafely({ page, url: row.url, timeout: (config.timeoutSeconds ?? 45) * 1000 }); await api.closeCommonPopups({ page });
    abortIfRequested(signal); stage = 'contact_discovery';
    const resolveWithClaude = api.createSafeContactLinkFallback({ client: claudeClient, model: claudeModel, tracker: claudeTracker, websiteKey: row.url });
    const contact = await api.findContactPage({ page, baseUrl: page.url(), resolveWithClaude, timeout: Math.min((config.timeoutSeconds ?? 45) * 1000, 15000) }); contactPageUrl = contact.url; claudeUsed ||= contact.method === 'claude';
    if (page.url() !== contact.url) await api.navigateSafely({ page, url: contact.url, timeout: (config.timeoutSeconds ?? 45) * 1000 });
    await api.closeCommonPopups({ page }); abortIfRequested(signal);
    stage = 'form_detection'; const extracted = await api.extractForms({ page }); const forms = Array.isArray(extracted) ? extracted : extracted.forms; const form = Array.isArray(extracted) ? api.selectContactForm(forms).selected : extracted.selectedForm ?? api.selectContactForm(forms).selected;
    stage = 'field_mapping'; const mapped = await api.mapFieldsWithClaudeFallback({ fields: form.fields, profile, client: claudeClient, model: claudeModel }); claudeUsed ||= mapped.claudeUsed === true;
    stage = 'form_filling'; const pageHasCaptcha = Array.isArray(extracted) ? forms.some((candidate) => candidate.hasCaptcha) : extracted.pageHasCaptcha === true || extracted.hasCaptcha === true; const fill = await api.fillForm({ page, mappings: mapped.mappings, form, pageHasCaptcha, previousSubmissionUncertain, timeout: Math.min((config.timeoutSeconds ?? 45) * 1000, 10000) });
    abortIfRequested(signal); stage = 'screenshot'; screenshot = await api.captureScreenshot({ page, runId, rowNumber: row.rowNumber, stage: config.dryRun === false ? 'pre-submit' : 'dry-run' });
    stage = 'submission'; const submission = await api.submitForm({ page, form, dryRun: config.dryRun !== false, liveConfirmed, screenshotPath: screenshot, submissionKey: `${runId}:${row.rowNumber}`, timeout: (config.timeoutSeconds ?? 45) * 1000, capture: async () => screenshot, waitForResult: api.verifySubmission });
    const dryRun = config.dryRun !== false;
    if (!dryRun) { stage = 'success_screenshot'; screenshot = await api.captureScreenshot({ page, runId, rowNumber: row.rowNumber, stage: 'success' }); }
    return { status: 'Success', reason: dryRun ? 'Dry run completed; form was not submitted.' : '', screenshot, contactPageUrl, claudeUsed, verificationEvidence: submission.verificationEvidence, dryRun, metrics: { mappedFields: mapped.mappings.length, filledFields: fill.filled.length, unresolvedFields: mapped.unresolved.length } };
  } catch (error) {
    error.stage ||= stage; error.contactPageUrl ||= contactPageUrl; error.claudeUsed ||= claudeUsed;
    if (!error.screenshot && page) { try { error.screenshot = await api.captureScreenshot({ page, runId, rowNumber: row.rowNumber, stage: error.code === 'MANUAL_REVIEW' ? 'manual-review' : 'failed' }); } catch { /* Preserve the original processing error. */ } }
    throw error;
  } finally { if (page) await manager.safeClosePage(page); }
}
