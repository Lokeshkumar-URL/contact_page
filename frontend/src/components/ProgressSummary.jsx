import { calculateProgressPercent } from '../utils/progress.js';

const cards = [
  ['total', 'Total websites', '◫'], ['processing', 'In progress', '↻'], ['success', 'Successful', '✓'],
  ['failed', 'Failed', '!'], ['manualReview', 'Manual review', '?'], ['skipped', 'Skipped', '–'],
];

export default function ProgressSummary({ progress, connection = 'idle' }) {
  const percent = calculateProgressPercent(progress);
  return (
    <section className="progress-section" aria-labelledby="progress-title">
      <div className="section-heading-row"><div><span className="section-kicker">Live progress</span><h2 id="progress-title">Run overview</h2></div><span className={`connection-state connection-${connection}`}><span aria-hidden="true" />{connection === 'connected' ? 'Live' : connection === 'reconnecting' ? 'Reconnecting' : connection === 'error' ? 'Event error' : 'Waiting'}</span></div>
      <div className="progress-track" aria-label={`${percent}% complete`} role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent}><span style={{ width: `${percent}%` }} /></div>
      <div className="progress-grid">
        {cards.map(([key, label, icon]) => <article className={`metric-card metric-${key}`} key={key}><span className="metric-icon" aria-hidden="true">{icon}</span><div><strong>{progress[key] ?? 0}</strong><span>{label}</span></div></article>)}
      </div>
    </section>
  );
}
