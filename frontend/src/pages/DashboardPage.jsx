import { useEffect, useMemo, useState } from 'react';
import ControlPanel from '../components/ControlPanel.jsx';
import ProgressSummary from '../components/ProgressSummary.jsx';
import ResultsTable from '../components/ResultsTable.jsx';
import ScreenshotModal from '../components/ScreenshotModal.jsx';
import { useAutomationRun } from '../hooks/useAutomationRun.js';
import { useLiveProgress } from '../hooks/useLiveProgress.js';
import { useRunResults } from '../hooks/useRunResults.js';
import { loadAutomationConfig, loadContactProfile } from '../utils/settingsStorage.js';
import { apiRequest } from '../api/httpClient.js';

export default function DashboardPage() {
  const run = useAutomationRun(); const live = useLiveProgress(run.runId); const runResults = useRunResults(run.runId, live.eventId);
  const [selectedResult, setSelectedResult] = useState(null);
  const startPayload = useMemo(() => ({ ...loadAutomationConfig(), contactProfile: loadContactProfile() }), []);
  useEffect(() => { const status=live.status??runResults.status;if(status)run.sync(status,live.error??runResults.error); }, [live.status, live.error, runResults.status, runResults.error]);
  async function retryResult(result){await apiRequest(`/results/${encodeURIComponent(result.runId)}/${result.rowNumber}/retry`,{method:'POST'});await runResults.refresh();}

  return (
    <main className="page" aria-labelledby="dashboard-title">
      <section className="page-heading"><div><span className="eyebrow">Contact operations</span><h1 id="dashboard-title">Good morning, Patrick.</h1><p>Monitor form submissions and keep every outreach run under control.</p></div><a className="primary-button button-link" href="#run-controls"><span aria-hidden="true">+</span> New automation</a></section>
      <ControlPanel run={run} startPayload={startPayload} />
      {(run.error || runResults.error) && <p className="control-error" role="alert">{run.error || runResults.error}</p>}
      <ProgressSummary progress={live.progress} connection={live.connection} />
      <ResultsTable results={runResults.results} loading={runResults.loading} onViewScreenshot={setSelectedResult} onRetry={retryResult} />
      <ScreenshotModal result={selectedResult} onClose={() => setSelectedResult(null)} />
    </main>
  );
}
