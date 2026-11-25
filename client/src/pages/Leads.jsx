import { useState } from 'react';
import { Link } from 'react-router';
import { api, useLoad } from '../api.js';
import { STATUS_LABELS, STAGE_COLORS, timeAgo } from '../labels.js';
import { Icon } from '../icons.jsx';

export function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('');
}

export function Score({ lead }) {
  if (lead.score == null) return <span className="muted small">Not scored</span>;
  return (
    <span className={`score ${lead.temperature}`} title={`${lead.temperature} lead`}>
      <span className="score-bar"><span style={{ width: `${lead.score}%` }} /></span>
      {lead.score}
    </span>
  );
}

function Pipeline({ leads }) {
  const counts = Object.keys(STATUS_LABELS).map((status) => [status, leads.filter((l) => l.status === status).length]);
  return (
    <section className="pipeline" aria-label="Pipeline">
      <div className="pipeline-bar">
        {counts.filter(([, n]) => n > 0).map(([status, n]) => (
          <span key={status} style={{ flex: n, background: STAGE_COLORS[status] }} title={`${STATUS_LABELS[status]}: ${n}`} />
        ))}
      </div>
      <div className="pipeline-legend">
        {counts.map(([status, n]) => <span key={status}><b>{n}</b>{STATUS_LABELS[status]}</span>)}
      </div>
    </section>
  );
}

export default function Leads() {
  const { data: leads, error, reload } = useLoad(() => api('/leads'), []);
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState('');

  async function addLead(event) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api('/leads', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      form.reset();
      setFormError('');
      setAdding(false);
      reload();
    } catch (err) {
      setFormError(err.message);
    }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Leads</h1>
          <p>Call a lead and the agent qualifies them, answers from your documents and books the demo.</p>
        </div>
        <button type="button" className={`btn ${adding ? 'quiet' : ''}`} onClick={() => setAdding(!adding)}>
          <Icon name={adding ? 'close' : 'plus'} size={16} />{adding ? 'Cancel' : 'Add lead'}
        </button>
      </header>

      {adding && (
        <form className="panel add-lead" onSubmit={addLead}>
          <label className="field">Name<input name="name" required maxLength={120} autoFocus placeholder="Rahul Sharma" /></label>
          <label className="field">Company<input name="company" maxLength={120} placeholder="Acme Textiles" /></label>
          <label className="field">Phone<input name="phone" maxLength={30} placeholder="+91 98765 43210" /></label>
          <label className="field">Email<input name="email" type="email" maxLength={160} placeholder="rahul@acme.in" /></label>
          <button type="submit" className="btn">Save lead</button>
        </form>
      )}
      {formError && <p className="notice error">{formError}</p>}
      {error && <p className="notice error">{error.message}</p>}

      {leads && <Pipeline leads={leads} />}

      <section className="list" aria-label="All leads">
        <div className="list-head" aria-hidden="true">
          <span>Lead</span><span>Stage</span><span>Score</span><span>Last activity</span><span />
        </div>
        {leads?.map((lead) => (
          <div key={lead._id} className="lead-row">
            <div className="who">
              <span className="avatar" aria-hidden="true">{initials(lead.name)}</span>
              <div>
                <Link to={`/leads/${lead._id}`}>{lead.name}</Link>
                <div className="muted">{lead.company || lead.email || lead.phone || 'No company added'}</div>
              </div>
            </div>
            <span className={`status ${lead.status}`}>{STATUS_LABELS[lead.status]}</span>
            <Score lead={lead} />
            <span className="muted small">{timeAgo(lead.updatedAt)}</span>
            <Link className="btn small" to={`/call/${lead._id}`} aria-label={`Call ${lead.name}`}><Icon name="phone" size={15} />Call</Link>
          </div>
        ))}
        {leads?.length === 0 && (
          <div className="empty">
            <strong>No leads yet</strong>
            Add your first lead, then press Call to hear the agent.
          </div>
        )}
      </section>
    </>
  );
}
