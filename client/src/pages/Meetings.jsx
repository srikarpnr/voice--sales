import { Link } from 'react-router';
import { api, useLoad } from '../api.js';
import { formatIst } from '../labels.js';
import { Icon } from '../icons.jsx';

const calendarStamp = (when) => new Date(when).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

function googleCalendarLink(meeting) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${meeting.topic} with ${meeting.lead?.name ?? 'lead'}`,
    dates: `${calendarStamp(meeting.start)}/${calendarStamp(meeting.end)}`,
    details: [meeting.lead?.company, meeting.lead?.phone, meeting.email].filter(Boolean).join('\n'),
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

const istDay = (when) => formatIst(when, { year: 'numeric', month: '2-digit', day: '2-digit' });

function dayLabel(when) {
  const today = istDay(Date.now());
  const tomorrow = istDay(Date.now() + 86_400_000);
  const day = istDay(when);
  if (day === today) return 'Today';
  if (day === tomorrow) return 'Tomorrow';
  return formatIst(when, { weekday: 'long', day: 'numeric', month: 'long' });
}

export default function Meetings() {
  const { data: meetings, error } = useLoad(() => api('/meetings'), []);
  const now = Date.now();
  const days = new Map();
  for (const meeting of meetings ?? []) {
    const label = dayLabel(meeting.start);
    days.set(label, [...(days.get(label) ?? []), meeting]);
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Demos</h1>
          <p>Every demo the agent booked, in India time. Add one to your calendar in a click.</p>
        </div>
      </header>
      {error && <p className="notice error">{error.message}</p>}
      {meetings?.length === 0 && (
        <div className="panel empty"><strong>No demos yet</strong>When a lead agrees on a call, the agent books the slot and it shows up here.</div>
      )}
      {[...days].map(([label, list]) => (
        <section key={label} className="day">
          <h2>{label}</h2>
          <div className="list">
            {list.map((m) => (
              <div key={m._id} className={`slot ${new Date(m.end) < now ? 'past' : ''}`}>
                <time dateTime={m.start}>{formatIst(m.start, { hour: 'numeric', minute: '2-digit' })}</time>
                <div>
                  {m.lead ? <Link to={`/leads/${m.lead._id}`}><b>{m.lead.name}</b></Link> : <b>Deleted lead</b>}
                  {m.lead?.company && <span className="muted">, {m.lead.company}</span>}
                  <div className="muted small">{m.topic}{m.email ? `, invite to ${m.email}` : ''}</div>
                </div>
                <a className="btn quiet small" href={googleCalendarLink(m)} target="_blank" rel="noreferrer"><Icon name="calendar" size={15} />Add to Google Calendar</a>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
