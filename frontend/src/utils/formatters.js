export function formatTimestamp(value) {
  return value ? new Date(value).toLocaleString() : '';
}
