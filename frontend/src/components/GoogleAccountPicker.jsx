import { useCallback, useEffect, useState } from 'react';
import { apiRequest, getOperatorErrorMessage } from '../api/httpClient.js';
import { useToast } from './Toasts.jsx';

export default function GoogleAccountPicker({ value, onChange, onAccountsLoaded }) {
  const toast = useToast();
  const [data, setData] = useState({ accounts: [], serverDefault: { configured: false, clientEmail: null } });
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ label: '', credentials: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { const result = await apiRequest('/google/accounts'); setData(result); onAccountsLoaded?.(result); }
    catch (err) { setError(getOperatorErrorMessage(err)); }
    finally { setLoading(false); }
  }, [onAccountsLoaded]);
  useEffect(() => { void load(); }, [load]);

  // If the saved choice no longer exists (removed account), fall back to the server default.
  useEffect(() => { if (!loading && value && !data.accounts.some((a) => a.id === value)) onChange(''); }, [loading, value, data.accounts, onChange]);

  const selected = data.accounts.find((a) => a.id === value);
  const shareEmail = selected?.clientEmail ?? data.serverDefault.clientEmail;
  const needsAccount = !loading && !value && !data.serverDefault.configured;

  async function readFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try { setDraft((d) => ({ ...d, credentials: '' })); const text = await file.text(); setDraft((d) => ({ ...d, credentials: text })); setError(''); }
    catch { setError('Could not read that file.'); }
    event.target.value = '';
  }

  async function save() {
    setBusy(true); setError('');
    try {
      const { account } = await apiRequest('/google/accounts', { method: 'POST', body: JSON.stringify({ label: draft.label, credentials: draft.credentials.trim() }) });
      await load(); onChange(account.id); setAdding(false); setDraft({ label: '', credentials: '' });
      toast(`Added ${account.clientEmail}. Share your sheet with it, then test the connection.`);
    } catch (err) { setError(getOperatorErrorMessage(err)); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!selected || !window.confirm(`Remove ${selected.label}? Runs that use it will need another account.`)) return;
    try { await apiRequest(`/google/accounts/${selected.id}`, { method: 'DELETE' }); onChange(''); await load(); toast('Google account removed.'); }
    catch (err) { toast(getOperatorErrorMessage(err), 'error'); }
  }

  const copy = async () => { try { await navigator.clipboard.writeText(shareEmail); toast('Email copied.'); } catch { toast('Copy failed.', 'error'); } };

  return (
    <div className="google-picker field-wide">
      <label className="field">
        <span>Google account</span>
        <select value={value} onChange={(e) => (e.target.value === '__add' ? setAdding(true) : onChange(e.target.value))} disabled={loading}>
          <option value="">{data.serverDefault.configured ? `Server default (${data.serverDefault.clientEmail})` : 'Server default (not set up)'}</option>
          {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.label === a.clientEmail ? a.clientEmail : `${a.label} — ${a.clientEmail}`}</option>)}
          <option value="__add">＋ Add a Google account…</option>
        </select>
        <small>The account that opens your sheet. Each team member keeps their own list; keys are stored encrypted on the server.</small>
      </label>

      {shareEmail && !adding && <p className="share-hint">Share your sheet with <strong>{shareEmail}</strong> as <em>Editor</em> <button type="button" className="text-button" onClick={copy}>Copy email</button>{selected && <button type="button" className="text-button danger" onClick={remove}>Remove account</button>}</p>}
      {needsAccount && !adding && <p className="control-notice">No Google account is set up yet. <button type="button" className="text-button" onClick={() => setAdding(true)}>Add one</button> to connect a sheet.</p>}

      {adding && (
        <div className="account-form">
          <h3>Add a Google service account</h3>
          <ol className="steps">
            <li>In Google Cloud, create a <strong>service account</strong> and enable the <strong>Google Sheets API</strong>.</li>
            <li>Create a <strong>JSON key</strong> for it and download the file.</li>
            <li>Upload or paste the file below, then share your sheet with its email as Editor.</li>
          </ol>
          <label className="field"><span>Name (optional)</span><input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="e.g. Client A" maxLength={80} /></label>
          <label className="field"><span>Key file (JSON)</span><input type="file" accept="application/json,.json" onChange={readFile} /></label>
          <label className="field"><span>…or paste its contents</span><textarea rows={5} value={draft.credentials} onChange={(e) => setDraft({ ...draft, credentials: e.target.value })} placeholder='{ "type": "service_account", "client_email": "…", "private_key": "…" }' spellCheck={false} /></label>
          {draft.credentials && <small className="muted">Key loaded ({draft.credentials.length.toLocaleString()} characters). It is sent once to the server and never shown again.</small>}
          {error && <p className="control-error" role="alert">{error}</p>}
          <div className="button-group">
            <button type="button" className="primary-button" onClick={save} disabled={busy || draft.credentials.trim().length < 20}>{busy ? 'Saving…' : 'Save account'}</button>
            <button type="button" className="secondary-button" onClick={() => { setAdding(false); setError(''); setDraft({ label: '', credentials: '' }); }}>Cancel</button>
          </div>
        </div>
      )}
      {!adding && error && <p className="control-error" role="alert">{error}</p>}
    </div>
  );
}
