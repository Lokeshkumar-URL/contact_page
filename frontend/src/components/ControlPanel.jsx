import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAutomationRun } from '../hooks/useAutomationRun.js';

const statusLabels = { idle: 'Ready to start', running: 'Automation running', paused: 'Run paused', stopped: 'Run stopped', completed: 'Run complete', error: 'Action needed' };

export default function ControlPanel({ transport, run: providedRun, startPayload = {} }) {
  const internalRun = useAutomationRun(transport); const run = providedRun ?? internalRun;
  const [dryRun, setDryRun] = useState(true);
  const [liveConfirmed, setLiveConfirmed] = useState(false);
  const [browserMode, setBrowserMode] = useState(startPayload.browserMode === 'headless' ? 'headless' : 'visible');
  const liveBlocked = !dryRun && !liveConfirmed;
  function changeMode(event) { const next = event.target.value === 'dry'; setDryRun(next); if (next) setLiveConfirmed(false); }
  return (
    <section className="control-panel" id="run-controls" aria-labelledby="run-controls-title">
      <div className="control-panel-header"><div><span className="section-kicker">Run control</span><h2 id="run-controls-title">Start a new automation</h2><p>Choose a safe execution mode, then control the run from one place.</p></div><span className={`run-status status-${run.status}`}><span aria-hidden="true" />{statusLabels[run.status]}</span></div>
      <div className="mode-selector" role="radiogroup" aria-label="Submission mode">
        <label className={dryRun ? 'selected' : ''}><input type="radio" name="submissionMode" value="dry" checked={dryRun} onChange={changeMode} /><span className="mode-icon" aria-hidden="true">◇</span><span><strong>Dry run</strong><small>Fill and capture. Never submit.</small></span><span className="recommended-tag">Recommended</span></label>
        <label className={!dryRun ? 'selected live-selected' : ''}><input type="radio" name="submissionMode" value="live" checked={!dryRun} onChange={changeMode} /><span className="mode-icon" aria-hidden="true">→</span><span><strong>Live submission</strong><small>Submit approved forms to websites.</small></span></label>
      </div>
      <div className="browser-mode-toggle" role="radiogroup" aria-label="Browser mode"><span className="toggle-label">Browser</span>
        <label className={browserMode === 'visible' ? 'selected' : ''}><input type="radio" name="browserMode" value="visible" checked={browserMode === 'visible'} onChange={() => setBrowserMode('visible')} />Visible <small>you can solve CAPTCHAs by hand</small></label>
        <label className={browserMode === 'headless' ? 'selected' : ''}><input type="radio" name="browserMode" value="headless" checked={browserMode === 'headless'} onChange={() => setBrowserMode('headless')} />Headless <small>faster, CAPTCHA sites go to review</small></label>
      </div>
      {!dryRun && <label className="live-confirmation"><input type="checkbox" checked={liveConfirmed} onChange={(event) => setLiveConfirmed(event.target.checked)} /><span>I understand that live mode sends real contact-form submissions.</span></label>}
      <p className="source-line">{startPayload.spreadsheetId ? <>Sheet <code>{startPayload.spreadsheetId.length > 14 ? `${startPayload.spreadsheetId.slice(0, 12)}…` : startPayload.spreadsheetId}</code> · tab “{startPayload.sheetName}”</> : 'No sheet chosen yet — the server default (if any) will be used.'} · <Link to="/settings">Change sheet or Google account</Link></p>
      <div className="control-toolbar"><div className="run-identity"><small>Current run</small><strong>{run.runId ?? 'Not started'}</strong></div><div className="run-buttons" aria-label="Automation controls">
        <button className="secondary-button control-button" type="button" onClick={run.pause} disabled={!run.canPause}>Ⅱ <span>Pause</span></button><button className="secondary-button control-button" type="button" onClick={run.resume} disabled={!run.canResume}>▶ <span>Resume</span></button><button className="danger-button control-button" type="button" onClick={run.stop} disabled={!run.canStop}>■ <span>Stop</span></button><button className="primary-button start-button" type="button" onClick={() => run.start({ ...startPayload, browserMode, dryRun, liveConfirmed: !dryRun && liveConfirmed })} disabled={!run.canStart || liveBlocked}>{run.pendingAction === 'start' ? 'Starting…' : 'Start automation'}</button>
      </div></div>
      {liveBlocked && <p className="control-notice" role="status">Confirm the live-submission warning before starting.</p>}{run.error && <p className="control-error" role="alert">{run.error} Check that the backend service is running, then try again.</p>}
    </section>
  );
}
