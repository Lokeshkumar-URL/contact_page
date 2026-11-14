import { summarizeFailures } from '../utils/results.js';

export default function FailureBreakdown({ results = [], activeCategory = null, onSelectCategory }) {
  const groups = summarizeFailures(results);
  if (!groups.length) return null;
  const max = groups[0].count;
  return (
    <section className="breakdown-section" aria-labelledby="breakdown-title">
      <div className="section-heading-row"><div><span className="section-kicker">Needs attention</span><h2 id="breakdown-title">Why websites did not go through</h2></div>{activeCategory && <button type="button" className="text-button" onClick={() => onSelectCategory?.(null)}>Clear filter</button>}</div>
      <ul className="breakdown-list">
        {groups.map((group) => (
          <li key={group.code}>
            <button type="button" className={`breakdown-item${activeCategory === group.code ? ' active' : ''}`} aria-pressed={activeCategory === group.code} onClick={() => onSelectCategory?.(activeCategory === group.code ? null : group.code)}>
              <span className="breakdown-head"><strong>{group.label}</strong><span className="breakdown-count">{group.count}</span></span>
              <span className="breakdown-bar" aria-hidden="true"><span style={{ width: `${Math.max(8, (group.count / max) * 100)}%` }} /></span>
              {group.hint && <small>{group.hint}</small>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
