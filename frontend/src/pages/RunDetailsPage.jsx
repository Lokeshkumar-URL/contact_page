import { Link, useNavigate, useParams } from 'react-router-dom';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { useToast } from '../components/Toasts.jsx';
import { deleteResults } from '../utils/deleteResults.js';
import FailureBreakdown from '../components/FailureBreakdown.jsx';
import ProgressSummary from '../components/ProgressSummary.jsx';
import { useLiveProgress } from '../hooks/useLiveProgress.js';
import { useRunResults } from '../hooks/useRunResults.js';
import ResultsTable from '../components/ResultsTable.jsx';
import ScreenshotModal from '../components/ScreenshotModal.jsx';
import { useState } from 'react';
import { apiRequest, getOperatorErrorMessage } from '../api/httpClient.js';
import { summarizeResults } from '../utils/results.js';

export default function RunDetailsPage() {
  const { runId } = useParams();
  const navigate = useNavigate(); const toast = useToast();
  const [confirmRun, setConfirmRun] = useState(false); const [deletingRun, setDeletingRun] = useState(false);
  const live = useLiveProgress(runId); const results=useRunResults(runId,live.eventId);const [selected,setSelected]=useState(null);
  const [status, setStatus] = useState('all'); const [category, setCategory] = useState(null);
  const progress = (live.progress.total ?? 0) > 0 ? live.progress : summarizeResults(results.results);
  async function retry(result) { await apiRequest(`/results/${encodeURIComponent(result.runId)}/${result.rowNumber}/retry`, { method: 'POST' }); await results.refresh(); }
  const runStatus = live.status ?? results.status; const active = ['queued', 'running', 'paused'].includes(runStatus);
  async function removeActivity(items) { try { const count = await deleteResults(items); toast(`${count} activity record${count === 1 ? '' : 's'} deleted.`); } catch (error) { toast(getOperatorErrorMessage(error), 'error'); } await results.refresh(); }
  async function removeRun() {
    setDeletingRun(true);
    try { await apiRequest(`/automation/${encodeURIComponent(runId)}`, { method: 'DELETE' }); toast('Run deleted.'); navigate('/runs', { replace: true }); }
    catch (error) { toast(getOperatorErrorMessage(error), 'error'); setDeletingRun(false); setConfirmRun(false); }
  }
  return (
    <main className="page" aria-labelledby="run-title">
      <Link className="back-link" to="/runs">← Back to runs</Link>
      <section className="page-heading compact"><div><span className="eyebrow">Automation run</span><h1 id="run-title">Run details</h1><p>Run ID: <code>{runId}</code> <span className={`connection-label connection-${live.connection}`}>{live.connection}</span></p></div><button type="button" className="secondary-button danger-outline" onClick={() => setConfirmRun(true)} disabled={active} title={active ? 'Stop the run before deleting it' : 'Delete this run'}>Delete run</button></section>
      <ProgressSummary progress={progress} connection={live.connection} activeStatus={status} onSelectStatus={(next) => { setStatus(next); setCategory(null); }} />
      <FailureBreakdown results={results.results} activeCategory={category} onSelectCategory={(next) => { setCategory(next); if (next) setStatus('all'); }} />
      <ResultsTable results={results.results} loading={results.loading} error={results.error} onViewScreenshot={setSelected} onRetry={retry} onDelete={active ? undefined : removeActivity} status={status} onStatusChange={(next) => { setStatus(next); setCategory(null); }} category={category} onCategoryChange={setCategory}/><ScreenshotModal result={selected} onClose={()=>setSelected(null)}/>
      <ConfirmDialog open={confirmRun} title="Delete this run?" busy={deletingRun} onCancel={() => setConfirmRun(false)} onConfirm={removeRun}><p>This removes the run history, its submission activity and saved screenshots from this app. <strong>Your Google Sheet is not changed.</strong> This can't be undone.</p></ConfirmDialog>
    </main>
  );
}
