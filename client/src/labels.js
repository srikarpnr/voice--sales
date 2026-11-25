export const STATUS_LABELS = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  meeting_booked: 'Demo booked',
  not_interested: 'Not interested',
};

export const LANGUAGE_NAMES = {
  'indic-auto': 'Detect automatically',
  'en-IN': 'English',
  'hi-IN': 'Hindi',
  'bn-IN': 'Bengali',
  'gu-IN': 'Gujarati',
  'kn-IN': 'Kannada',
  'ml-IN': 'Malayalam',
  'mr-IN': 'Marathi',
  'pa-IN': 'Punjabi',
  'ta-IN': 'Tamil',
  'te-IN': 'Telugu',
};

const relative = new Intl.RelativeTimeFormat('en-IN', { numeric: 'auto' });
const STEPS = [[60, 'second'], [60, 'minute'], [24, 'hour'], [7, 'day'], [4.35, 'week'], [12, 'month'], [Infinity, 'year']];

export function timeAgo(when) {
  let value = (new Date(when) - Date.now()) / 1000;
  for (const [size, unit] of STEPS) {
    if (Math.abs(value) < size) return relative.format(Math.round(value), unit);
    value /= size;
  }
  return '';
}

export const formatIst = (when, options = { dateStyle: 'medium', timeStyle: 'short' }) => new Date(when).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', ...options });

export function duration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const STAGE_COLORS = {
  new: 'var(--stage-1)',
  contacted: 'var(--stage-2)',
  qualified: 'var(--stage-3)',
  meeting_booked: 'var(--good)',
  not_interested: 'var(--stage-x)',
};
