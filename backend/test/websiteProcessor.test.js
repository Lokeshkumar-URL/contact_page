import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processWebsite } from '../src/services/automation/websiteProcessor.js';

function fixture({ failureAt } = {}) {
  const calls = []; const page = { current: 'about:blank', url() { return this.current; } };
  const manager = { createPage: async () => { calls.push('createPage'); return page; }, safeClosePage: async () => calls.push('closePage') };
  const step = (name, value) => async (...args) => { calls.push(name); if (failureAt === name) throw Object.assign(new Error(`${name} failed`), { code: 'FIXTURE_FAILURE' }); return typeof value === 'function' ? value(...args) : value; };
  const form = { selector: '#contact', fields: [{ index: 0, selector: '#email', required: true, fillable: true }], submitButtons: [{ selector: '#send', text: 'Send' }] };
  const services = {
    navigateSafely: step('navigate', (_args) => { page.current = _args.url; return { finalUrl: _args.url }; }), closeCommonPopups: step('popups', {}),
    createSafeContactLinkFallback: () => null, findContactPage: step('discover', { url: 'https://example.com/contact', method: 'rules' }), extractForms: step('extract', [form]), selectContactForm: (forms) => { calls.push('select'); return { selected: forms[0] }; },
    mapFieldsWithClaudeFallback: step('map', { mappings: [{ selector: '#email', value: 'a@example.com', field: form.fields[0] }], unresolved: [], claudeUsed: false }), getApprovedCustomFields:async()=>[],recordFieldSuggestions:async()=>[],fillForm: step('fill', { filled: [{}] }),
    captureScreenshot: step('screenshot', 'proof.png'), verifySubmission: step('verify', { outcome: 'success', evidence: 'Thank you' }), submitForm: step('submit', async (args) => { if (args.dryRun) return { verificationEvidence: 'Form filled and validated; submission skipped.' }; const result = await args.waitForResult(page, {}); return { verificationEvidence: result.evidence }; }),
  };
  return { calls, manager, services };
}

test('dry-run pipeline connects every stage, returns a terminal result, and closes the page', async () => {
  const setup = fixture(); const result = await processWebsite({ url: 'https://example.com', rowNumber: 2 }, { runId: 'run-1', config: { dryRun: true }, profile: { email: 'a@example.com' }, browserManager: setup.manager, services: setup.services });
  assert.equal(result.status, 'Success'); assert.equal(result.dryRun, true); assert.equal(result.contactPageUrl, 'https://example.com/contact'); assert.equal(result.screenshot, 'proof.png');
  assert.deepEqual(setup.calls, ['createPage','navigate','popups','discover','navigate','popups','extract','select','map','fill','screenshot','submit','closePage']);
});

test('confirmed live pipeline delegates result verification and reports evidence', async () => {
  const setup = fixture(); const result = await processWebsite({ url: 'https://example.com', rowNumber: 3 }, { runId: 'run-2', config: { dryRun: false }, liveConfirmed: true, browserManager: setup.manager, services: setup.services });
  assert.equal(result.status, 'Success'); assert.equal(result.dryRun, false); assert.equal(result.verificationEvidence, 'Thank you'); assert.ok(setup.calls.includes('verify')); assert.equal(setup.calls.filter((call) => call === 'screenshot').length, 2);
});

test('pipeline preserves stage, captures failure evidence, and always closes the page', async () => {
  const setup = fixture({ failureAt: 'fill' });
  await assert.rejects(() => processWebsite({ url: 'https://example.com', rowNumber: 4 }, { runId: 'run-3', config: { dryRun: true }, browserManager: setup.manager, services: setup.services }), (error) => error.code === 'FIXTURE_FAILURE' && error.stage === 'form_filling' && error.screenshot === 'proof.png');
  assert.equal(setup.calls.at(-1), 'closePage');
});

test('manual-review outcomes receive their own screenshot classification', async () => {
  const setup = fixture(); let capturedStage;
  setup.services.fillForm = async () => { throw Object.assign(new Error('CAPTCHA requires review'), { code: 'MANUAL_REVIEW' }); };
  setup.services.captureScreenshot = async ({ stage }) => { capturedStage = stage; return 'manual-review.png'; };
  await assert.rejects(() => processWebsite({ url: 'https://example.com', rowNumber: 6 }, { runId: 'run-4', config: { dryRun: true }, browserManager: setup.manager, services: setup.services }), (error) => error.code === 'MANUAL_REVIEW' && error.screenshot === 'manual-review.png');
  assert.equal(capturedStage, 'manual-review'); assert.equal(setup.calls.at(-1), 'closePage');
});

test('aborted work stops before opening a browser page', async () => {
  const setup = fixture();
  await assert.rejects(() => processWebsite({ url: 'https://example.com', rowNumber: 5 }, { signal: { aborted: true }, browserManager: setup.manager, services: setup.services }), (error) => error.code === 'RUN_STOPPED');
  assert.deepEqual(setup.calls, []);
});

test('pipeline follows an alternate Demo page when the Contact page has no form', async () => {
  const setup=fixture();const originalExtract=setup.services.extractForms;let first=true;
  setup.services.extractForms=async(...args)=>{if(first){first=false;setup.calls.push('extract');throw Object.assign(new Error('No form'),{code:'FORM_NOT_FOUND'});}return originalExtract(...args);};
  setup.services.findAlternateFormPage=async()=>{setup.calls.push('alternate');return {url:'https://example.com/book-a-demo',method:'alternate-rules'};};
  const result=await processWebsite({url:'https://example.com',rowNumber:7},{runId:'run-5',config:{dryRun:true},profile:{email:'a@example.com'},browserManager:setup.manager,services:setup.services});
  assert.equal(result.status,'Success');assert.equal(result.contactPageUrl,'https://example.com/book-a-demo');assert.equal(setup.calls.filter((call)=>call==='extract').length,2);assert.ok(setup.calls.includes('alternate'));
});

test('pipeline records unresolved fields and includes approved registry mappings', async () => {
  const setup=fixture();let recorded;setup.services.getApprovedCustomFields=async()=>[{fieldName:'Practice size',aliases:'Office count',value:'1-5'}];
  setup.services.mapFieldsWithClaudeFallback=async({profile})=>{assert.equal(profile.customFields[0].value,'1-5');return {mappings:[{selector:'#email',value:'a@example.com',field:{selector:'#email',required:true}}],unresolved:[{field:{selector:'#extra',label:'Extra field',type:'text',fillable:true}}],claudeUsed:false};};
  setup.services.recordFieldSuggestions=async(input)=>{recorded=input;return [];};
  await processWebsite({url:'https://example.com',rowNumber:8},{runId:'run-6',config:{dryRun:true},profile:{email:'a@example.com'},browserManager:setup.manager,services:setup.services});
  assert.equal(recorded.websiteUrl,'https://example.com');assert.equal(recorded.fields[0].field.label,'Extra field');
});

for (const dryRun of [true, false]) {
  test(`expired CAPTCHA blocks ${dryRun ? 'dry-run success' : 'live submission'} after a solver response`, async () => {
    const setup = fixture();
    setup.services.detectCaptcha = async () => ({ requiresVerification: true, captchas: [{ type: 'recaptcha_v2', provider: 'recaptcha', requiresVerification: true }] });
    setup.services.solveWidgetOhMyCaptcha = async () => ({ method: 'ohmycaptcha' });
    setup.services.isVerificationComplete = async () => false;
    await assert.rejects(processWebsite({ url: 'https://example.com', rowNumber: 15 }, {
      config: { dryRun, browserMode: 'headless' }, browserManager: setup.manager, services: setup.services,
      captchaSettings: { solvingEnabled: true, ohMyCaptcha: { baseUrl: 'http://127.0.0.1:8000' } },
    }), (error) => error.code === 'MANUAL_REVIEW' && /incomplete or expired/.test(error.message));
    assert.equal(setup.calls.includes('submit'), false);
    assert.equal(setup.calls.at(-1), 'closePage');
  });
}

test('late-loaded CAPTCHA missed by the initial scan blocks live submission', async () => {
  const setup = fixture(); let scans = 0;
  setup.services.detectCaptcha = async () => ++scans === 1
    ? { requiresVerification: false, captchas: [] }
    : { requiresVerification: true, captchas: [{ type: 'recaptcha_v2', provider: 'recaptcha', requiresVerification: true }] };
  setup.services.isVerificationComplete = async () => false;
  await assert.rejects(processWebsite({ url: 'https://example.com', rowNumber: 16 }, {
    config: { dryRun: false, browserMode: 'headless' }, browserManager: setup.manager, services: setup.services,
    captchaSettings: { solvingEnabled: false },
  }), (error) => error.code === 'MANUAL_REVIEW' && /incomplete or expired/.test(error.message) && error.captchaType === 'recaptcha_v2');
  assert.equal(setup.calls.includes('submit'), false);
});
test('late-loaded CAPTCHA resumes only after verification in the current browser', async () => {
  const setup = fixture(); let scans = 0; let verified = false;
  setup.services.detectCaptcha = async () => ++scans === 1
    ? { requiresVerification: false, captchas: [] }
    : { requiresVerification: true, captchas: [{ type: 'recaptcha_v2', provider: 'recaptcha', requiresVerification: true }] };
  setup.services.isVerificationComplete = async () => verified;
  setup.services.waitForWidgetCaptcha = async () => { verified = true; return { method: 'verified' }; };
  const result = await processWebsite({ url: 'https://example.com', rowNumber: 17 }, {
    config: { dryRun: false, browserMode: 'visible' }, browserManager: setup.manager, services: setup.services,
    captchaSettings: { solvingEnabled: false, manualEntryTimeoutMs: 1000 },
  });
  assert.equal(result.status, 'Success');
  assert.equal(result.captchaType, 'recaptcha_v2');
  assert.equal(setup.calls.includes('submit'), true);
});

test('CapSolver provider prepares an external response without using the Python solver or requiring a checkbox tick', async () => {
  const setup = fixture(); let capCalls = 0;
  setup.services.detectCaptcha = async () => ({ requiresVerification: true, captchas: [{ type: 'recaptcha_v2', provider: 'recaptcha', requiresVerification: true }] });
  setup.services.solveWidgetCapSolver = async () => { capCalls++; return { method: 'capsolver', receipt: {} }; };
  setup.services.solveWidgetOhMyCaptcha = async () => { throw new Error('Wrong provider'); };
  setup.services.isVerificationComplete = async () => false;
  setup.services.isCapSolverResponseReady = async () => true;
  const result = await processWebsite({ url: 'https://example.com', rowNumber: 20 }, {
    config: { dryRun: true, browserMode: 'headless' }, browserManager: setup.manager, services: setup.services,
    captchaSettings: { solvingEnabled: true, provider: 'capsolver', capSolver: { apiKey: 'test' }, ohMyCaptcha: { baseUrl: 'http://127.0.0.1:8000' } },
  });
  assert.equal(capCalls, 1);
  assert.match(result.reason, /acceptance was not tested/);
  assert.match(result.captcha, /acceptance unverified/);
});
test('CapSolver failures cannot fall through to a live submit in headless mode', async () => {
  const setup = fixture();
  setup.services.detectCaptcha = async () => ({ requiresVerification: true, captchas: [{ type: 'recaptcha_v2', provider: 'recaptcha', requiresVerification: true }] });
  setup.services.solveWidgetCapSolver = async () => { throw Object.assign(new Error('Set CAPSOLVER_API_KEY'), { code: 'CAPSOLVER_KEY_MISSING' }); };
  await assert.rejects(processWebsite({ url: 'https://example.com', rowNumber: 21 }, {
    config: { dryRun: false, browserMode: 'headless' }, browserManager: setup.manager, services: setup.services,
    captchaSettings: { solvingEnabled: true, provider: 'capsolver', capSolver: {} },
  }), (error) => error.code === 'MANUAL_REVIEW' && /CAPSOLVER_API_KEY/.test(error.message));
  assert.equal(setup.calls.includes('submit'), false);
});
