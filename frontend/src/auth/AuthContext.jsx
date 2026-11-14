import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api/httpClient.js';
import { clearSession, getSessionToken, setSession, subscribeSession } from '../api/session.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, setupRequired: false, mailConfigured: false, offline: false });

  const boot = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, offline: false }));
    try {
      const status = await apiRequest('/auth/status');
      let user = null;
      if (getSessionToken()) { try { user = (await apiRequest('/auth/me')).user; } catch { clearSession(); } }
      setState({ loading: false, user, setupRequired: status.setupRequired, mailConfigured: status.mailConfigured, offline: false });
    } catch {
      setState((s) => ({ ...s, loading: false, offline: true }));
    }
  }, []);

  useEffect(() => { void boot(); }, [boot]);
  // The API client clears the session on a 401; mirror that here so the UI redirects to sign-in.
  useEffect(() => subscribeSession((session) => { if (!session) setState((s) => ({ ...s, user: null })); }), []);

  const adopt = useCallback((result) => { setSession(result); setState((s) => ({ ...s, user: result.user, setupRequired: false })); return result.user; }, []);

  const value = useMemo(() => ({
    ...state,
    retry: boot,
    login: async (identifier, password) => adopt(await apiRequest('/auth/login', { method: 'POST', body: JSON.stringify({ identifier, password }) })),
    setup: async (details) => adopt(await apiRequest('/auth/setup', { method: 'POST', body: JSON.stringify(details) })),
    acceptInvite: async (token, details) => adopt(await apiRequest(`/auth/invites/${encodeURIComponent(token)}/accept`, { method: 'POST', body: JSON.stringify(details) })),
    logout: () => clearSession(),
  }), [state, boot, adopt]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
