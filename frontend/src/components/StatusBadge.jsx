import { RESULT_STATUSES } from '../utils/results.js';

export default function StatusBadge({ status }) {
  const metadata = RESULT_STATUSES[status] ?? { label: status || 'Unknown', tone: 'neutral' };
  return <span className={`status-badge tone-${metadata.tone}`}><span aria-hidden="true" />{metadata.label}</span>;
}
