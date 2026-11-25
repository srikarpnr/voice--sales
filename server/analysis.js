import { Call, Lead } from './db.js';
import { chatJson } from './llm.js';

const MEMORY_LIMIT = 15;

const ANALYSIS_PROMPT = `You review sales call transcripts. The call may be in English, Hindi or a mix. Answer in English with one JSON object and nothing else:
{
  "summary": "2-3 sentences: what the lead needs, what was agreed",
  "sentiment": "positive" | "neutral" | "negative",
  "sentimentScore": number from -1 (very negative) to 1 (very positive),
  "leadScore": integer 0-100 (budget fit, decision power, clear need, near timeline, interest; a booked demo is at least 70),
  "temperature": "hot" | "warm" | "cold",
  "objections": ["short phrases, empty if none"],
  "nextStep": "one concrete next action for the sales team",
  "keyFacts": ["up to 5 facts worth remembering for the next call"],
  "qualification": { "budget": "", "authority": "", "need": "", "timeline": "" }
}
In "qualification" write what the lead said about each, in a few words; leave "" when it did not come up.`;
const QUALIFICATION_FIELDS = ['budget', 'authority', 'need', 'timeline'];

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
const clamp = (value, min, max, fallback) => (Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback);
const strings = (value, max) => (Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim().slice(0, 200)).slice(0, max) : []);

// The model's JSON is untrusted: every field is checked and bounded before it is stored.
export function normaliseAnalysis(raw) {
  return {
    summary: String(raw?.summary ?? '').slice(0, 1000),
    sentiment: pick(raw?.sentiment, ['positive', 'neutral', 'negative'], 'neutral'),
    sentimentScore: clamp(raw?.sentimentScore, -1, 1, 0),
    leadScore: Math.round(clamp(raw?.leadScore, 0, 100, 0)),
    temperature: pick(raw?.temperature, ['hot', 'warm', 'cold'], 'cold'),
    objections: strings(raw?.objections, 8),
    nextStep: String(raw?.nextStep ?? '').slice(0, 300),
    keyFacts: strings(raw?.keyFacts, 5),
    qualification: Object.fromEntries(QUALIFICATION_FIELDS.map((field) => [field, String(raw?.qualification?.[field] ?? '').trim().slice(0, 200)])),
  };
}

export async function analyseCall(callId) {
  const call = await Call.findById(callId);
  const lines = call.transcript.map((t) => `${t.role === 'agent' ? 'Agent' : 'Lead'}: ${t.text}`);
  if (!lines.some((line) => line.startsWith('Lead:'))) return; // nobody answered: nothing to analyse

  const { qualification, ...analysis } = normaliseAnalysis(await chatJson([
    { role: 'system', content: ANALYSIS_PROMPT },
    { role: 'user', content: lines.join('\n') },
  ]));
  call.analysis = analysis;
  await call.save();

  const lead = await Lead.findById(call.lead);
  // Fills only what the agent did not already save during the call; live answers win.
  for (const field of QUALIFICATION_FIELDS) {
    if (qualification[field] && !lead.qualification?.[field]) lead.set(`qualification.${field}`, qualification[field]);
  }
  lead.score = analysis.leadScore;
  lead.temperature = analysis.temperature;
  lead.memory = [...lead.memory, ...analysis.keyFacts].slice(-MEMORY_LIMIT);
  if (lead.status === 'new' || lead.status === 'contacted') lead.status = analysis.leadScore >= 60 ? 'qualified' : 'contacted';
  await lead.save();
}
