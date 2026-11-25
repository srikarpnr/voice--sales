import { api, useLoad } from '../api.js';
import { STATUS_LABELS, STAGE_COLORS, LANGUAGE_NAMES, duration } from '../labels.js';

const TEMPERATURE_LABELS = { hot: 'Hot', warm: 'Warm', cold: 'Cold' };
const TEMPERATURE_COLORS = { hot: 'var(--hot)', warm: 'var(--warm)', cold: 'var(--cold)' };
const STAGE_ORDER = ['new', 'contacted', 'qualified', 'meeting_booked', 'not_interested'];
const percent = (value) => (value == null ? 'No data' : `${Math.round(value * 100)}%`);

function Bars({ items, labels = {}, colors = {} }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  if (items.length === 0) return <p className="muted">Shows up after the first analysed call.</p>;
  return items.map((item) => (
    <div key={item.label} className="bar-row">
      <span>{labels[item.label] ?? item.label}</span>
      <div className="track"><span style={{ width: `${(item.count / max) * 100}%`, background: colors[item.label] }} /></div>
      <b>{item.count}</b>
    </div>
  ));
}

function Sentiment({ items }) {
  const total = items.reduce((sum, i) => sum + i.count, 0);
  if (total === 0) return <p className="muted">Shows up after the first analysed call.</p>;
  const share = (label) => items.find((i) => i.label === label)?.count ?? 0;
  return (
    <>
      <div className="split-bar" aria-hidden="true">
        {['positive', 'neutral', 'negative'].map((label) => share(label) > 0 && <span key={label} className={label} style={{ flex: share(label) }} />)}
      </div>
      <div className="pipeline-legend">
        {['positive', 'neutral', 'negative'].map((label) => <span key={label}><b>{share(label)}</b>{label}</span>)}
      </div>
    </>
  );
}

export default function Insights() {
  const { data, error } = useLoad(() => api('/insights'), []);
  if (error) return <p className="notice error">{error.message}</p>;
  if (!data) return <p className="muted">Loading insights…</p>;

  const pipeline = STAGE_ORDER.map((status) => ({ label: status, count: data.pipeline.find((p) => p.label === status)?.count ?? 0 }));
  const kpis = [
    [data.totalCalls, data.totalCalls === 1 ? 'call made' : 'calls made'],
    [data.meetingsBooked, data.meetingsBooked === 1 ? 'demo booked' : 'demos booked'],
    [percent(data.conversionRate), 'of called leads booked a demo'],
    [data.avgLeadScore ?? 'No data', 'average lead score'],
  ];

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Insights</h1>
          <p>
            How the agent is doing across {data.leadsCalled === 1 ? '1 lead' : `${data.leadsCalled} leads`}.
            {data.totalCalls > 0 && ` Average call ${duration(data.avgDurationSec)}, average sentiment ${data.avgSentiment ?? 'not scored'} on a scale of -1 to 1.`}
          </p>
        </div>
      </header>
      <section className="kpis">
        {kpis.map(([value, label]) => <div key={label} className="kpi"><strong>{value}</strong><span>{label}</span></div>)}
      </section>
      <div className="insight-grid">
        <section className="panel">
          <h2 className="panel-title">Pipeline</h2>
          <Bars items={pipeline} labels={STATUS_LABELS} colors={STAGE_COLORS} />
        </section>
        <section className="panel">
          <h2 className="panel-title">How leads felt</h2>
          <Sentiment items={data.sentiment} />
          <h3 className="sub-title">Lead temperature</h3>
          <Bars items={data.temperature} labels={TEMPERATURE_LABELS} colors={TEMPERATURE_COLORS} />
        </section>
        <section className="panel">
          <h2 className="panel-title">Top objections</h2>
          <Bars items={data.topObjections} />
        </section>
        <section className="panel">
          <h2 className="panel-title">Languages leads spoke</h2>
          <Bars items={data.languages} labels={LANGUAGE_NAMES} />
        </section>
      </div>
    </>
  );
}
