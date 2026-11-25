import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api, session } from '../api.js';

export default function Login() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const { token } = await api('/login', { method: 'POST', body: { email: form.get('email'), password: form.get('password') } });
      session.save(token);
      navigate('/');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <section className="login-art">
        <div className="login-orbs" aria-hidden="true"><span /><span /></div>
        <div>
          <h1>Every lead gets a call, in their language</h1>
          <p>An AI sales agent that answers from your documents, qualifies leads and books demos, then writes it all into your CRM.</p>
        </div>
        <p className="small">English, Hindi and eight more Indian languages.</p>
      </section>
      <section className="login-form">
        <form onSubmit={submit}>
          <h2>Log in</h2>
          <label className="field">Email<input name="email" type="email" autoComplete="username" required /></label>
          <label className="field">Password<input name="password" type="password" autoComplete="current-password" required /></label>
          {error && <p className="notice error">{error}</p>}
          <button type="submit" className="btn" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
        </form>
      </section>
    </div>
  );
}
