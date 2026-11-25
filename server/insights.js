import { Call, Lead, Meeting } from './db.js';

const average = (values) => (values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)) : null);

function tally(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

export function summariseCalls(calls) {
  const analysed = calls.filter((c) => c.analysis?.summary);
  const durations = calls.filter((c) => c.endedAt).map((c) => (new Date(c.endedAt) - new Date(c.startedAt)) / 1000);
  return {
    totalCalls: calls.length,
    leadsCalled: new Set(calls.map((c) => String(c.lead))).size,
    avgDurationSec: Math.round(average(durations) ?? 0),
    avgSentiment: average(analysed.map((c) => c.analysis.sentimentScore)),
    avgLeadScore: average(analysed.map((c) => c.analysis.leadScore)),
    sentiment: tally(analysed.map((c) => c.analysis.sentiment)),
    topObjections: tally(analysed.flatMap((c) => c.analysis.objections.map((o) => o.toLowerCase()))).slice(0, 8),
    languages: tally(calls.flatMap((c) => c.languages)),
  };
}

export async function insights() {
  // shortcut: summarises the latest 1,000 calls in Node; at scale, precompute with a $group pipeline or a nightly rollup.
  const [calls, byStatus, byTemperature, leadsWithMeeting, meetingsBooked] = await Promise.all([
    Call.find({ status: 'ended' }).sort({ startedAt: -1 }).limit(1000).select('lead startedAt endedAt languages analysis').lean(),
    Lead.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Lead.aggregate([{ $match: { temperature: { $exists: true } } }, { $group: { _id: '$temperature', count: { $sum: 1 } } }]),
    Meeting.distinct('lead', { status: 'booked' }),
    Meeting.countDocuments({ status: 'booked' }),
  ]);
  const summary = summariseCalls(calls);
  return {
    ...summary,
    meetingsBooked,
    conversionRate: summary.leadsCalled ? Number((leadsWithMeeting.length / summary.leadsCalled).toFixed(2)) : null,
    pipeline: byStatus.map((s) => ({ label: s._id, count: s.count })),
    temperature: byTemperature.map((t) => ({ label: t._id, count: t.count })),
  };
}
