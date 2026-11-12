import { Link, useParams } from 'react-router-dom';
import ProgressSummary from '../components/ProgressSummary.jsx';
import { useLiveProgress } from '../hooks/useLiveProgress.js';
import { useRunResults } from '../hooks/useRunResults.js';
import ResultsTable from '../components/ResultsTable.jsx';
import ScreenshotModal from '../components/ScreenshotModal.jsx';
import { useState } from 'react';

export default function RunDetailsPage() {
  const { runId } = useParams();
  const live = useLiveProgress(runId); const results=useRunResults(runId,live.eventId);const [selected,setSelected]=useState(null);
  return (
    <main className="page" aria-labelledby="run-title">
      <Link className="back-link" to="/">← Back to dashboard</Link>
      <section className="page-heading compact"><div><span className="eyebrow">Automation run</span><h1 id="run-title">Run details</h1><p>Run ID: <code>{runId}</code> <span className={`connection-label connection-${live.connection}`}>{live.connection}</span></p></div></section>
      <ProgressSummary progress={live.progress} connection={live.connection} />
      <ResultsTable results={results.results} loading={results.loading} error={results.error} onViewScreenshot={setSelected}/><ScreenshotModal result={selected} onClose={()=>setSelected(null)}/>
    </main>
  );
}
