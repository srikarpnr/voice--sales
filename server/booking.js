import { Meeting } from './db.js';

// shortcut: India time only (fixed UTC+5:30, no daylight saving); add a timezone library before selling abroad.
const IST_OFFSET_MS = 330 * 60_000;
const MIN_NOTICE_MS = 60 * 60_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;

export function istDate(date, time) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, h, min) - IST_OFFSET_MS);
}

export function toIst(when) {
  const iso = new Date(when.getTime() + IST_OFFSET_MS).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

function minutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function hhmm(total) {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// Pure slot maths, kept apart from the database so it can be tested.
export function slotsForDay(date, settings, bookedTimes, now = new Date()) {
  if (!DATE.test(date)) return [];
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (!settings.workDays.includes(weekday)) return [];
  const slots = [];
  for (let t = minutes(settings.workStart); t + settings.slotMinutes <= minutes(settings.workEnd); t += settings.slotMinutes) {
    const start = istDate(date, hhmm(t));
    if (start.getTime() - now.getTime() >= MIN_NOTICE_MS && !bookedTimes.has(start.getTime())) slots.push(hhmm(t));
  }
  return slots;
}

// A voice agent should offer a few times, not read out a whole day; spread them across the day.
export function spreadOut(slots, count) {
  if (slots.length <= count) return slots;
  return Array.from({ length: count }, (_, i) => slots[Math.round((i * (slots.length - 1)) / (count - 1))]);
}

export async function freeSlots(date, settings) {
  if (!DATE.test(date)) return [];
  const dayStart = istDate(date, '00:00');
  const booked = await Meeting.find(
    { status: 'booked', start: { $gte: dayStart, $lt: new Date(dayStart.getTime() + 86_400_000) } },
    { start: 1 },
  ).lean();
  return slotsForDay(date, settings, new Set(booked.map((m) => m.start.getTime())));
}

export async function bookMeeting({ leadId, callId, startLocal, email, topic, settings }) {
  const match = LOCAL_TIME.exec(startLocal ?? '');
  if (!match) return { ok: false, reason: 'start must look like 2026-12-01T15:30 (India time)' };
  const [, date, time] = match;
  const open = await freeSlots(date, settings);
  if (!open.includes(time)) return { ok: false, reason: 'that time is not free', freeSlots: open };

  const start = istDate(date, time);
  try {
    const meeting = await Meeting.create({
      lead: leadId,
      call: callId,
      start,
      end: new Date(start.getTime() + settings.slotMinutes * 60_000),
      email,
      topic: topic || 'Product demo',
    });
    const when = start.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
    return { ok: true, meetingId: String(meeting._id), date, time, when, minutes: settings.slotMinutes };
  } catch (err) {
    if (err.code === 11000) return { ok: false, reason: 'someone just booked that slot', freeSlots: await freeSlots(date, settings) };
    throw err;
  }
}
