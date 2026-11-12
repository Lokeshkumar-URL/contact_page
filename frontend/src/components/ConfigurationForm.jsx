import { useState } from 'react';
import {
  DEFAULT_AUTOMATION_CONFIG,
  normalizeAutomationConfig,
  validateAutomationConfig,
} from '../utils/automationConfig.js';

function FieldError({ id, message }) {
  return message ? <span className="field-error" id={id} role="alert">{message}</span> : null;
}

export default function ConfigurationForm({ initialConfig = {}, onSave }) {
  const [config, setConfig] = useState({ ...DEFAULT_AUTOMATION_CONFIG, ...initialConfig });
  const [errors, setErrors] = useState({});
  const [saved, setSaved] = useState(false);

  function updateField(event) {
    const { name, type, checked, value } = event.target;
    setConfig((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
    setSaved(false);
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
        <div><span className="section-number">01</span><h2>Data source</h2><p>Choose the Google Sheet that contains the website queue.</p></div>
        <span className="required-note">All fields required</span>
      </div>

      <div className="form-grid">
        <label className="field field-wide">
          <span>Google Sheet ID</span>
          <input name="spreadsheetId" value={config.spreadsheetId} onChange={updateField} placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms" aria-invalid={Boolean(errors.spreadsheetId)} aria-describedby={errors.spreadsheetId ? 'spreadsheetId-error' : undefined} />
          <small>Copy the ID from the Google Sheet URL. Credentials remain on the backend.</small>
          <FieldError id="spreadsheetId-error" message={errors.spreadsheetId} />
        </label>
        <label className="field">
          <span>Sheet tab name</span>
          <input name="sheetName" value={config.sheetName} onChange={updateField} placeholder="Sheet1" aria-invalid={Boolean(errors.sheetName)} aria-describedby={errors.sheetName ? 'sheetName-error' : undefined} />
          <FieldError id="sheetName-error" message={errors.sheetName} />
        </label>
        <label className="field">
          <span>Batch size</span>
          <input type="number" name="batchSize" min="1" max="10" value={config.batchSize} onChange={updateField} aria-invalid={Boolean(errors.batchSize)} aria-describedby="batchSize-help batchSize-error" />
          <small id="batchSize-help">1–10 websites per batch</small>
          <FieldError id="batchSize-error" message={errors.batchSize} />
        </label>
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
