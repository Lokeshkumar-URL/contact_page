import { useState } from 'react';
import {
  DEFAULT_CONTACT_PROFILE,
  normalizeContactProfile,
  validateContactProfile,
} from '../utils/contactProfile.js';

function ProfileField({ label, name, value, error, onChange, ...inputProps }) {
  const errorId = `${name}-profile-error`;
  return (
    <label className="field">
      <span>{label}</span>
      <input name={name} value={value} onChange={onChange} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} {...inputProps} />
      {error && <span className="field-error" id={errorId} role="alert">{error}</span>}
    </label>
  );
}

export default function ContactProfileForm({ initialProfile = {}, onSave }) {
  const initial = { ...DEFAULT_CONTACT_PROFILE, ...initialProfile };
  const [profile, setProfile] = useState(initial);
  const [errors, setErrors] = useState({});
  const [saved, setSaved] = useState(false);

  function updateField(event) {
    const { name, value } = event.target;
    setProfile((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
    setSaved(false);
  }

  function handleSubmit(event) {
    event.preventDefault();
    const nextErrors = validateContactProfile(profile);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const normalized = normalizeContactProfile(profile);
    setProfile(normalized);
    onSave?.(normalized);
    setSaved(true);
  }

  function handleReset() {
    setProfile(initial);
    setErrors({});
    setSaved(false);
  }

  return (
    <form className="configuration-form profile-form" onSubmit={handleSubmit} noValidate>
      <div className="form-section-heading">
        <div><span className="section-number">03</span><h2>Contact profile</h2><p>These approved values are used to fill matching website fields.</p></div>
        <span className="privacy-badge">No API keys stored here</span>
      </div>

      <div className="form-grid two-column">
        <ProfileField label="First name" name="firstName" value={profile.firstName} error={errors.firstName} onChange={updateField} autoComplete="given-name" />
        <ProfileField label="Last name" name="lastName" value={profile.lastName} error={errors.lastName} onChange={updateField} autoComplete="family-name" />
        <ProfileField label="Job title" name="title" value={profile.title} error={errors.title} onChange={updateField} autoComplete="organization-title" />
        <ProfileField label="Organization" name="organization" value={profile.organization} error={errors.organization} onChange={updateField} autoComplete="organization" />
        <ProfileField label="Email" name="email" type="email" value={profile.email} error={errors.email} onChange={updateField} autoComplete="email" />
        <ProfileField label="Phone" name="phone" type="tel" value={profile.phone} error={errors.phone} onChange={updateField} autoComplete="tel" />
      </div>

      <div className="form-divider" />
      <div className="form-section-heading compact-section"><div><span className="section-number muted-number">04</span><h2>Business address</h2><p>Optional fields are used only when a matching form field exists.</p></div></div>
      <div className="form-grid address-grid">
        <label className="field street-field"><span>Street address</span><input name="streetAddress" value={profile.streetAddress} onChange={updateField} autoComplete="street-address" /></label>
        <label className="field"><span>City</span><input name="city" value={profile.city} onChange={updateField} autoComplete="address-level2" /></label>
        <label className="field"><span>State</span><input name="state" value={profile.state} onChange={updateField} autoComplete="address-level1" /></label>
        <label className="field"><span>ZIP code</span><input name="zipCode" value={profile.zipCode} onChange={updateField} autoComplete="postal-code" /></label>
      </div>

      <div className="form-divider" />
      <label className="field message-field">
        <span>Approved contact message</span>
        <textarea name="message" value={profile.message} onChange={updateField} maxLength="1000" rows="6" placeholder="Enter the reviewed message that may be submitted to websites…" aria-invalid={Boolean(errors.message)} aria-describedby={errors.message ? 'message-profile-error' : 'message-help'} />
        <div className="textarea-meta"><small id="message-help">Use a reviewed, accurate message. Claude will not rewrite it automatically.</small><small>{profile.message.length}/1000</small></div>
        {errors.message && <span className="field-error" id="message-profile-error" role="alert">{errors.message}</span>}
      </label>

      <div className="form-actions">
        <span className="save-status" role="status">{saved ? 'Contact profile saved for this session.' : 'Review the profile before running automation.'}</span>
        <div className="button-group"><button className="secondary-button" type="button" onClick={handleReset}>Reset changes</button><button className="primary-button" type="submit">Save contact profile</button></div>
      </div>
    </form>
  );
}
