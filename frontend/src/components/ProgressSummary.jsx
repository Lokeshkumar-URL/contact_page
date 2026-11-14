import { calculateProgressPercent } from '../utils/progress.js';

const cards = [
  ['total', 'Total websites', '◫', 'all'], ['processing', 'In progress', '↻', 'processing'], ['success', 'Successful', '✓', 'success'],
  ['failed', 'Failed', '!', 'failed'], ['manualReview', 'Manual review', '?', 'manual_review'], ['skipped', 'Skipped', '–', 'skipped'],
];

export default function ProgressSummary({ progress, connection = 'idle', activeStatus = 'all', onSelectStatus }) {
  const percent = calculateProgressPercent(progress);
  const done = (progress.success ?? 0) + (progress.failed ?? 0) + (progress.manualReview ?? 0) + (progress.skipped ?? 0);
  const successRate = done ? Math.round(((progress.success ?? 0) / done) * 100) : null;
  return (
    <section className="progress-section" aria-labelledby="progress-title">
      <div className="section-heading-row"><div><span className="section-kicker">Live progress</span><h2 id="progress-title">Run overview</h2></div><div className="progress-meta">{successRate !== null && <span className="success-rate" title="Successful out of finished websites">{successRate}% success</span>}<span className={`connection-state connection-${connection}`}><span aria-hidden="true" />{connection === 'connected' ? 'Live' : connection === 'reconnecting' ? 'Reconnecting' : connection === 'error' ? 'Event error' : connection === 'closed' ? 'Finished' : 'Waiting'}</span></div></div>
      <div className="progress-track" aria-label={`${percent}% complete`} role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent}><span style={{ width: `${percent}%` }} /></div>
      <p className="progress-caption">{percent}% complete · {done} of {progress.total ?? 0} websites finished{onSelectStatus ? ' · click a card to filter the results' : ''}</p>
      <div className="progress-grid">
        {cards.map(([key, label, icon, status]) => {
          const content = <><span className="metric-icon" aria-hidden="true">{icon}</span><div><strong>{progress[key] ?? 0}</strong><span>{label}</span></div></>;
          return onSelectStatus
            ? <button type="button" className={`metric-card metric-${key}${activeStatus === status ? ' active' : ''}`} key={key} aria-pressed={activeStatus === status} onClick={() => onSelectStatus(activeStatus === status && status !== 'all' ? 'all' : status)}>{content}</button>
            : <article className={`metric-card metric-${key}`} key={key}>{content}</article>;
        })}
      </div>
    </section>
  );
}
