import ThemeToggle from './ThemeToggle.jsx';

export default function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="auth-screen">
      <ThemeToggle className="auth-theme" />
      <div className="orb orb-a" aria-hidden="true" /><div className="orb orb-b" aria-hidden="true" />
      <main className="auth-card">
        <div className="auth-brand"><span className="brand-mark" aria-hidden="true"><span /></span><strong>FormPilot</strong></div>
        <h1>{title}</h1>
        {subtitle && <p className="auth-subtitle">{subtitle}</p>}
        {children}
        {footer && <p className="auth-footer">{footer}</p>}
      </main>
    </div>
  );
}
