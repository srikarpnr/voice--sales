import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, useLoad } from '../api.js';
import { STATUS_LABELS, LANGUAGE_NAMES, formatIst, duration } from '../labels.js';
import { Icon } from '../icons.jsx';
import { Score, initials } from './Leads.jsx';

const QUALIFICATION = [['budget', 'Budget'], ['authority', 'Decides'], ['need', 'Need'], ['timeline', 'Timeline'], ['interest', 'Interest'], ['notes', 'Notes']];

export function Qualification({ lead }) {
  const q = lead.qualification ?? {};
  return (
    <dl className="facts">
      {QUALIFICATION.map(([key, label]) => (
        <div key={key}><dt>{label}</dt><dd>{q[key] || <span className="unknown">Not known yet</span>}</dd></div>
      ))}
    </dl>
  );
}

const callLength = (call) => (call.endedAt ? duration((new Date(call.endedAt) - new Date(call.startedAt)) / 1000) : 'live');
const awaitingAnalysis = (call) => call.status === 'live'
  || (!call.analysis?.summary && call.transcript.some((t) => t.role === 'lead') && Date.now() - new Date(call.endedAt) < 120_000);

function CallCard({ call, leadName }) {
  const a = call.analysis;
  return (
    <article className="call-card">
      <header>
        <strong>{formatIst(call.startedAt)}</strong>
        <div className="row">
          <span className="muted small">{callLength(call)}</span>
          {a?.sentiment && <span className={`temp ${a.sentiment}`}>{a.sentiment}</span>}
          {a?.leadScore != null && <span className="muted small">score {a.leadScore}</span>}
        </div>
      </header>
      {a?.summary ? (
        <>
          <p>{a.summary}</p>
          {a.nextStep && <p><b>Next step:</b> {a.nextStep}</p>}
          {a.objections.length > 0 && <div className="chips">{a.objections.map((o) => <span key={o} className="chip">{o}</span>)}</div>}
        </>
      ) : (
        <p className="muted">{awaitingAnalysis(call) ? 'Writing the summary…' : 'No summary: the lead did not speak.'}</p>
      )}
      {call.languages.length > 0 && <p className="muted small">Spoken in {call.languages.map((l) => LANGUAGE_NAMES[l] ?? l).join(' and ')}</p>}
      {call.transcript.length > 0 && (
        <details className="transcript-log">
          <summary>Transcript</summary>
          {call.transcript.map((line, i) => (
            <p key={i} className={`log-line ${line.role}`}><b>{line.role === 'agent' ? 'Agent' : leadName}</b>{line.text}</p>
          ))}
        </details>
      )}
    </article>
  );
}

export default function LeadDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, error, reload } = useLoad(() => api(`/leads/${id}`), [id]);

  // The summary is written a few seconds after a call ends; refresh until it lands.
  const waiting = data?.calls.some(awaitingAnalysis);
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setTimeout(reload, 3000);
    return () => clearTimeout(timer);
  }, [waiting, data, reload]);

  if (error) return <p className="notice error">{error.message}</p>;
  if (!data) return <p className="muted">Loading lead…</p>;
  const { lead, calls, meetings } = data;
  const upcoming = meetings.filter((m) => m.status === 'booked');

  async function setStatus(status) {
    await api(`/leads/${id}`, { method: 'PATCH', body: { status } });
    reload();
  }

  async function remove() {
    if (!window.confirm(`Delete ${lead.name} with all calls and demos?`)) return;
    await api(`/leads/${id}`, { method: 'DELETE' });
    navigate('/');
  }

  return (
    <>
      <section className="lead-hero">
        <span className="avatar" aria-hidden="true">{initials(lead.name)}</span>
        <div className="grow">
          <h1>{lead.name}</h1>
          <div className="contact">
            {lead.company && <span>{lead.company}</span>}
            {lead.phone && <span>{lead.phone}</span>}
            {lead.email && <a href={`mailto:${lead.email}`}>{lead.email}</a>}
          </div>
        </div>
        <Score lead={lead} />
        <Link className="btn" to={`/call/${lead._id}`}><Icon name="phone" size={16} />Call {lead.name.split(' ')[0]}</Link>
      </section>

      <div className="detail-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Calls</h2>
            <span className="muted small">{calls.length === 1 ? '1 call' : `${calls.length} calls`}</span>
          </div>
          {calls.length === 0 ? (
            <div className="empty"><strong>No calls yet</strong>Press Call and the agent introduces itself and starts qualifying.</div>
          ) : calls.map((call) => <CallCard key={call._id} call={call} leadName={lead.name.split(' ')[0]} />)}
        </section>

        <div className="stack">
          <section className="panel stack">
            <label className="field">
              Stage
              <select value={lead.status} onChange={(e) => setStatus(e.target.value)}>
                {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <div>
              <h3 className="panel-title">Qualification</h3>
              <Qualification lead={lead} />
            </div>
          </section>
          <section className="panel">
            <h3 className="panel-title">What the agent remembers</h3>
            {lead.memory.length
              ? <ul className="memory">{lead.memory.map((fact, i) => <li key={i}>{fact}</li>)}</ul>
              : <p className="muted">Facts from each call land here and are used on the next one.</p>}
          </section>
          <section className="panel">
            <h3 className="panel-title">Demos</h3>
            {upcoming.length
              ? <ul className="memory">{upcoming.map((m) => <li key={m._id}>{formatIst(m.start, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}, {m.topic}</li>)}</ul>
              : <p className="muted">No demo booked yet.</p>}
          </section>
          <button type="button" className="link-btn danger" onClick={remove}><Icon name="trash" size={16} />Delete lead</button>
        </div>
      </div>
    </>
  );
}
