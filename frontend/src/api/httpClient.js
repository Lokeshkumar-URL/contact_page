export const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL ?? 'http://localhost:3000/api';
export const API_TOKEN = import.meta.env?.VITE_API_AUTH_TOKEN ?? '';
export const authHeaders = () => API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {};
export class ApiError extends Error { constructor(message, { status = 0, code = 'REQUEST_FAILED', details = null } = {}) { super(message); this.name = 'ApiError'; this.status = status; this.code = code; this.details = details; } }
export async function apiRequest(path, options = {}, fetchImpl = globalThis.fetch) {
  const { timeout = 15000, signal, ...fetchOptions } = options; const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeout);
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
  try {
    const response = await fetchImpl(`${API_BASE_URL}${path}`, { ...fetchOptions, signal: controller.signal, headers: { Accept: 'application/json', ...authHeaders(), ...(fetchOptions.body ? { 'Content-Type': 'application/json' } : {}), ...fetchOptions.headers } });
    const contentType = response.headers.get('content-type') ?? '';
    const body = response.status === 204 ? null : contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) { const payload=body?.error??body;const message=typeof payload==='object'&&payload?.message?payload.message:`Request failed with status ${response.status}.`;throw new ApiError(message,{status:response.status,code:payload?.code,details:payload?.details}); }
    return body;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error.name === 'AbortError') throw new ApiError('The request timed out. Please try again.', { code: 'TIMEOUT' });
    throw new ApiError('Unable to reach the automation service.', { code: 'NETWORK_ERROR' });
  } finally { clearTimeout(timer); }
}
export async function fetchApiAsset(path,fetchImpl=globalThis.fetch){const response=await fetchImpl(`${API_BASE_URL}${path}`,{headers:authHeaders()});if(!response.ok)throw new ApiError('Unable to load screenshot.',{status:response.status,code:'ASSET_LOAD_FAILED'});return response.blob();}
export function getOperatorErrorMessage(error) {
  if (error?.code === 'TIMEOUT') return 'The service took too long to respond. Try again.';
  if (error?.code === 'NETWORK_ERROR') return 'The automation service is offline or unreachable.';
  if (error?.status === 401 || error?.status === 403) return 'You do not have permission to perform this action.';
  return error?.message || 'Something went wrong. Please try again.';
}
