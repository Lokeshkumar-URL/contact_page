import { NavLink, Outlet, useLocation } from 'react-router-dom';

const navigation = [
  { to: '/', label: 'Dashboard', icon: 'grid', end: true },
  { to: '/runs', label: 'Runs', icon: 'activity' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

function Icon({ name }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    activity: <path d="M3 12h4l2.5-6 5 12 2.5-6h4"/>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19 15.5 21 17l-4 4-1.5-2A8 8 0 0 1 13 20v2H8v-2a8 8 0 0 1-2.5-1L4 21l-4-4 2-1.5A8 8 0 0 1 1 13h2V8H1a8 8 0 0 1 1-2.5L0 4l4-4 1.5 2A8 8 0 0 1 8 1V-1h5V1a8 8 0 0 1 2.5 1L17 0l4 4-2 1.5A8 8 0 0 1 20 8h2v5h-2a8 8 0 0 1-1 2.5Z"/></>,
  };
  return <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function Navigation({ className }) {
  return (
    <nav className={className} aria-label="Primary navigation">
      {navigation.map(({ to, label, icon, end }) => (
        <NavLink key={label} to={to} end={end} className="nav-link">
          <Icon name={icon} /><span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export default function AppShell() {
  const { pathname } = useLocation();
  const title = pathname === '/settings' ? 'Settings' : pathname.startsWith('/runs/') ? 'Run details' : 'Automation overview';

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <aside className="sidebar">
        <NavLink className="brand" to="/" aria-label="FormPilot dashboard">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span><strong>FormPilot</strong><small>Automation console</small></span>
        </NavLink>
        <Navigation className="side-navigation" />
        <div className="sidebar-footer">
          <span className="environment-dot" aria-hidden="true" />
          <span><strong>System ready</strong><small>Dry-run mode</small></span>
        </div>
      </aside>

      <div className="app-workspace">
        <header className="topbar">
          <div><span className="eyebrow">Workspace</span><p className="topbar-title">{title}</p></div>
          <div className="topbar-actions">
            <span className="mode-pill"><span aria-hidden="true" /> Dry run</span>
            <button className="avatar" type="button" aria-label="Open user menu">PJ</button>
          </div>
        </header>
        <div className="page-container" id="main-content" tabIndex="-1"><Outlet /></div>
      </div>

      <Navigation className="mobile-navigation" />
    </div>
  );
}
