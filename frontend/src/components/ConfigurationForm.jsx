import { useState } from 'react';
import { apiRequest, getOperatorErrorMessage } from '../api/httpClient.js';
import {
  DEFAULT_AUTOMATION_CONFIG,
  extractSpreadsheetId,
  normalizeAutomationConfig,
  validateAutomationConfig,
} from '../utils/automationConfig.js';
import GoogleAccountPicker from './GoogleAccountPicker.jsx';

function FieldError({ id, message }) {
  return message ? <span className="field-error" id={id} role="alert">{message}</span> : null;
}

export default function ConfigurationForm({ initialConfig = {}, onSave }) {
  const [config, setConfig] = useState({ ...DEFAULT_AUTOMATION_CONFIG, ...initialConfig });
  const [errors, setErrors] = useState({});
  const [saved, setSaved] = useState(false);
  const [check, setCheck] = useState(null);

  function updateField(event) {
    const { name, type, checked, value } = event.target;
    // Pasting a full Google Sheets URL keeps just the ID.
    setConfig((current) => ({ ...current, [name]: type === 'checkbox' ? checked : name === 'spreadsheetId' ? extractSpreadsheetId(value) : value }));
    if (name === 'spreadsheetId' || name === 'sheetName') setCheck(null);
    setErrors((current) => ({ ...current, [name]: undefined }));
    setSaved(false);
  }

  function pickAccount(googleAccountId) { setConfig((current) => ({ ...current, googleAccountId })); setCheck(null); setSaved(false); }

  async function testConnection() {
    const problems = validateAutomationConfig(config);
    if (problems.spreadsheetId) return setErrors((current) => ({ ...current, spreadsheetId: problems.spreadsheetId }));
    setCheck({ state: 'loading' });
    try {
      const result = await apiRequest('/google/test', { method: 'POST', timeout: 30000, body: JSON.stringify({ spreadsheetId: config.spreadsheetId, sheetName: config.sheetName, googleAccountId: config.googleAccountId }) });
      setCheck({ state: 'ok', ...result });
    } catch (error) { setCheck({ state: 'error', message: getOperatorErrorMessage(error) }); }
  }

  function handleSubmit(event) {
    event.preventDefault();
    const nextErrors = validateAutomationConfig(config);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const normalized = normalizeAutomationConfig(config);
    setConfig(normalized);
    onSave?.(normalized);
    setSaved(true);
  }

  return (
    <form className="configuration-form" onSubmit={handleSubmit} noValidate>
      <div className="form-section-heading">
        <div><span className="section-number">01</span><h2>Data source</h2><p>Choose the Google Sheet with your website queue and the Google account that can open it. You can change these any time, even for each run.</p></div>
        <span className="required-note">All fields required</span>
      </div>

      <div className="form-grid">
        <GoogleAccountPicker value={config.googleAccountId} onChange={pickAccount} />
        <label className="field field-wide">
          <span>Google Sheet ID or URL</span>
          <input name="spreadsheetId" value={config.spreadsheetId} onChange={updateField} placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms" aria-invalid={Boolean(errors.spreadsheetId)} aria-describedby={errors.spreadsheetId ? 'spreadsheetId-error' : undefined} />
          <small>Paste the sheet's ID or just its full URL.</small>
          <FieldError id="spreadsheetId-error" message={errors.spreadsheetId} />
        </label>
        <label className="field">
          <span>Sheet tab name</span>
          <input name="sheetName" list="sheet-tabs" value={config.sheetName} onChange={updateField} placeholder="Sheet1" aria-invalid={Boolean(errors.sheetName)} aria-describedby={errors.sheetName ? 'sheetName-error' : undefined} />
          <datalist id="sheet-tabs">{check?.tabs?.map((tab) => <option key={tab} value={tab} />)}</datalist>
          <FieldError id="sheetName-error" message={errors.sheetName} />
        </label>
        <label className="field">
          <span>Batch size</span>
          <input type="number" name="batchSize" min="1" max="10" value={config.batchSize} onChange={updateField} aria-invalid={Boolean(errors.batchSize)} aria-describedby="batchSize-help batchSize-error" />
          <small id="batchSize-help">1–10 websites per batch</small>
          <FieldError id="batchSize-error" message={errors.batchSize} />
        </label>
      </div>

      <div className="connection-check">
        <button type="button" className="secondary-button" onClick={testConnection} disabled={check?.state === 'loading'}>{check?.state === 'loading' ? 'Checking…' : 'Test connection'}</button>
        {check?.state === 'ok' && (
          <p className={`check-result ${check.tabFound === false ? 'warn' : 'ok'}`} role="status">
            {check.tabFound === false ? <>Connected to <strong>{check.title}</strong>, but there's no tab named “{config.sheetName}”. Pick one: {check.tabs.map((tab) => <button key={tab} type="button" className="text-button" onClick={() => { setConfig((c) => ({ ...c, sheetName: tab })); setCheck({ ...check, tabFound: true }); }}>{tab}</button>)}</> : <>✓ Connected to <strong>{check.title}</strong>{check.tabFound ? <> · tab “{config.sheetName}” found</> : null}</>}
          </p>
        )}
        {check?.state === 'error' && <p className="check-result bad" role="alert">{check.message}</p>}
      </div>

      <div className="form-divider" />
      <div className="form-section-heading">
        <div><span className="section-number">02</span><h2>Browser execution</h2><p>Control speed, visibility, and navigation limits.</p></div>
      </div>

      <div className="form-grid three-column">
        <label className="field">
          <span>Concurrent websites</span>
          <input type="number" name="concurrency" min="1" max="10" value={config.concurrency} onChange={updateField} aria-invalid={Boolean(errors.concurrency)} aria-describedby="concurrency-error" />
          <FieldError id="concurrency-error" message={errors.concurrency} />
        </label>
        <label className="field">
          <span>Page timeout</span>
          <div className="input-suffix"><input type="number" name="timeoutSeconds" min="10" max="120" value={config.timeoutSeconds} onChange={updateField} aria-invalid={Boolean(errors.timeoutSeconds)} aria-describedby="timeoutSeconds-error" /><span>seconds</span></div>
          <FieldError id="timeoutSeconds-error" message={errors.timeoutSeconds} />
        </label>
        <label className="field">
          <span>Browser mode</span>
          <select name="browserMode" value={config.browserMode} onChange={updateField} aria-invalid={Boolean(errors.browserMode)} aria-describedby="browserMode-error">
            <option value="visible">Visible — recommended</option>
            <option value="headless">Headless</option>
          </select>
          <FieldError id="browserMode-error" message={errors.browserMode} />
        </label>
      </div>

      <div className="safety-card">
        <div className="safety-icon" aria-hidden="true">✓</div>
        <div><strong>Dry-run safety mode</strong><p>Fill forms and capture screenshots without clicking submit.</p></div>
        <label className="switch">
          <input type="checkbox" name="dryRun" checked={config.dryRun} onChange={updateField} />
          <span aria-hidden="true" />
          <em>{config.dryRun ? 'Enabled' : 'Disabled'}</em>
        </label>
      </div>

      {!config.dryRun && <p className="live-warning" role="alert"><strong>Live mode:</strong> valid forms may be submitted. Every run will require confirmation.</p>}

      <div className="form-actions">
        <span className="save-status" role="status">{saved ? 'Configuration saved for this session.' : 'Changes are not saved automatically.'}</span>
        <button className="primary-button" type="submit">Save configuration</button>
      </div>
    </form>
  );
}
