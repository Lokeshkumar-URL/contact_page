import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRequest, getOperatorErrorMessage } from '../api/httpClient.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useToast } from '../components/Toasts.jsx';

const ago = (iso) => {
  if (!iso) return 'Never';
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
};
const until = (iso) => { const hours = Math.round((Date.parse(iso) - Date.now()) / 3600e3); return hours <= 0 ? 'expired' : hours < 48 ? `${hours}h left` : `${Math.round(hours / 24)}d left`; };

function Stat({ label, value, tone }) { return <div className={`stat-tile ${tone ?? ''}`}><strong>{value}</strong><span>{label}</span></div>; }

export default function AdminPage() {
  const { user: me, mailConfigured } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('user');
  const [sending, setSending] = useState(false);
  const [manualLink, setManualLink] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      const [u, i] = await Promise.all([apiRequest('/admin/users'), apiRequest('/admin/invites')]);
      setUsers(u.users); setInvites(i.invites);
    } catch (err) { toast(getOperatorErrorMessage(err), 'error'); }
    finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn, success) => { try { const result = await fn(); if (success) toast(success); await load(); return result; } catch (err) { toast(getOperatorErrorMessage(err), 'error'); return null; } };

  async function sendInvite(event) {
    event.preventDefault();
    setSending(true); setManualLink(null);
    const result = await act(() => apiRequest('/admin/invites', { method: 'POST', body: JSON.stringify({ email: email.trim(), role }) }));
    setSending(false);
    if (!result) return;
    setEmail('');
    if (result.invite.emailSent) toast(`Invitation emailed to ${result.invite.email}.`);
    else setManualLink({ email: result.invite.email, link: result.invite.link, reason: result.invite.emailError });
  }
  const resend = async (invite) => {
    const result = await act(() => apiRequest(`/admin/invites/${invite.id}/resend`, { method: 'POST' }));
    if (!result) return;
    if (result.invite.emailSent) toast(`Invitation re-sent to ${invite.email}.`); else setManualLink({ email: invite.email, link: result.invite.link, reason: result.invite.emailError });
  };
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); toast('Link copied to clipboard.'); } catch { toast('Copy failed — select the link and copy it manually.', 'error'); } };

  const pending = invites.filter((i) => i.status !== 'accepted');
  const shown = useMemo(() => users.filter((u) => `${u.username} ${u.email}`.toLowerCase().includes(query.trim().toLowerCase())), [users, query]);
  const admins = users.filter((u) => u.role === 'admin' && u.status === 'active').length;

  return (
    <main className="page" aria-labelledby="admin-title">
      <section className="page-heading compact"><div><span className="eyebrow">Administration</span><h1 id="admin-title">Team &amp; access</h1><p>Invite teammates by email. They choose their own username and password.</p></div></section>

      <div className="stat-row">
        <Stat label="Members" value={users.length} /><Stat label="Admins" value={admins} /><Stat label="Pending invites" value={pending.filter((i) => i.status === 'pending').length} tone="warm" />
      </div>

      <section className="admin-card">
        <div className="section-heading-row"><div><span className="section-kicker">Invite</span><h2>Add a teammate</h2></div></div>
        <form className="invite-form" onSubmit={sendInvite}>
          <label className="field"><span>Email address</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" required /></label>
          <div className="segmented" role="radiogroup" aria-label="Role">
            {['user', 'admin'].map((r) => <label key={r} className={role === r ? 'selected' : ''}><input type="radio" name="role" checked={role === r} onChange={() => setRole(r)} />{r === 'admin' ? 'Admin' : 'Member'}</label>)}
          </div>
          <button className="primary-button" disabled={sending || !email}>{sending ? 'Sending…' : mailConfigured ? 'Send invitation' : 'Create invite link'}</button>
        </form>
        {!mailConfigured && <p className="control-notice">Email (SMTP) isn't configured on the server, so no email will be sent. You'll get a link to share yourself. Set <code>SMTP_HOST</code> in <code>backend/.env</code> to enable emails.</p>}
        {manualLink && (
          <div className="link-box" role="status">
            <div><strong>Share this link with {manualLink.email}</strong>{manualLink.reason && <small>Email not sent: {manualLink.reason}</small>}<code>{manualLink.link}</code></div>
            <button type="button" className="secondary-button" onClick={() => copy(manualLink.link)}>Copy link</button>
          </div>
        )}
      </section>

      {pending.length > 0 && (
        <section className="admin-card">
          <div className="section-heading-row"><div><span className="section-kicker">Waiting</span><h2>Pending invitations</h2></div></div>
          <ul className="row-list">
            {pending.map((i) => (
              <li key={i.id}>
                <div className="who"><span className="mini-avatar">{i.email[0].toUpperCase()}</span><div><strong>{i.email}</strong><small>{i.role === 'admin' ? 'Admin' : 'Member'} · invited by {i.invitedBy} · {i.status === 'expired' ? 'expired' : until(i.expiresAt)}</small></div></div>
                <div className="row-actions">
                  <button className="text-button" onClick={() => resend(i)}>{i.status === 'expired' ? 'Send new link' : 'Resend'}</button>
                  <button className="text-button danger" onClick={() => act(() => apiRequest(`/admin/invites/${i.id}`, { method: 'DELETE' }), 'Invitation revoked.')}>Revoke</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="admin-card">
        <div className="section-heading-row"><div><span className="section-kicker">People</span><h2>Members</h2></div><label className="search-field"><span aria-hidden="true">⌕</span><input placeholder="Search members" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search members" /></label></div>
        {loading ? <p className="table-state">Loading…</p> : shown.length === 0 ? <p className="table-state">No members match.</p> : (
          <ul className="row-list">
            {shown.map((u) => {
              const self = u.id === me.id;
              return (
                <li key={u.id} className={u.status === 'disabled' ? 'is-disabled' : ''}>
                  <div className="who"><span className="mini-avatar">{u.username[0].toUpperCase()}</span><div><strong>{u.username}{self && <em className="you">you</em>}</strong><small>{u.email} · last active {ago(u.lastLoginAt)}</small></div></div>
                  <div className="row-actions">
                    <select aria-label={`Role for ${u.username}`} value={u.role} disabled={self} onChange={(e) => act(() => apiRequest(`/admin/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ role: e.target.value }) }), `${u.username} is now ${e.target.value === 'admin' ? 'an admin' : 'a member'}.`)}>
                      <option value="user">Member</option><option value="admin">Admin</option>
                    </select>
                    <button className="text-button" disabled={self} onClick={() => act(() => apiRequest(`/admin/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ status: u.status === 'active' ? 'disabled' : 'active' }) }), u.status === 'active' ? `${u.username} disabled.` : `${u.username} re-enabled.`)}>{u.status === 'active' ? 'Disable' : 'Enable'}</button>
                    {confirmDelete === u.id
                      ? <><button className="text-button danger" onClick={() => { setConfirmDelete(null); void act(() => apiRequest(`/admin/users/${u.id}`, { method: 'DELETE' }), `${u.username} removed.`); }}>Confirm</button><button className="text-button" onClick={() => setConfirmDelete(null)}>Cancel</button></>
                      : <button className="text-button danger" disabled={self} onClick={() => setConfirmDelete(u.id)}>Remove</button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
