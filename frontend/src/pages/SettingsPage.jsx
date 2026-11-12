import ConfigurationForm from '../components/ConfigurationForm.jsx';
import ContactProfileForm from '../components/ContactProfileForm.jsx';
import { loadAutomationConfig, loadContactProfile, saveAutomationConfig, saveContactProfile } from '../utils/settingsStorage.js';

export default function SettingsPage() {
  return (
    <main className="page" aria-labelledby="settings-title">
      <section className="page-heading compact"><div><span className="eyebrow">Configuration</span><h1 id="settings-title">Settings</h1><p>Manage automation defaults, Google Sheets access, and contact information.</p></div></section>
      <ConfigurationForm initialConfig={loadAutomationConfig()} onSave={saveAutomationConfig} />
      <ContactProfileForm initialProfile={loadContactProfile()} onSave={saveContactProfile} />
    </main>
  );
}
