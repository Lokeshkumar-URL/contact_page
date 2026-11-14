import { Fragment, useMemo, useState } from 'react';
import { formatTimestamp } from '../utils/formatters.js';
import { CAPTCHA_FILTERS, describeFailure, failureCategory, filterResults, matchesCaptchaFilter, resultsToCsv, RESULT_STATUSES } from '../utils/results.js';
import ConfirmDialog from './ConfirmDialog.jsx';
import StatusBadge from './StatusBadge.jsx';

const SORTS = { updated: (a, b) => String(b.timestamp ?? '').localeCompare(String(a.timestamp ?? '')), row: (a, b) => (a.rowNumber ?? 0) - (b.rowNumber ?? 0), status: (a, b) => String(a.status).localeCompare(String(b.status)) };
const retryable = (result) => ['failed', 'manual_review'].includes(result.status);

function downloadCsv(results) {
  const blob = new Blob([resultsToCsv(results)], { type: 'text/csv;charset=utf-8' });
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `contact-results-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

export default function ResultsTable({ results = [], loading = false, error = '', onViewScreenshot, onRetry, onDelete, status: controlledStatus, onStatusChange, category = null, onCategoryChange }) {
  const [internalStatus, setInternalStatus] = useState('all'); const status = controlledStatus ?? internalStatus; const setStatus = onStatusChange ?? setInternalStatus;
  const [query, setQuery] = useState(''); const [sort, setSort] = useState('updated'); const [expanded, setExpanded] = useState(null); const [busy, setBusy] = useState(null); const [captchaFilter, setCaptchaFilter] = useState('all'); const [toDelete, setToDelete] = useState(null); const [deleting, setDeleting] = useState(false);
  const filtered = useMemo(() => filterResults(results, { status, query, category, captcha: captchaFilter }).sort(SORTS[sort]), [results, status, query, category, captchaFilter, sort]);
  const counts = useMemo(() => Object.fromEntries(Object.keys(RESULT_STATUSES).map((key) => [key, results.filter((result) => result.status === key).length])), [results]);
  const retryTargets = filtered.filter(retryable);
  async function retry(items) { if (!onRetry) return; setBusy(items.length > 1 ? 'all' : items[0].id); try { for (const item of items) await onRetry(item); } finally { setBusy(null); } }
  async function confirmDelete() { setDeleting(true); try { await onDelete(toDelete); } finally { setDeleting(false); setToDelete(null); } }
  const chips = [['all', 'All', results.length], ...Object.entries(RESULT_STATUSES).filter(([key]) => counts[key]).map(([key, item]) => [key, item.label, counts[key]])];

  return <section className="results-section" aria-labelledby="results-title">
    <div className="section-heading-row"><div><span className="section-kicker">Website results</span><h2 id="results-title">Submission activity</h2></div><div className="results-actions"><span className="result-count" aria-live="polite">{loading && !results.length ? 'Loading…' : `${filtered.length} of ${results.length}`}</span>{onRetry && retryTargets.length > 1 && <button type="button" className="secondary-button compact-button" onClick={() => retry(retryTargets)} disabled={busy !== null}>{busy === 'all' ? 'Retrying…' : `Retry ${retryTargets.length} shown`}</button>}<button type="button" className="secondary-button compact-button" onClick={() => downloadCsv(filtered)} disabled={!filtered.length}>Export CSV</button>{onDelete && filtered.length > 0 && <button type="button" className="secondary-button compact-button danger-outline" onClick={() => setToDelete(filtered)}>{filtered.length === results.length ? `Delete all ${filtered.length}` : `Delete ${filtered.length} shown`}</button>}</div></div>
    {results.length > 0 && <div className="status-chips" role="group" aria-label="Quick status filter">{chips.map(([key, label, count]) => <button type="button" key={key} className={`status-chip${status === key ? ' active' : ''}`} aria-pressed={status === key} onClick={() => setStatus(key)}>{label}<span>{count}</span></button>)}</div>}
    {category && <p className="active-filter">Showing <strong>{describeFailure(category).label}</strong> only <button type="button" className="text-button" onClick={() => onCategoryChange?.(null)}>Clear</button></p>}
    <div className="result-toolbar"><label className="search-field"><span className="sr-only">Search results</span><span aria-hidden="true">⌕</span><input type="search" value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search URL, reason, or run ID" /></label><label className="filter-field"><span className="sr-only">Filter by status</span><select value={status} onChange={(event)=>setStatus(event.target.value)}><option value="all">All statuses</option>{Object.entries(RESULT_STATUSES).map(([value,item])=><option value={value} key={value}>{item.label}</option>)}</select></label><label className="filter-field"><span className="sr-only">Filter by CAPTCHA type</span><select value={captchaFilter} onChange={(event)=>setCaptchaFilter(event.target.value)}><option value="all">All CAPTCHA types</option>{Object.entries(CAPTCHA_FILTERS).map(([value,label])=><option value={value} key={value} disabled={!results.some((result)=>matchesCaptchaFilter(result,value))}>{label} ({results.filter((result)=>matchesCaptchaFilter(result,value)).length})</option>)}</select></label><label className="filter-field"><span className="sr-only">Sort results</span><select value={sort} onChange={(event)=>setSort(event.target.value)}><option value="updated">Newest first</option><option value="row">Sheet row order</option><option value="status">Group by status</option></select></label></div>
    {loading && !results.length ? <div className="table-state" role="status">Loading website results…</div> : error ? <div className="table-state error-state" role="alert">{error}</div> : filtered.length === 0 ? <div className="table-state">{results.length ? 'No results match the current filters.' : 'No website results yet. Start an automation run to begin.'}</div> :
    <div className="table-scroll" tabIndex="0" aria-label="Scrollable results table"><table><thead><tr><th>Website</th><th>Status</th><th>Reason</th><th>Attempt</th><th>Updated</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{filtered.map((result) => {
      const code = failureCategory(result); const info = code ? describeFailure(code) : null; const open = expanded === result.id;
      return <Fragment key={result.id}><tr className={open ? 'row-open' : ''}>
        <td data-label="Website"><a className="website-link" href={result.url} target="_blank" rel="noreferrer">{result.url.replace(/^https?:\/\//,'')}</a><small>{result.contactPageUrl ? <a href={result.contactPageUrl} target="_blank" rel="noreferrer">{result.contactPageUrl.replace(/^https?:\/\//,'')}</a> : 'Contact page not found'}</small></td>
        <td data-label="Status"><StatusBadge status={result.status}/>{info && <small className="category-tag">{info.label}</small>}{result.captcha && <small className={`captcha-tag${/needs a person|not solved/i.test(result.captcha) ? ' captcha-person' : ''}`} title={result.captcha}>🔒 {result.captcha.split(';')[0]}</small>}</td>
        <td data-label="Reason"><span className="reason-text">{result.reason || (result.status === 'success' ? result.verificationEvidence : '') || '—'}</span></td>
        <td data-label="Attempt">{result.attemptCount ?? 0}</td>
        <td data-label="Updated">{formatTimestamp(result.timestamp)}</td>
        <td className="row-actions"><button type="button" className="text-button" aria-expanded={open} onClick={() => setExpanded(open ? null : result.id)}>{open ? 'Hide' : 'Details'}</button><button type="button" className="text-button" onClick={()=>onViewScreenshot?.(result)} disabled={!result.screenshot} aria-label={`View screenshot for ${result.url}`}>Screenshot</button><button type="button" className="text-button" onClick={() => retry([result])} disabled={!onRetry || !retryable(result) || busy !== null}>{busy === result.id ? 'Retrying…' : 'Retry'}</button>{onDelete && <button type="button" className="text-button danger" onClick={() => setToDelete([result])} aria-label={`Delete activity for ${result.url}`}>Delete</button>}</td>
      </tr>{open && <tr className="detail-row"><td colSpan="6"><dl className="result-details">
        <div><dt>Sheet row</dt><dd>{result.rowNumber}</dd></div>
        <div><dt>Contact page</dt><dd>{result.contactPageUrl || '—'}</dd></div>
        <div><dt>Evidence</dt><dd>{result.verificationEvidence || '—'}</dd></div>
        <div><dt>CAPTCHA</dt><dd>{result.captcha || 'None detected'}</dd></div>
        <div><dt>AI assist used</dt><dd>{result.claudeUsed ? 'Yes' : 'No'}</dd></div>
        <div><dt>Run</dt><dd><code>{result.runId}</code></dd></div>
        {info?.hint && <div className="detail-hint"><dt>What to do</dt><dd>{info.hint}</dd></div>}
      </dl></td></tr>}</Fragment>;
    })}</tbody></table></div>}
  <ConfirmDialog open={Boolean(toDelete)} title={toDelete?.length === 1 ? 'Delete this activity?' : `Delete ${toDelete?.length} activity records?`} busy={deleting} onCancel={() => setToDelete(null)} onConfirm={confirmDelete}>
      <p>{toDelete?.length === 1 ? <><strong>{toDelete[0].url.replace(/^https?:\/\//, '')}</strong> will be removed from this run's history, along with its screenshot.</> : 'These records and their screenshots will be removed from this run’s history.'} <strong>Your Google Sheet is not changed.</strong> This can't be undone.</p>
    </ConfirmDialog>
  </section>;
}
