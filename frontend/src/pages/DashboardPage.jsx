import { useEffect, useMemo, useRef, useState } from 'react';
import ControlPanel from '../components/ControlPanel.jsx';
import FailureBreakdown from '../components/FailureBreakdown.jsx';
import ProgressSummary from '../components/ProgressSummary.jsx';
import ResultsTable from '../components/ResultsTable.jsx';
import ScreenshotModal from '../components/ScreenshotModal.jsx';
import { useAutomationRun } from '../hooks/useAutomationRun.js';
import { useLiveProgress } from '../hooks/useLiveProgress.js';
import { useRunResults } from '../hooks/useRunResults.js';
import { loadAutomationConfig, loadContactProfile } from '../utils/settingsStorage.js';
import { summarizeResults } from '../utils/results.js';
import { apiRequest, getOperatorErrorMessage } from '../api/httpClient.js';
import { deleteResults } from '../utils/deleteResults.js';

function greeting(name) {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name}.` : `${part}.`;
}

export default function DashboardPage() {
  const run = useAutomationRun();
  const [latestRunId, setLatestRunId] = useState(null);
  const viewRunId = run.runId ?? latestRunId;
  const live = useLiveProgress(run.runId); const runResults = useRunResults(viewRunId, live.eventId);
  const [selectedResult, setSelectedResult] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all'); const [category, setCategory] = useState(null);
  const [toast, setToast] = useState(null); const previousStatus = useRef(null);
  const startPayload = useMemo(() => ({ ...loadAutomationConfig(), contactProfile: loadContactProfile() }), []);
  const firstName = useMemo(() => loadContactProfile().firstName?.trim(), []);

  // After a page reload the in-memory run id is gone; show the most recent run instead of an empty dashboard.
  useEffect(() => { if (run.runId) return; let active = true; apiRequest('/automation').then((data) => { const latest = [...(data.runs ?? [])].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]; if (active && latest) setLatestRunId(latest.runId); }).catch(() => {}); return () => { active = false; }; }, [run.runId]);
  useEffect(() => { const status=live.status??runResults.status;if(status)run.sync(status,live.error??runResults.error); }, [live.status, live.error, runResults.status, runResults.error]);
  useEffect(() => {
    const status = live.status;
    if (status && status !== previousStatus.current && ['completed', 'failed', 'stopped'].includes(status) && previousStatus.current) {
      const summary = summarizeResults(runResults.results);
      setToast({ tone: status === 'completed' ? 'success' : 'warning', text: status === 'completed' ? `Run complete: ${summary.success} successful, ${summary.failed} failed, ${summary.manualReview} for review.` : `Run ${status}.` });
    }
    previousStatus.current = status;
  }, [live.status, runResults.results]);
  useEffect(() => { if (!toast) return undefined; const timer = setTimeout(() => setToast(null), 7000); return () => clearTimeout(timer); }, [toast]);

  const liveHasData = (live.progress.total ?? 0) > 0;
  const progress = liveHasData ? live.progress : summarizeResults(runResults.results);
  async function retryResult(result){try{await apiRequest(`/results/${encodeURIComponent(result.runId)}/${result.rowNumber}/retry`,{method:'POST'});setToast({tone:'success',text:`Queued ${result.url.replace(/^https?:\/\//,'')} for retry.`});}catch(error){setToast({tone:'error',text:getOperatorErrorMessage(error)});}await runResults.refresh();}
  const dashboardActive = ['queued', 'running', 'paused'].includes(live.status ?? runResults.status);
  async function removeActivity(items){try{const count=await deleteResults(items);setToast({tone:'success',text:`${count} activity record${count===1?'':'s'} deleted.`});}catch(error){setToast({tone:'error',text:getOperatorErrorMessage(error)});}await runResults.refresh();}
  function selectCategory(next) { setCategory(next); if (next) setStatusFilter('all'); }

  return (
    <main className="page" aria-labelledby="dashboard-title">
      <section className="page-heading"><div><span className="eyebrow">Contact operations</span><h1 id="dashboard-title">{greeting(firstName)}</h1><p>Monitor form submissions and keep every outreach run under control.</p></div><a className="primary-button button-link" href="#run-controls"><span aria-hidden="true">+</span> New automation</a></section>
      <ControlPanel run={run} startPayload={startPayload} />
      {(run.error || runResults.error) && <p className="control-error" role="alert">{run.error || runResults.error}</p>}
      {!run.runId && latestRunId && <p className="viewing-note">Showing your most recent run <code>{latestRunId.slice(0, 8)}</code>. Start a new automation to replace it.</p>}
      <ProgressSummary progress={progress} connection={run.runId ? live.connection : 'closed'} activeStatus={statusFilter} onSelectStatus={(status) => { setStatusFilter(status); setCategory(null); }} />
      <FailureBreakdown results={runResults.results} activeCategory={category} onSelectCategory={selectCategory} />
      <ResultsTable results={runResults.results} loading={runResults.loading} onViewScreenshot={setSelectedResult} onRetry={retryResult} onDelete={dashboardActive ? undefined : removeActivity} status={statusFilter} onStatusChange={(status) => { setStatusFilter(status); setCategory(null); }} category={category} onCategoryChange={setCategory} />
      <ScreenshotModal result={selectedResult} onClose={() => setSelectedResult(null)} />
      {toast && <div className={`toast toast-${toast.tone}`} role="status"><span>{toast.text}</span><button type="button" aria-label="Dismiss notification" onClick={() => setToast(null)}>×</button></div>}
    </main>
  );
}
