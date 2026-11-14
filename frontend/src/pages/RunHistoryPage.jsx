import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiRequest, getOperatorErrorMessage } from '../api/httpClient.js';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { useToast } from '../components/Toasts.jsx';

const ACTIVE = new Set(['queued', 'running', 'paused']);

const RUN_TONES = { completed: 'success', running: 'info', paused: 'warning', stopped: 'neutral', failed: 'error', pending: 'neutral' };

function RunOutcome({ progress = {} }) {
  const total = progress.total || 0; const pct = (value) => (total ? `${((value || 0) / total) * 100}%` : '0%');
  return <div className="run-outcome" title={`${progress.success ?? 0} success · ${progress.failed ?? 0} failed · ${progress.manualReview ?? 0} review`}>
    <div className="outcome-bar" aria-hidden="true"><span className="seg-success" style={{ width: pct(progress.success) }} /><span className="seg-review" style={{ width: pct(progress.manualReview) }} /><span className="seg-failed" style={{ width: pct(progress.failed) }} /></div>
    <small>{progress.success ?? 0} ok · {progress.manualReview ?? 0} review · {progress.failed ?? 0} failed</small>
  </div>;
}

export default function RunHistoryPage(){
  const navigate = useNavigate();
  const toast = useToast();
  const [selected, setSelected] = useState(() => new Set());
  const [pending, setPending] = useState(null); // run ids waiting for delete confirmation
  const [deleting, setDeleting] = useState(false);
  const [state,setState]=useState({runs:[],error:'',loading:true});
  const load = useCallback(() => { setState((current) => ({ ...current, loading: true })); return apiRequest('/automation').then((data)=>setState({runs:[...(data.runs??[])].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))),error:'',loading:false})).catch((error)=>setState({runs:[],error:getOperatorErrorMessage(error),loading:false})); }, []);
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 10000); return () => clearInterval(timer); }, [load]);
  const deletable = state.runs.filter((run) => !ACTIVE.has(run.status));
  const toggle = (runId) => setSelected((current) => { const next = new Set(current); next.has(runId) ? next.delete(runId) : next.add(runId); return next; });
  const allSelected = deletable.length > 0 && deletable.every((run) => selected.has(run.runId));
  async function confirmDelete() {
    setDeleting(true);
    try {
      const result = await apiRequest('/automation/bulk-delete', { method: 'POST', body: JSON.stringify({ runIds: pending }) });
      const skipped = result.skipped.length;
      toast(`${result.deleted.length} run${result.deleted.length === 1 ? '' : 's'} deleted${skipped ? `, ${skipped} skipped (${result.skipped[0].reason})` : ''}.`, skipped && !result.deleted.length ? 'error' : 'success');
      setSelected(new Set());
    } catch (error) { toast(getOperatorErrorMessage(error), 'error'); }
    setDeleting(false); setPending(null); await load();
  }
  return <main className="page" aria-labelledby="runs-title">
    <section className="page-heading compact"><div><span className="eyebrow">Automation history</span><h1 id="runs-title">Runs</h1><p>Review current and previous automation runs. Click a run to open its results.</p></div><div className="button-group">{selected.size > 0 && <button type="button" className="danger-solid" onClick={() => setPending([...selected])}>Delete {selected.size} selected</button>}<button type="button" className="secondary-button" onClick={() => void load()} disabled={state.loading}>{state.loading ? 'Refreshing…' : 'Refresh'}</button></div></section>
    {state.loading && !state.runs.length ? <p role="status">Loading runs…</p> : state.error ? <p className="control-error" role="alert">{state.error}</p> : state.runs.length===0 ? <p>No runs have been started.</p> :
    <section className="results-section"><div className="table-scroll"><table><thead><tr><th className="check-col"><input type="checkbox" aria-label="Select all finished runs" checked={allSelected} disabled={!deletable.length} onChange={() => setSelected(allSelected ? new Set() : new Set(deletable.map((run) => run.runId)))} /></th><th>Run</th><th>Status</th><th>Mode</th><th>Outcome</th><th>Processed</th><th>Created</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{state.runs.map((run)=>
      <tr key={run.runId} className="clickable-row" onClick={() => navigate(`/runs/${run.runId}`)}>
        <td className="check-col" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Select run ${run.runId.slice(0, 8)}`} checked={selected.has(run.runId)} disabled={ACTIVE.has(run.status)} onChange={() => toggle(run.runId)} /></td>
        <td data-label="Run"><Link to={`/runs/${run.runId}`} onClick={(event) => event.stopPropagation()}><code>{run.runId.slice(0, 8)}</code></Link></td>
        <td data-label="Status"><span className={`status-badge tone-${RUN_TONES[run.status] ?? 'neutral'}`}><span aria-hidden="true" />{run.status}</span></td>
        <td data-label="Mode">{run.dryRun === false ? 'Live' : 'Dry run'}</td>
        <td data-label="Outcome"><RunOutcome progress={run.progress} /></td>
        <td data-label="Processed">{run.progress?.processed ?? 0} / {run.progress?.total ?? 0}</td>
        <td data-label="Created">{new Date(run.createdAt).toLocaleString()}</td>
        <td className="row-actions" onClick={(event) => event.stopPropagation()}><button type="button" className="text-button danger" disabled={ACTIVE.has(run.status)} title={ACTIVE.has(run.status) ? 'Stop the run before deleting it' : 'Delete this run'} onClick={() => setPending([run.runId])}>Delete</button></td>
      </tr>)}</tbody></table></div></section>}
    <ConfirmDialog open={Boolean(pending)} title={pending?.length === 1 ? 'Delete this run?' : `Delete ${pending?.length} runs?`} busy={deleting} confirmLabel="Delete" onCancel={() => setPending(null)} onConfirm={confirmDelete}>
      <p>This removes the run history, its submission activity and saved screenshots from this app. <strong>Your Google Sheet is not changed.</strong> This can't be undone.</p>
    </ConfirmDialog>
  </main>;
}
