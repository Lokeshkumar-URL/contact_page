import { useCallback, useReducer } from 'react';
import { apiRequest, getOperatorErrorMessage } from '../api/httpClient.js';
import { INITIAL_RUN_STATE, automationRunReducer, canRunAction } from '../utils/automationRunState.js';

export function useAutomationRun(transport = apiRequest) {
  const [state, dispatch] = useReducer(automationRunReducer, INITIAL_RUN_STATE);
  const execute = useCallback(async (action, payload) => {
    if (!canRunAction(state, action)) return false;
    dispatch({ type: 'REQUEST', action });
    try {
      if (action === 'start') {
        const result = await transport('/automation/start', { method: 'POST', body: JSON.stringify(payload) });
        dispatch({ type: 'STARTED', runId: result?.runId ?? 'pending-run' });
      } else {
        await transport(`/automation/${state.runId}/${action}`, { method: 'POST' });
        dispatch({ type: action === 'pause' ? 'PAUSED' : action === 'resume' ? 'RESUMED' : 'STOPPED' });
      }
      return true;
    } catch (error) {
      dispatch({ type: 'FAILED', message: getOperatorErrorMessage(error) });
      return false;
    }
  }, [state, transport]);
  return { ...state, canStart: canRunAction(state, 'start'), canPause: canRunAction(state, 'pause'), canResume: canRunAction(state, 'resume'), canStop: canRunAction(state, 'stop'), start: (payload) => execute('start', payload), pause: () => execute('pause'), resume: () => execute('resume'), stop: () => execute('stop'), sync: (status,error) => dispatch({ type: 'SYNC', status, error }) };
}
