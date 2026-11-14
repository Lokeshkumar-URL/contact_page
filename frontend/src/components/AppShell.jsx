import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import ThemeToggle from './ThemeToggle.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { loadAutomationConfig } from '../utils/settingsStorage.js';

const baseNavigation = [
  { to: '/', label: 'Dashboard', icon: 'grid', end: true },
  { to: '/runs', label: 'Runs', icon: 'activity' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];
const adminNavigation = { to: '/admin', label: 'Team', icon: 'users' };

function Icon({ name }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    activity: <path d="M3 12h4l2.5-6 5 12 2.5-6h4"/>,
    users: <><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c1.9.6 3.2 2.3 3.5 5.2"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19 15.5 21 17l-4 4-1.5-2A8 8 0 0 1 13 20v2H8v-2a8 8 0 0 1-2.5-1L4 21l-4-4 2-1.5A8 8 0 0 1 1 13h2V8H1a8 8 0 0 1 1-2.5L0 4l4-4 1.5 2A8 8 0 0 1 8 1V-1h5V1a8 8 0 0 1 2.5 1L17 0l4 4-2 1.5A8 8 0 0 1 20 8h2v5h-2a8 8 0 0 1-1 2.5Z"/></>,
  };
  return <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function Navigation({ className, items }) {
  return (
    <nav className={className} aria-label="Primary navigation" style={{ '--nav-count': items.length }}>
      {items.map(({ to, label, icon, end }) => (
        <NavLink key={label} to={to} end={end} className="nav-link">
          <Icon name={icon} /><span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

const TITLES = { '/settings': 'Settings', '/runs': 'Run history', '/admin': 'Team & access' };

function UserMenu({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (event.type === 'keydown' ? event.key === 'Escape' : !ref.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  return (
    <div className="user-menu" ref={ref}>
      <button type="button" className="avatar" aria-haspopup="menu" aria-expanded={open} aria-label="Account menu" onClick={() => setOpen((v) => !v)}>{user.username.slice(0, 2).toUpperCase()}</button>
      {open && (
        <div className="menu-panel" role="menu">
          <div className="menu-head"><strong>{user.username}</strong><small>{user.email}</small><span className={`role-tag role-${user.role}`}>{user.role === 'admin' ? 'Admin' : 'Member'}</span></div>
          <NavLink role="menuitem" to="/settings" onClick={() => setOpen(false)}>Settings</NavLink>
          <button type="button" role="menuitem" onClick={onLogout}>Sign out</button>
        </div>
      )}
    </div>
  );
}

export default function AppShell() {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const title = pathname.startsWith('/runs/') ? 'Run details' : TITLES[pathname] ?? 'Automation overview';
  const items = useMemo(() => (user?.role === 'admin' ? [...baseNavigation, adminNavigation] : baseNavigation), [user?.role]);
  // Re-read saved settings on navigation so the header reflects changes made on the Settings page.
  const config = useMemo(() => loadAutomationConfig(), [pathname]);
  const modeLabel = config.dryRun === false ? 'Live mode' : 'Dry-run mode';
  const browserLabel = config.browserMode === 'headless' ? 'Headless browser' : 'Visible browser';

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <aside className="sidebar">
        <NavLink className="brand" to="/" aria-label="FormPilot dashboard">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span><strong>FormPilot</strong><small>Automation console</small></span>
        </NavLink>
        <Navigation className="side-navigation" items={items} />
        <div className="sidebar-footer">
          <span className="environment-dot" aria-hidden="true" />
          <span><strong>System ready</strong><small>{modeLabel} · {browserLabel}</small></span>
        </div>
      </aside>

      <div className="app-workspace">
        <header className="topbar">
          <div><span className="eyebrow">Workspace</span><p className="topbar-title">{title}</p></div>
          <div className="topbar-actions">
            <span className={`mode-pill${config.dryRun === false ? ' mode-live' : ''}`}><span aria-hidden="true" /> {config.dryRun === false ? 'Live' : 'Dry run'}</span>
            <ThemeToggle />
            <UserMenu user={user} onLogout={logout} />
          </div>
        </header>
        <div className="page-container" id="main-content" tabIndex="-1"><Outlet /></div>
      </div>

      <Navigation className="mobile-navigation" items={items} />
    </div>
  );
}
