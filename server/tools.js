import { Lead } from './db.js';
import { searchKnowledge } from './rag.js';
import { freeSlots, bookMeeting, spreadOut } from './booking.js';

const text = (description) => ({ type: 'string', description });

function tool(name, description, properties, required = []) {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } };
}

export const toolSpecs = [
  tool('search_knowledge', 'Search the product knowledge base (brochure, pricing, FAQ). Use it before answering any product, pricing or policy question.', {
    query: text('What to look up, written in English, e.g. "price per employee"'),
  }, ['query']),
  tool('update_lead', 'Save what you learned about the lead. Send only the fields you learned.', {
    budget: text('Budget in their words, e.g. "around 5,000 rupees a month"'),
    authority: text('Who decides, e.g. "the lead is the founder and decides"'),
    need: text('Their pain or need'),
    timeline: text('When they want to start'),
    email: text('Email address, if they shared it'),
    interest: { type: 'string', enum: ['high', 'medium', 'low', 'none'], description: 'How interested they sound' },
    notes: text('Anything else worth remembering'),
  }),
  tool('check_slots', 'List free demo times on one day.', {
    date: text('Day in YYYY-MM-DD'),
  }, ['date']),
  tool('book_meeting', 'Book a product demo in a free slot.', {
    start: text('Start in India time as YYYY-MM-DDTHH:mm, e.g. 2026-12-03T15:30'),
    email: text('Email for the invite, if known'),
    topic: text('Short topic, e.g. "Payroll demo for 50 employees"'),
  }, ['start']),
  tool('end_call', 'Hang up after you have said goodbye.', {
    reason: text('Why the call ends, e.g. "demo booked", "not interested"'),
  }, ['reason']),
];

const QUALIFICATION_FIELDS = ['budget', 'authority', 'need', 'timeline', 'notes'];
const INTEREST = new Set(['high', 'medium', 'low', 'none']);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Tool arguments come from the model, so every value is checked and trimmed before it touches the database.
const clip = (value, max = 300) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

async function updateLead(args, ctx) {
  const set = {};
  for (const field of QUALIFICATION_FIELDS) if (clip(args[field])) set[`qualification.${field}`] = clip(args[field]);
  if (INTEREST.has(args.interest)) set['qualification.interest'] = args.interest;
  if (EMAIL.test(clip(args.email))) set.email = clip(args.email).toLowerCase();
  if (args.interest === 'none') set.status = 'not_interested';
  else if (ctx.lead.status !== 'meeting_booked' && (set['qualification.need'] || set['qualification.budget'])) set.status = 'qualified';
  if (Object.keys(set).length === 0) return { saved: false, reason: 'no usable fields' };

  ctx.lead = await Lead.findByIdAndUpdate(ctx.lead._id, { $set: set }, { returnDocument: 'after' }).lean();
  return { saved: true, fields: Object.keys(set) };
}

async function bookDemo(args, ctx) {
  const email = EMAIL.test(clip(args.email)) ? clip(args.email).toLowerCase() : ctx.lead.email;
  const result = await bookMeeting({
    leadId: ctx.lead._id,
    callId: ctx.callId,
    startLocal: clip(args.start, 16),
    email,
    topic: clip(args.topic, 120),
    settings: ctx.settings,
  });
  if (result.ok) {
    ctx.lead = await Lead.findByIdAndUpdate(ctx.lead._id, { $set: { status: 'meeting_booked', ...(email && { email }) } }, { returnDocument: 'after' }).lean();
  }
  return result;
}

export async function runTool(name, args, ctx) {
  switch (name) {
    case 'search_knowledge': {
      const results = await searchKnowledge(clip(args.query));
      return results.length ? { results } : { results: [], note: 'Nothing in the knowledge base about this.' };
    }
    case 'update_lead':
      return updateLead(args, ctx);
    case 'check_slots': {
      const date = clip(args.date, 10);
      const slots = await freeSlots(date, ctx.settings);
      if (slots.length === 0) return { date, freeSlots: [], note: 'No free slots that day (closed, past, or full).' };
      return {
        date,
        suggestedSlots: spreadOut(slots, 3),
        note: `${slots.length} slots are free between ${slots[0]} and ${slots.at(-1)}; book_meeting accepts any of them if the lead asks for another time.`,
      };
    }
    case 'book_meeting':
      return bookDemo(args, ctx);
    case 'end_call':
      ctx.endRequested = true;
      return { ok: true };
    default:
      return { error: `Unknown tool ${name}` };
  }
}
