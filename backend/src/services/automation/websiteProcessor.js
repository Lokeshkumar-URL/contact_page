import { logger } from '../../utils/logger.js';
import { createBrowser } from '../browser/browserManager.js';
import { navigateSafely } from '../browser/navigationService.js';
import { closeCommonPopups } from '../browser/popupHandler.js';
import { findAlternateFormPage, findContactPage } from '../browser/contactPageFinder.js';
import { extractForms, selectContactForm } from '../browser/formExtractor.js';
import { mapFieldsWithClaudeFallback } from '../claude/fieldMappingResolver.js';
import { createSafeContactLinkFallback } from '../claude/contactLinkResolver.js';
import { createSafeSubmitControlFallback } from '../claude/submitControlResolver.js';
import { ensureFieldsStillFilled, fillForm } from '../browser/formFiller.js';
import { captureScreenshot } from '../browser/screenshotService.js';
import { submitForm } from '../browser/formSubmitter.js';
import { verifySubmission } from '../browser/submissionVerifier.js';
import { solveFormImageCaptcha, solveMathCaptcha } from '../captcha/imageCaptchaSolver.js';
import { detectCaptcha, CaptchaBlockedError } from '../captcha/detection/index.js';
import { guardAgainstBrowserChallenge, waitForWidgetCaptcha } from '../captcha/detection/workflowSteps.js';
import { CAPTCHA_TYPES, classifyCaptchas, describeCaptcha, solveMathQuestion } from '../captcha/captchaClassifier.js';
import { ManualReviewError } from '../browser/manualReview.js';
import { isVerificationComplete } from '../captcha/detection/verificationMonitor.js';
import { solveWidgetCapSolver, isCapSolverResponseReady } from '../captcha/capSolverWidget.js';
import { solveWidgetOhMyCaptcha } from '../captcha/ohMyCaptchaWidget.js';
import { env } from '../../config/env.js';
import { getApprovedCustomFields, recordFieldSuggestions } from '../mappings/fieldMappingRegistry.js';

const defaultManagers = new Map(); // one shared browser per mode, so switching Visible/Headless takes effect without a restart
const defaults = { solveWidgetCapSolver, isCapSolverResponseReady, isVerificationComplete, solveWidgetOhMyCaptcha, navigateSafely, closeCommonPopups, findContactPage, findAlternateFormPage, extractForms, selectContactForm, mapFieldsWithClaudeFallback, createSafeContactLinkFallback, createSafeSubmitControlFallback, fillForm, captureScreenshot, submitForm, verifySubmission, solveFormImageCaptcha, solveMathCaptcha, waitForWidgetCaptcha, detectCaptcha, guardAgainstBrowserChallenge, getApprovedCustomFields, recordFieldSuggestions, ensureFieldsStillFilled };

async function getDefaultManager(config = {}) {
  // A container/server normally has no graphical display. When the deployment
  // explicitly requires headless Chrome, do not let a previously saved UI
  // preference for "visible" mode make Puppeteer fail during launch.
  const headless = env.headless === true || config.browserMode !== 'visible';
  const cached = defaultManagers.get(headless);
  if (cached) {
    const manager = await cached.catch(() => null);
    if (manager && !['closed', 'closing', 'disconnected', 'failed'].includes(manager.state)) return manager;
  }
  const created = createBrowser({ headless, navigationTimeout: (config.timeoutSeconds ?? 45) * 1000 });
  defaultManagers.set(headless, created); created.catch(() => defaultManagers.delete(headless));
  return created;
}

// Pages are opened at DOMContentLoaded, but many sites run scripts at the full "load" event that reset
// their forms (e.g. mild2wild.com wiped typed names). Wait for load, then a short settle, before typing.
async function waitForPageSettled(context, timeout) {
  if (typeof context?.waitForFunction !== 'function') return;
  await context.waitForFunction(() => document.readyState === 'complete', { timeout, polling: 200 }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 500));
}

function abortIfRequested(signal) {
  if (signal?.aborted) { const error = new Error('Website processing was stopped.'); error.code = 'RUN_STOPPED'; error.stage = 'automation'; error.retryable = false; throw error; }
}

export async function processWebsite(row, options = {}) {
  const { runId = 'standalone', config = {}, profile = config.contactProfile ?? {}, signal, claudeClient, claudeModel, claudeTracker, browserManager, previousSubmissionUncertain = false, liveConfirmed = config.liveConfirmed === true, services = {}, captchaSettings = { provider: env.captchaProvider, capSolver: { apiKey: env.capSolverApiKey, timeoutMs: env.capSolverTimeoutMs }, ohMyCaptcha: { baseUrl: env.ohMyCaptchaUrl, clientKey: env.ohMyCaptchaClientKey, timeoutMs: env.ohMyCaptchaTimeoutMs }, apiKey: env.fastCaptchaApiKey, timeoutMs: env.fastCaptchaTimeoutMs, manualEntryTimeoutMs: env.captchaManualEntryTimeoutMs, mathEnabled: env.mathCaptchaEnabled, solvingEnabled: env.captchaSolvingEnabled }, confirmationTimeoutMs = env.submitConfirmationTimeoutMs ?? 90000 } = options;
  const api = { ...defaults, ...services }; const manager = browserManager ?? await getDefaultManager(config); let page; let screenshot = ''; let contactPageUrl = ''; let stage = 'setup'; let claudeUsed = false; let captchaTypes = []; const captchaOutcomes = {};
  // Third-party / automatic CAPTCHA solving is OFF unless CAPTCHA_SOLVING_ENABLED=true. Human verification is unaffected.
  const solvingEnabled = captchaSettings.solvingEnabled === true; const solverApiKey = solvingEnabled ? captchaSettings.apiKey : undefined;
  const capSolver = solvingEnabled && captchaSettings.provider === 'capsolver' ? { ...captchaSettings.capSolver, solvingEnabled } : undefined;
  const ohMyCaptcha = !capSolver && solvingEnabled && captchaSettings.ohMyCaptcha?.baseUrl ? { ...captchaSettings.ohMyCaptcha, solvingEnabled } : undefined;
  const humanVerifyMs = config.browserMode === 'visible' ? (captchaSettings.manualEntryTimeoutMs ?? 0) : 0;
  let widgetReceipt;
  const solveConfiguredWidget = async (context, formSelector) => {
    if (capSolver) { const result = await api.solveWidgetCapSolver({ page: context, formSelector, settings: capSolver, signal }); widgetReceipt = result.receipt; return result; }
    return api.solveWidgetOhMyCaptcha({ page: context, formSelector, settings: ohMyCaptcha, signal });
  };
  const responseReady = async (context, formSelector, detection) =>
    Boolean(widgetReceipt && await api.isCapSolverResponseReady({ page: context, formSelector, receipt: widgetReceipt, detection })) || await api.isVerificationComplete(page, detection);
  const guardChallenge = async () => { try { return await api.guardAgainstBrowserChallenge({ page, timeoutMs: humanVerifyMs, signal }); } catch (error) { if (error instanceof CaptchaBlockedError) { captchaTypes = ['cloudflare_challenge']; captchaOutcomes.cloudflare_challenge = 'blocked'; } throw error; } };
  try {
    abortIfRequested(signal); page = await manager.createPage();
    stage = 'navigation'; await api.navigateSafely({ page, url: row.url, timeout: (config.timeoutSeconds ?? 45) * 1000 }); await api.closeCommonPopups({ page });
    stage = 'captcha_detection'; await guardChallenge();
    abortIfRequested(signal); stage = 'contact_discovery';
    const resolveWithClaude = api.createSafeContactLinkFallback({ client: claudeClient, model: claudeModel, tracker: claudeTracker, websiteKey: row.url });
    const homepageUrl = page.url(); let contact;
    try { contact = await api.findContactPage({ page, baseUrl: homepageUrl, resolveWithClaude, timeout: Math.min((config.timeoutSeconds ?? 45) * 1000, 15000) }); }
    catch (error) { if (error?.code !== 'CONTACT_PAGE_NOT_FOUND') throw error; contact = { url: homepageUrl, method: 'homepage' }; } // Some sites put the contact form on the homepage itself.
    contactPageUrl = contact.url; claudeUsed ||= contact.method === 'claude';
    if (page.url() !== contact.url) await api.navigateSafely({ page, url: contact.url, timeout: (config.timeoutSeconds ?? 45) * 1000 });
    await api.closeCommonPopups({ page }); stage = 'captcha_detection'; await guardChallenge(); abortIfRequested(signal);
    stage = 'form_detection'; let extracted;
    try { extracted = await api.extractForms({ page, timeout: Math.min((config.timeoutSeconds ?? 45) * 1000, 8000) }); }
    catch (error) {
      if (error?.code !== 'FORM_NOT_FOUND') throw error;
      const alternate = await api.findAlternateFormPage({ page, baseUrl: contactPageUrl, resolveWithClaude }); contactPageUrl = alternate.url; claudeUsed ||= alternate.method === 'alternate-claude';
      await api.navigateSafely({ page, url: alternate.url, timeout: (config.timeoutSeconds ?? 45) * 1000 }); await api.closeCommonPopups({ page });
      extracted = await api.extractForms({ page, timeout: Math.min((config.timeoutSeconds ?? 45) * 1000, 8000) });
    }
    const forms = Array.isArray(extracted) ? extracted : extracted.forms; const form = Array.isArray(extracted) ? api.selectContactForm(forms).selected : extracted.selectedForm ?? api.selectContactForm(forms).selected; const formContext = Array.isArray(extracted) ? page : extracted.context ?? page;
    stage = 'field_mapping'; const registryFields=await api.getApprovedCustomFields(row.url);const effectiveProfile={...profile,customFields:[...(profile.customFields??[]),...registryFields]};const mapped = await api.mapFieldsWithClaudeFallback({ fields: form.fields, profile:effectiveProfile, client: claudeClient, model: claudeModel }); claudeUsed ||= mapped.claudeUsed === true;
    if(mapped.unresolved.length)await api.recordFieldSuggestions({websiteUrl:row.url,contactPageUrl,fields:mapped.unresolved});
    stage = 'captcha_detection'; const captchaDetection = await api.detectCaptcha(page); const detectedWidgets = captchaDetection?.captchas ?? []; stage = 'form_filling';
    const extractorHasCaptcha = Array.isArray(extracted) ? forms.some((candidate) => candidate.hasCaptcha) : extracted.pageHasCaptcha === true || extracted.hasCaptcha === true; const pageHasCaptcha = extractorHasCaptcha || detectedWidgets.some((item) => item.requiresVerification && item.type !== 'cloudflare_challenge'); const manualEntryTimeoutMs = humanVerifyMs; const imageCaptchaSolvable = Boolean(form.imageCaptcha && (solverApiKey || capSolver || ohMyCaptcha || manualEntryTimeoutMs > 0)); const widgetCaptchaSolvable = pageHasCaptcha && Boolean(capSolver || ohMyCaptcha || manualEntryTimeoutMs > 0);
    const mathEnabled = solvingEnabled && captchaSettings.mathEnabled !== false; const mathCaptchaSolvable = Boolean(form.mathCaptcha && ((mathEnabled && solveMathQuestion(form.mathCaptcha.question) !== null) || manualEntryTimeoutMs > 0));
    captchaTypes = classifyCaptchas({ form, pageHasCaptcha, captchaKind: (Array.isArray(extracted) ? null : extracted.captchaKind) ?? ({ recaptcha: 'recaptcha', hcaptcha: 'hcaptcha', turnstile: 'turnstile' }[detectedWidgets.find((item) => item.requiresVerification)?.provider] ?? null), passiveCaptchaKinds: detectedWidgets.filter((item) => item.type === 'recaptcha_v3').map(() => 'recaptcha_v3') });
    for (const type of captchaTypes) if (CAPTCHA_TYPES[type]?.passive) captchaOutcomes[type] = 'detected_passive';
    await waitForPageSettled(formContext, Math.min((config.timeoutSeconds ?? 45) * 1000, 10000));
    const fill = await api.fillForm({ page: formContext, mappings: mapped.mappings, form, pageHasCaptcha, previousSubmissionUncertain, imageCaptchaSolvable, widgetCaptchaSolvable, mathCaptchaSolvable, timeout: Math.min((config.timeoutSeconds ?? 45) * 1000, 10000) });
    let captcha = null; if (form.imageCaptcha) { abortIfRequested(signal); stage = 'captcha'; captcha = await api.solveFormImageCaptcha({ page: formContext, captcha: form.imageCaptcha, apiKey: solverApiKey, timeoutMs: captchaSettings.timeoutMs, manualEntryTimeoutMs, mathEnabled, solvingEnabled, ohMyCaptcha, capSolver, signal }); captchaOutcomes[form.imageCaptcha.math ? 'math' : 'text'] = captcha.method; }
    if (form.mathCaptcha) { abortIfRequested(signal); stage = 'captcha'; captcha = await api.solveMathCaptcha({ page: formContext, captcha: form.mathCaptcha, autoAnswer: mathEnabled, manualEntryTimeoutMs, solvingEnabled }); captchaOutcomes.math = captcha.method; }
    if (widgetCaptchaSolvable) { abortIfRequested(signal); stage = 'captcha'; try {
      if (capSolver || ohMyCaptcha) {
        try { captcha = await solveConfiguredWidget(formContext, form.selector); }
        catch (error) { if (signal?.aborted) throw error; logger.warn('Automatic CAPTCHA solving failed; falling back to manual verification', { code: error.code ?? 'WIDGET_SOLVE_FAILED', reason: error.message }); if (!manualEntryTimeoutMs) { throw new ManualReviewError([{ code: 'CAPTCHA', message: `Automatic widget solving failed: ${error.message}`, selector: form.selector ?? '' }]); } }
      }
      if (!['ohmycaptcha','capsolver'].includes(captcha?.method)) captcha = await api.waitForWidgetCaptcha({ page, timeoutMs: manualEntryTimeoutMs, signal, detection: captchaDetection?.requiresVerification ? captchaDetection : undefined }); } catch (error) { for (const type of captchaTypes) if (CAPTCHA_TYPES[type]?.needsPerson) captchaOutcomes[type] = error.captchaStatus === 'timeout' ? 'timeout' : 'needs_person'; throw error; } for (const type of captchaTypes) if (CAPTCHA_TYPES[type]?.needsPerson) captchaOutcomes[type] = captcha.method; }
    abortIfRequested(signal); stage = 'pre_submit_check'; await api.ensureFieldsStillFilled({ page: formContext, mappings: (fill.filled ?? []).map((result) => result.mapping).filter((mapping) => mapping?.selector), timeout: Math.min((config.timeoutSeconds ?? 45) * 1000, 10000) });
    abortIfRequested(signal); stage = 'screenshot'; screenshot = await api.captureScreenshot({ page, runId, rowNumber: row.rowNumber, stage: config.dryRun === false ? 'pre-submit' : 'dry-run' });
    // A widget may be added or become visible after the initial form scan.
    // Always inspect immediately before submitting, including when the early scan found nothing.
    stage = 'captcha'; abortIfRequested(signal);
    const currentDetection = await api.detectCaptcha(page);
    if (currentDetection?.error && typeof page.evaluate === 'function') throw new ManualReviewError([{ code: 'CAPTCHA', message: 'CAPTCHA detection failed before submission; submission was blocked.', selector: form.selector ?? '' }]);
    const requiredDetection = currentDetection?.requiresVerification ? currentDetection : captchaDetection;
    if (requiredDetection?.requiresVerification) {
      const newlyDetected = requiredDetection.captchas.filter((item) => item.requiresVerification).map((item) => item.type);
      captchaTypes = [...new Set([...captchaTypes, ...newlyDetected])];
      if (!await responseReady(formContext, form.selector, requiredDetection)) {
        // Initial verification failures already stop the workflow. This path also catches widgets
        // that loaded late and verification that expired during form preparation.
        if (!pageHasCaptcha && (capSolver || ohMyCaptcha)) {
          try { captcha = await solveConfiguredWidget(formContext, form.selector); }
          catch (error) { if (signal?.aborted) throw error; logger.warn('Late CAPTCHA solving failed; falling back to manual verification', { code: error.code ?? 'WIDGET_SOLVE_FAILED', reason: error.message }); }
        }
        if (!await responseReady(formContext, form.selector, requiredDetection)) {
          if (!manualEntryTimeoutMs) throw new ManualReviewError([{ code: 'CAPTCHA', message: 'CAPTCHA verification is incomplete or expired. Submission was blocked; complete the challenge in the current browser.', selector: form.selector ?? '' }]);
          captcha = await api.waitForWidgetCaptcha({ page, timeoutMs: manualEntryTimeoutMs, signal, detection: requiredDetection, logger });
        }
        if (!await responseReady(formContext, form.selector, requiredDetection)) throw new ManualReviewError([{ code: 'CAPTCHA', message: 'CAPTCHA is still unverified after waiting. Submission was blocked.', selector: form.selector ?? '' }]);
      }
      for (const type of newlyDetected) captchaOutcomes[type] = captcha?.method ?? 'widget-auto';
    }
    stage = 'submission'; const resolveSubmitButton = api.createSafeSubmitControlFallback({ client: claudeClient, model: claudeModel, tracker: claudeTracker, websiteKey: row.url }); const submission = await api.submitForm({ page: formContext, form, dryRun: config.dryRun !== false, liveConfirmed, screenshotPath: screenshot, submissionKey: `${runId}:${row.rowNumber}`, timeout: Math.max(confirmationTimeoutMs, (config.timeoutSeconds ?? 45) * 1000), capture: async () => screenshot, waitForResult: api.verifySubmission, resolveSubmitButton }); claudeUsed ||= submission.claudeUsed === true;
    const dryRun = config.dryRun !== false;
    if (!dryRun) for (const type of Object.keys(captchaOutcomes)) if (captchaOutcomes[type] === 'capsolver') captchaOutcomes[type] = 'capsolver_accepted';
    if (!dryRun) { stage = 'success_screenshot'; screenshot = await api.captureScreenshot({ page, runId, rowNumber: row.rowNumber, stage: 'success' }); }
    return { status: 'Success', reason: dryRun ? (widgetReceipt ? 'Dry run completed; form was not submitted. CAPTCHA response acceptance was not tested.' : 'Dry run completed; form was not submitted.') : '', screenshot, contactPageUrl, claudeUsed, verificationEvidence: submission.verificationEvidence, dryRun, metrics: { mappedFields: mapped.mappings.length, filledFields: fill.filled.length, unresolvedFields: mapped.unresolved.length, captchaMethod: captcha?.method ?? null }, captcha: describeCaptcha(captchaTypes, captchaOutcomes), captchaType: captchaTypes.join(',') };
  } catch (error) {
    if (captchaTypes.length) {
      const outcomes = { ...captchaOutcomes };
      for (const type of captchaTypes) outcomes[type] ??= CAPTCHA_TYPES[type]?.needsPerson ? 'needs_person' : stage === 'captcha' ? 'failed' : 'not_reached';
      error.captcha ||= describeCaptcha(captchaTypes, outcomes); error.captchaType ||= captchaTypes.join(',');
    }
    error.stage ||= stage; error.contactPageUrl ||= contactPageUrl; error.claudeUsed ||= claudeUsed || claudeTracker?.get(row.url)?.claudeUsed === true;
    if (!error.screenshot && page) { try { error.screenshot = await api.captureScreenshot({ page, runId, rowNumber: row.rowNumber, stage: error.code === 'MANUAL_REVIEW' ? 'manual-review' : 'failed' }); } catch { /* Preserve the original processing error. */ } }
    throw error;
  } finally { if (page) await manager.safeClosePage(page); }
}//
