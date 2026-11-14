import nodemailer from 'nodemailer';

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ENTITIES[c]);

export function createMailer(settings = {}, { transportFactory = nodemailer.createTransport } = {}) {
  const configured = Boolean(settings.smtpHost);
  const port = settings.smtpPort ?? 587;
  const transport = configured ? transportFactory({ host: settings.smtpHost, port, secure: settings.smtpSecure ?? port === 465, auth: settings.smtpUser ? { user: settings.smtpUser, pass: settings.smtpPass } : undefined }) : null;
  const from = settings.mailFrom || settings.smtpUser || 'FormPilot <no-reply@localhost>';

  return {
    configured,
    async sendInvite({ to, link, invitedBy, expiresAt, role }) {
      if (!transport) return { sent: false, reason: 'SMTP is not configured.' };
      const expires = new Date(expiresAt).toUTCString();
      const text = `${invitedBy} invited you to FormPilot as ${role}.\n\nAccept the invitation and choose your username and password:\n${link}\n\nThis link expires on ${expires}. If you were not expecting it, ignore this email.`;
      const html = `<div style="font-family:system-ui,sans-serif;background:#0b1020;padding:32px"><div style="max-width:480px;margin:auto;background:#141a2e;color:#e6e9f5;border-radius:16px;padding:32px"><h2 style="margin:0 0 12px">You're invited to FormPilot</h2><p style="color:#a9b1d0;line-height:1.6"><strong style="color:#fff">${escapeHtml(invitedBy)}</strong> invited you to join as <strong style="color:#fff">${escapeHtml(role)}</strong>. Choose a username and password to get started.</p><p style="margin:28px 0"><a href="${escapeHtml(link)}" style="background:#7c8cff;color:#0b1020;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;display:inline-block">Accept invitation</a></p><p style="color:#7d86a8;font-size:12px;line-height:1.5">Or paste this link into your browser:<br>${escapeHtml(link)}<br><br>Expires ${escapeHtml(expires)}. If you weren't expecting this, you can ignore it.</p></div></div>`;
      try { await transport.sendMail({ from, to, subject: 'You are invited to FormPilot', text, html }); return { sent: true }; }
      catch (error) { return { sent: false, reason: error.message }; }
    },
  };
}
