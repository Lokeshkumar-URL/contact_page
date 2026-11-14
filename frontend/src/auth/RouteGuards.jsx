import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';

export function Splash({ children }) {
  return <div className="splash" role="status" aria-live="polite"><span className="splash-mark" aria-hidden="true" />{children ?? <p>Loading…</p>}</div>;
}

export function RequireAuth() {
  const { loading, user, offline, retry } = useAuth();
  const location = useLocation();
  if (loading) return <Splash />;
  if (offline) return <Splash><p>Can't reach the server.</p><button type="button" className="secondary-button" onClick={retry}>Try again</button></Splash>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

export function RequireAdmin() {
  const { user } = useAuth();
  return user?.role === 'admin' ? <Outlet /> : <Navigate to="/" replace />;
}
