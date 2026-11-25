import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const { ObjectId } = Schema.Types;

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'meeting_booked', 'not_interested'];

export const Lead = model('Lead', new Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  company: { type: String, trim: true, maxlength: 120 },
  phone: { type: String, trim: true, maxlength: 30 },
  email: { type: String, trim: true, lowercase: true, maxlength: 160 },
  status: { type: String, enum: LEAD_STATUSES, default: 'new' },
  score: { type: Number, min: 0, max: 100 },
  temperature: { type: String, enum: ['hot', 'warm', 'cold'] },
  qualification: {
    budget: String,
    authority: String,
    need: String,
    timeline: String,
    interest: { type: String, enum: ['high', 'medium', 'low', 'none'] },
    notes: String,
  },
  // Facts the agent should remember on the next call.
  memory: { type: [String], default: [] },
}, { timestamps: true }));

export const Call = model('Call', new Schema({
  lead: { type: ObjectId, ref: 'Lead', required: true, index: true },
  status: { type: String, enum: ['live', 'ended'], default: 'live' },
  startedAt: { type: Date, default: Date.now },
  endedAt: Date,
  endReason: String,
  languages: { type: [String], default: [] },
  transcript: [{ _id: false, role: { type: String, enum: ['agent', 'lead'] }, text: String, at: { type: Date, default: Date.now } }],
  analysis: {
    summary: String,
    sentiment: { type: String, enum: ['positive', 'neutral', 'negative'] },
    sentimentScore: Number,
    leadScore: Number,
    temperature: { type: String, enum: ['hot', 'warm', 'cold'] },
    objections: [String],
    nextStep: String,
    keyFacts: [String],
  },
}, { timestamps: true }));

const meetingSchema = new Schema({
  lead: { type: ObjectId, ref: 'Lead', required: true },
  call: { type: ObjectId, ref: 'Call' },
  start: { type: Date, required: true },
  end: { type: Date, required: true },
  topic: String,
  email: String,
  status: { type: String, enum: ['booked', 'cancelled'], default: 'booked' },
}, { timestamps: true });
// Two calls racing for the same slot: the database, not the app, refuses the second booking.
meetingSchema.index({ start: 1 }, { unique: true, partialFilterExpression: { status: 'booked' } });
export const Meeting = model('Meeting', meetingSchema);

export const KnowledgeChunk = model('KnowledgeChunk', new Schema({
  docId: { type: String, required: true, index: true },
  docName: { type: String, required: true },
  index: Number,
  text: { type: String, required: true },
  embedding: { type: [Number], required: true },
}, { timestamps: true }));

export const Settings = model('Settings', new Schema({
  agentName: { type: String, default: 'Priya' },
  companyName: { type: String, default: 'FlowDesk' },
  pitch: {
    type: String,
    default: 'FlowDesk is HR, attendance and payroll software for Indian small and mid-size businesses. '
      + 'Goal of the call: understand the lead\'s HR and payroll pain, qualify them, and book a 30-minute product demo.',
  },
  voice: { type: String, default: 'Sunaina' },
  // Gnani Prisma v3 streaming takes one code (e.g. hi-IN) or "indic-auto", which detects
  // the language per sentence; comma lists are rejected on streaming despite the docs.
  sttLanguages: { type: String, default: 'indic-auto' },
  workStart: { type: String, default: '10:00' },
  workEnd: { type: String, default: '18:00' },
  workDays: { type: [Number], default: [1, 2, 3, 4, 5, 6] },
  slotMinutes: { type: Number, default: 30 },
}));

export async function getSettings() {
  return (await Settings.findOne().lean()) ?? (await Settings.create({})).toObject();
}

export function connectDb(uri) {
  return mongoose.connect(uri);
}
