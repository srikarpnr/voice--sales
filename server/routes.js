import { Router } from 'express';
import { extractText } from 'unpdf';
import { Lead, Call, Meeting, KnowledgeChunk, Settings, getSettings, LEAD_STATUSES } from './db.js';
import { login, requireAuth } from './auth.js';
import { addDocument, removeDocument } from './rag.js';
import { insights } from './insights.js';
import { VOICES } from './gnani.js';

export const api = Router();

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const field = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : undefined);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const STT_LANGUAGES = /^(indic-auto|(bn|en|gu|hi|kn|ml|mr|pa|ta|te)-IN)$/;

api.post('/login', (req, res) => {
  const token = login(req.body?.email, req.body?.password);
  if (!token) return res.status(401).json({ error: 'Wrong email or password' });
  res.json({ token });
});

api.use(requireAuth);

api.get('/leads', async (req, res) => {
  res.json(await Lead.find().sort({ updatedAt: -1 }).limit(500).lean());
});

api.post('/leads', async (req, res) => {
  const name = field(req.body?.name, 120);
  if (!name) throw badRequest('Name is required');
  const lead = await Lead.create({
    name,
    company: field(req.body.company, 120),
    phone: field(req.body.phone, 30),
    email: field(req.body.email, 160),
  });
  res.status(201).json(lead);
});

api.get('/leads/:id', async (req, res) => {
  const lead = await Lead.findById(req.params.id).lean();
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  const [calls, meetings] = await Promise.all([
    Call.find({ lead: lead._id }).sort({ startedAt: -1 }).lean(),
    Meeting.find({ lead: lead._id }).sort({ start: -1 }).lean(),
  ]);
  res.json({ lead, calls, meetings });
});

api.patch('/leads/:id', async (req, res) => {
  if (!LEAD_STATUSES.includes(req.body?.status)) throw badRequest('Unknown status');
  const lead = await Lead.findByIdAndUpdate(req.params.id, { $set: { status: req.body.status } }, { returnDocument: 'after' }).lean();
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  res.json(lead);
});

api.delete('/leads/:id', async (req, res) => {
  await Promise.all([
    Lead.deleteOne({ _id: req.params.id }),
    Call.deleteMany({ lead: req.params.id }),
    Meeting.deleteMany({ lead: req.params.id }),
  ]);
  res.status(204).end();
});

api.get('/knowledge', async (req, res) => {
  res.json(await KnowledgeChunk.aggregate([
    { $group: { _id: '$docId', name: { $first: '$docName' }, chunks: { $sum: 1 }, createdAt: { $min: '$createdAt' } } },
    { $sort: { createdAt: -1 } },
  ]));
});

api.post('/knowledge', async (req, res) => {
  const name = field(req.body?.name, 120);
  if (!name) throw badRequest('Give the document a name');
  let text = field(req.body.text, 500_000);
  if (req.body.pdfBase64) {
    try {
      ({ text } = await extractText(new Uint8Array(Buffer.from(req.body.pdfBase64, 'base64')), { mergePages: true }));
    } catch (err) {
      throw badRequest(`Could not read that PDF: ${err.message}`);
    }
  }
  if (!text?.trim()) throw badRequest('Paste some text or upload a PDF with selectable text');
  res.status(201).json(await addDocument(name, text));
});

api.delete('/knowledge/:docId', async (req, res) => {
  await removeDocument(req.params.docId);
  res.status(204).end();
});

api.get('/meetings', async (req, res) => {
  res.json(await Meeting.find({ status: 'booked' }).sort({ start: 1 }).populate('lead', 'name company phone email').lean());
});

api.get('/insights', async (req, res) => {
  res.json(await insights());
});

api.get('/settings', async (req, res) => {
  res.json({ settings: await getSettings(), voices: VOICES });
});

api.put('/settings', async (req, res) => {
  const body = req.body ?? {};
  const set = {
    agentName: field(body.agentName, 60),
    companyName: field(body.companyName, 80),
    pitch: field(body.pitch, 3000),
    voice: field(body.voice, 40),
    sttLanguages: field(body.sttLanguages, 40),
    workStart: field(body.workStart, 5),
    workEnd: field(body.workEnd, 5),
    workDays: body.workDays,
    slotMinutes: Number(body.slotMinutes),
  };
  if (!set.agentName || !set.companyName || !set.pitch) throw badRequest('Agent name, company and pitch are required');
  if (!VOICES.includes(set.voice)) throw badRequest('Pick a voice from the list');
  if (!STT_LANGUAGES.test(set.sttLanguages)) throw badRequest('Pick a listening language');
  if (!TIME.test(set.workStart) || !TIME.test(set.workEnd) || set.workStart >= set.workEnd) throw badRequest('Demo hours must be HH:mm with start before end');
  if (!Array.isArray(set.workDays) || !set.workDays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) throw badRequest('Pick the demo days');
  if (![15, 30, 45, 60].includes(set.slotMinutes)) throw badRequest('Slot length must be 15, 30, 45 or 60 minutes');

  const settings = await Settings.findOneAndUpdate({}, { $set: set }, { upsert: true, returnDocument: 'after' }).lean();
  res.json({ settings, voices: VOICES });
});
