import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiRequest, getOperatorErrorMessage } from '../api/httpClient.js';
import { useAuth } from '../auth/AuthContext.jsx';
import AuthLayout from '../components/AuthLayout.jsx';
import PasswordField, { passwordProblem } from '../components/PasswordField.jsx';

export default function AcceptInvitePage() {
  const { token } = useParams();
  const { acceptInvite } = useAuth();
  const navigate = useNavigate();
  const [invite, setInvite] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState({ username: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    apiRequest(`/auth/invites/${encodeURIComponent(token)}`).then((data) => active && setInvite(data)).catch((err) => active && setLoadError(getOperatorErrorMessage(err)));
    return () => { active = false; };
  }, [token]);

  async function submit(event) {
    event.preventDefault();
    setError('');
    const username = form.username.trim();
    const problem = !/^[a-zA-Z0-9._-]{3,32}$/.test(username) ? 'Username must be 3-32 letters, numbers, dots, dashes or underscores.' : passwordProblem(form.password) || (form.password !== form.confirm ? 'Passwords do not match.' : '');
    if (problem) return setError(problem);
    setBusy(true);
    try { await acceptInvite(token, { username, password: form.password }); navigate('/', { replace: true }); }
    catch (err) { setError(getOperatorErrorMessage(err)); setBusy(false); }
  }

  if (loadError) return <AuthLayout title="Invitation unavailable" subtitle={loadError} footer={<Link to="/login">Go to sign in</Link>} />;
  if (!invite) return <AuthLayout title="Checking your invitation…" />;

  return (
    <AuthLayout title="Join FormPilot" subtitle={`${invite.invitedBy} invited you as ${invite.role}. Pick a username and password to finish.`}>
      <form className="auth-form" onSubmit={submit} noValidate>
        <label className="field"><span>Email</span><input value={invite.email} readOnly disabled /></label>
        <label className="field"><span>Choose a username</span><input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="username" autoFocus required /><small>3-32 characters: letters, numbers, . _ -</small></label>
        <PasswordField value={form.password} onChange={(v) => setForm({ ...form, password: v })} showMeter />
        <PasswordField label="Confirm password" name="confirm" value={form.confirm} onChange={(v) => setForm({ ...form, confirm: v })} />
        {error && <p className="control-error" role="alert">{error}</p>}
        <button className="primary-button auth-submit" disabled={busy}>{busy ? 'Creating account…' : 'Create my account'}</button>
      </form>
    </AuthLayout>
  );
}
