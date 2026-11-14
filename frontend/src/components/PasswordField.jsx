import { useId, useState } from 'react';

export function scorePassword(value) {
  let score = 0;
  if (value.length >= 10) score++;
  if (value.length >= 14) score++;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++;
  if (/\d/.test(value)) score++;
  if (/[^a-zA-Z0-9]/.test(value)) score++;
  return Math.min(score, 4);
}
export const passwordProblem = (value) => (value.length < 10 ? 'Use at least 10 characters.' : !/[a-zA-Z]/.test(value) || !/\d/.test(value) ? 'Include at least one letter and one number.' : '');

const LABELS = ['Too weak', 'Weak', 'Okay', 'Strong', 'Excellent'];

export default function PasswordField({ label = 'Password', value, onChange, showMeter = false, autoComplete = 'new-password', error, name = 'password' }) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  const score = value ? scorePassword(value) : -1;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="password-input">
        <input id={id} name={name} type={visible ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} aria-invalid={Boolean(error)} required />
        <button type="button" className="reveal" onClick={() => setVisible((v) => !v)} aria-pressed={visible} aria-label={visible ? 'Hide password' : 'Show password'}>{visible ? 'Hide' : 'Show'}</button>
      </div>
      {showMeter && value && <div className="strength" data-score={score}><span /><span /><span /><span /><em>{LABELS[score]}</em></div>}
      {error && <span className="field-error" role="alert">{error}</span>}
    </div>
  );
}
