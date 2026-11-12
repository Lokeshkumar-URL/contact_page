export const INITIAL_RUN_STATE = Object.freeze({ status: 'idle', runId: null, pendingAction: null, error: null });
export const RUN_ACTIONS = Object.freeze({ idle: ['start'], running: ['pause', 'stop'], paused: ['resume', 'stop'], stopped: ['start'], completed: ['start'], error: ['start'] });
export function canRunAction(state, action) { return !state.pendingAction && (RUN_ACTIONS[state.status] ?? []).includes(action); }
export function automationRunReducer(state, event) {
  switch (event.type) {
    case 'REQUEST': return canRunAction(state, event.action) ? { ...state, pendingAction: event.action, error: null } : state;
    case 'STARTED': return { status: 'running', runId: event.runId, pendingAction: null, error: null };
    case 'PAUSED': return { ...state, status: 'paused', pendingAction: null, error: null };
    case 'RESUMED': return { ...state, status: 'running', pendingAction: null, error: null };
    case 'STOPPED': return { ...state, status: 'stopped', pendingAction: null, error: null };
    case 'FAILED': return { ...state, status: state.runId ? state.status : 'error', pendingAction: null, error: event.message };
    case 'SYNC': return { ...state, status: event.status ?? state.status, error: event.error ?? null, pendingAction: null };
    default: return state;
  }
}
