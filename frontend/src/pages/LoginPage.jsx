import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { getOperatorErrorMessage } from '../api/httpClient.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { Splash } from '../auth/RouteGuards.jsx';
import AuthLayout from '../components/AuthLayout.jsx';
import PasswordField, { passwordProblem } from '../components/PasswordField.jsx';

export default function LoginPage() {
  const { loading, user, setupRequired, login, setup } = useAuth();
  const navigate = useNavigate();
  const destination = useLocation().state?.from ?? '/';
  const [form, setForm] = useState({ identifier: '', username: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: typeof value === 'string' ? value : value.target.value }));

  if (loading) return <Splash />;
  if (user) return <Navigate to={destination} replace />;

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (setupRequired) {
      const problem = passwordProblem(form.password) || (form.password !== form.confirm ? 'Passwords do not match.' : '');
      if (problem) return setError(problem);
    }
    setBusy(true);
    try {
      if (setupRequired) await setup({ username: form.username.trim(), email: form.email.trim(), password: form.password });
      else await login(form.identifier.trim(), form.password);
      navigate(destination, { replace: true });
    } catch (err) {
      setError(getOperatorErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title={setupRequired ? 'Create the admin account' : 'Welcome back'}
      subtitle={setupRequired ? 'First-time setup. This account will be able to invite everyone else.' : 'Sign in to run and monitor your outreach.'}
      footer={setupRequired ? null : 'Need access? Ask your admin for an invitation.'}
    >
      <form className="auth-form" onSubmit={submit} noValidate>
        {setupRequired ? (
          <>
            <label className="field"><span>Username</span><input value={form.username} onChange={set('username')} autoComplete="username" autoFocus required /></label>
            <label className="field"><span>Email</span><input type="email" value={form.email} onChange={set('email')} autoComplete="email" required /></label>
            <PasswordField value={form.password} onChange={set('password')} showMeter />
            <PasswordField label="Confirm password" name="confirm" value={form.confirm} onChange={set('confirm')} />
          </>
        ) : (
          <>
            <label className="field"><span>Username or email</span><input value={form.identifier} onChange={set('identifier')} autoComplete="username" autoFocus required /></label>
            <PasswordField value={form.password} onChange={set('password')} autoComplete="current-password" />
          </>
        )}
        {error && <p className="control-error" role="alert">{error}</p>}
        <button className="primary-button auth-submit" disabled={busy}>{busy ? 'Please wait…' : setupRequired ? 'Create admin account' : 'Sign in'}</button>
      </form>
    </AuthLayout>
  );
}
