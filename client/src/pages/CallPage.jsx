import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, session, useLoad } from '../api.js';
import { startVoiceCall } from '../voice.js';
import { STATUS_LABELS, LANGUAGE_NAMES, duration } from '../labels.js';
import { Icon } from '../icons.jsx';
import { Qualification } from './LeadDetail.jsx';

const SPEAKING = 0.04;

function describeTool({ name, args }) {
  switch (name) {
    case 'search_knowledge': return `Checking the knowledge base for "${args.query}"`;
    case 'update_lead': return `Saved to CRM: ${Object.keys(args).join(', ')}`;
    case 'check_slots': return `Checking free demo times on ${args.date}`;
    case 'book_meeting': return 'Booking the demo';
    case 'end_call': return 'Wrapping up the call';
    default: return name;
  }
}

// Consecutive pieces from one speaker read as one message; agent actions sit between them.
function addLine(items, { role, text }) {
  const last = items.at(-1);
  if (last?.role === role) return [...items.slice(0, -1), { ...last, text: `${last.text} ${text}` }];
  return [...items, { role, text }];
}

export default function CallPage() {
  const { id } = useParams();
  const { data } = useLoad(() => api(`/leads/${id}`), [id]);
  const [phase, setPhase] = useState('idle');
  const [thinking, setThinking] = useState(false);
  const [speaker, setSpeaker] = useState('');
  const [items, setItems] = useState([]);
  const [liveLead, setLiveLead] = useState(null);
  const [language, setLanguage] = useState('');
  const [notice, setNotice] = useState(null);
  const [seconds, setSeconds] = useState(0);
  const callRef = useRef(null);
  const orbRef = useRef(null);
  const timelineRef = useRef(null);

  useEffect(() => () => callRef.current?.close(), []);

  useEffect(() => {
    timelineRef.current?.scrollTo({ top: timelineRef.current.scrollHeight });
  }, [items]);

  // Reads live audio levels every frame and drives the orb through CSS variables,
  // so the voice animation never re-renders React.
  useEffect(() => {
    if (phase !== 'live') return undefined;
    let frame;
    let current = '';
    const tick = () => {
      const { agent, lead } = callRef.current?.levels() ?? { agent: 0, lead: 0 };
      const voice = agent > SPEAKING ? 'agent' : lead > SPEAKING ? 'lead' : '';
      orbRef.current?.style.setProperty('--level', String(Math.max(agent, lead)));
      if (voice !== current) {
        current = voice;
        setSpeaker(voice);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const clock = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(clock);
    };
  }, [phase]);

  function onEvent(event) {
    switch (event.type) {
      case 'ready':
        setPhase('live');
        setLiveLead(event.lead);
        break;
      case 'state':
        setThinking(event.state === 'thinking');
        break;
      case 'transcript':
        setItems((prev) => addLine(prev, event));
        if (event.language) setLanguage(event.language);
        break;
      case 'tool':
        setItems((prev) => [...prev, { note: describeTool(event), icon: event.name === 'update_lead' ? 'check' : 'search' }]);
        break;
      case 'lead':
        setLiveLead(event.lead);
        if (event.result?.ok && event.result.when) setItems((prev) => [...prev, { note: `Demo booked for ${event.result.when}`, icon: 'check', done: true }]);
        break;
      case 'error':
        setNotice({ kind: 'error', text: event.message });
        break;
      case 'ended':
        setNotice({ kind: 'ok', text: event.reason === 'completed' ? 'The agent finished the call.' : 'Call ended.' });
        setPhase('ended');
        break;
      case 'closed':
        setPhase('ended');
        setSpeaker('');
        setThinking(false);
        if (event.code >= 4000) setNotice({ kind: 'error', text: event.reason });
        break;
      default:
    }
  }

  async function start() {
    setItems([]);
    setNotice(null);
    setSeconds(0);
    setLanguage('');
    setPhase('connecting');
    try {
      callRef.current = await startVoiceCall({ leadId: id, token: session.token, onEvent });
    } catch (err) {
      setPhase('idle');
      setNotice({ kind: 'error', text: err.name === 'NotAllowedError' ? 'Allow microphone access in the browser to start the call.' : err.message });
    }
  }

  const lead = liveLead ?? data?.lead;
  const firstName = lead?.name.split(' ')[0] ?? 'the lead';
  const voice = phase === 'live' ? speaker || (thinking ? 'thinking' : '') : '';
  const label = {
    idle: `Ready to call ${firstName}`,
    connecting: 'Connecting…',
    ended: 'Call ended',
    live: speaker === 'agent' ? 'Agent is speaking' : speaker === 'lead' ? `${firstName} is speaking` : thinking ? 'Agent is thinking' : 'Listening',
  }[phase];
  const live = phase === 'live' || phase === 'connecting';

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{lead ? `Call ${lead.name}` : 'Call'}</h1>
          <p>{lead?.company ? `${lead.company}. ` : ''}Speak in English, Hindi or Hinglish. Headphones keep the agent from hearing itself.</p>
        </div>
        <Link className="btn quiet" to={`/leads/${id}`}>Lead details</Link>
      </header>

      <div className="call-layout">
        <div className="stack">
          <section className="panel stage">
            <div className="orb" ref={orbRef} data-voice={voice}>
              <div className="orb-core"><Icon name={speaker === 'lead' ? 'user' : 'phone'} size={34} /></div>
            </div>
            <p className="speaker-label" aria-live="polite">{label}</p>
            <p className="timer">{phase === 'idle' ? 'Agent speaks first' : duration(seconds)}</p>
            {live ? (
              <button type="button" className="btn call-btn end" onClick={() => callRef.current?.hangUp()} aria-label="End call"><Icon name="hangup" size={28} /></button>
            ) : (
              <button type="button" className="btn call-btn start" onClick={start} disabled={!lead} aria-label={phase === 'ended' ? 'Call again' : 'Start call'}><Icon name="phone" size={26} /></button>
            )}
            <div className="voice-key"><span>Agent</span><span className="lead-key">{firstName}</span></div>
          </section>

          <section className="panel side-card">
            <h3>Live CRM card</h3>
            {lead && (
              <div className="stack">
                <div className="row">
                  <span className={`status ${lead.status}`}>{STATUS_LABELS[lead.status]}</span>
                  {lead.email && <span className="muted small">{lead.email}</span>}
                </div>
                <Qualification lead={lead} />
              </div>
            )}
          </section>
        </div>

        <section className="panel conversation" aria-label="Conversation">
          <div className="conversation-head">
            <h2>Conversation</h2>
            {language && <span className="chip">{LANGUAGE_NAMES[language] ?? language}</span>}
          </div>
          <div className="timeline" ref={timelineRef}>
            {notice && <p className={`notice ${notice.kind}`}>{notice.text} {phase === 'ended' && <Link to={`/leads/${id}`}>See the summary and score</Link>}</p>}
            {items.length === 0 && !notice && (
              <div className="empty">
                <strong>The conversation appears here</strong>
                Press the green button. The agent greets {firstName}, and you reply as the lead.
              </div>
            )}
            {items.map((item, i) => (item.note
              ? <p key={i} className={`note ${item.done ? 'done' : ''}`}><Icon name={item.icon} size={15} />{item.note}</p>
              : (
                <p key={i} className={`bubble ${item.role}`}>
                  <span className="who-said">{item.role === 'agent' ? 'Agent' : firstName}</span>
                  {item.text}
                </p>
              )))}
          </div>
        </section>
      </div>
    </>
  );
}
