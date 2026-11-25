import { useState } from 'react';
import { api, useLoad } from '../api.js';
import { LANGUAGE_NAMES } from '../labels.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function Settings() {
  const { data, error } = useLoad(() => api('/settings'), []);
  const [message, setMessage] = useState(null);

  if (error) return <p className="notice error">{error.message}</p>;
  if (!data) return <p className="muted">Loading settings…</p>;
  const { settings, voices } = data;

  async function save(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form);
    body.workDays = form.getAll('workDays').map(Number);
    try {
      await api('/settings', { method: 'PUT', body });
      setMessage({ kind: 'ok', text: 'Saved. The next call uses these settings.' });
    } catch (err) {
      setMessage({ kind: 'error', text: err.message });
    }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Agent</h1>
          <p>Change how the agent introduces itself, what it sells and when it books demos. No restart needed.</p>
        </div>
      </header>
      <form className="panel" onSubmit={save}>
        <section className="settings-section">
          <div><h2>Who is calling</h2><p>The name and company the agent uses when it introduces itself.</p></div>
          <div className="stack">
            <div className="grid-2">
              <label className="field">Agent name<input name="agentName" defaultValue={settings.agentName} required maxLength={60} /></label>
              <label className="field">Company<input name="companyName" defaultValue={settings.companyName} required maxLength={80} /></label>
            </div>
            <label className="field">
              Pitch and goal
              <span className="hint">What you sell and what a good call ends with. Facts and prices belong in Knowledge.</span>
              <textarea name="pitch" rows={4} defaultValue={settings.pitch} required maxLength={3000} />
            </label>
          </div>
        </section>

        <section className="settings-section">
          <div><h2>Voice and language</h2><p>Every voice speaks all ten supported Indian languages.</p></div>
          <div className="grid-2">
            <label className="field">Voice
              <select name="voice" defaultValue={settings.voice}>{voices.map((v) => <option key={v}>{v}</option>)}</select>
            </label>
            <label className="field">Listen for
              <select name="sttLanguages" defaultValue={settings.sttLanguages}>
                {Object.entries(LANGUAGE_NAMES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
            </label>
          </div>
        </section>

        <section className="settings-section">
          <div><h2>Demo calendar</h2><p>The agent only offers free slots inside these hours, in India time.</p></div>
          <div className="stack">
            <fieldset className="days-field">
              <legend>Days</legend>
              <div className="day-toggles">
                {DAYS.map((day, i) => (
                  <label key={day}><input type="checkbox" name="workDays" value={i} defaultChecked={settings.workDays.includes(i)} /><span>{day}</span></label>
                ))}
              </div>
            </fieldset>
            <div className="grid-2">
              <label className="field">From<input name="workStart" type="time" defaultValue={settings.workStart} required /></label>
              <label className="field">Until<input name="workEnd" type="time" defaultValue={settings.workEnd} required /></label>
            </div>
            <label className="field narrow">Demo length
              <select name="slotMinutes" defaultValue={settings.slotMinutes}>{[15, 30, 45, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}</select>
            </label>
          </div>
        </section>

        <div className="save-bar">
          {message && <span className={`notice ${message.kind}`}>{message.text}</span>}
          <button type="submit" className="btn">Save changes</button>
        </div>
      </form>
    </>
  );
}
