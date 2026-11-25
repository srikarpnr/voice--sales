const SENTENCE_END = /[.!?।]+["')\]]*\s+|\n+/g;
const LONG_CLAUSE = 160;

// Cuts streamed LLM text into speakable sentences so TTS can start before the reply is finished.
// Returns the complete sentences and the unfinished rest.
export function takeSentences(buffer) {
  const sentences = [];
  let start = 0;
  for (const match of buffer.matchAll(SENTENCE_END)) {
    const end = match.index + match[0].length;
    pushSpeakable(sentences, buffer.slice(start, end));
    start = end;
  }
  let rest = buffer.slice(start);
  // A long sentence without punctuation would delay speech; break it at its last comma.
  const comma = rest.lastIndexOf(', ');
  if (rest.length > LONG_CLAUSE && comma > 0) {
    pushSpeakable(sentences, rest.slice(0, comma + 1));
    rest = rest.slice(comma + 2);
  }
  return { sentences, rest };
}

// The model sometimes copies the [hi-IN] language tags it sees on lead messages; they must never be spoken.
export const stripLanguageTags = (text) => text.replace(/\[[a-z]{2}-[a-z]{2}\]\s*/gi, '');

export function cleanForSpeech(text) {
  return stripLanguageTags(text).replace(/[*#_`~>|]/g, '').replace(/\s+/g, ' ').trim();
}

function pushSpeakable(list, text) {
  const clean = cleanForSpeech(text);
  if (/[\p{L}\p{N}]/u.test(clean)) list.push(clean);
}

function words(text) {
  return text.toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? [];
}

const pairs = (list) => list.slice(1).map((word, i) => `${list[i]} ${word}`);

// Without headphones the mic hears the agent's own voice. Echo repeats the agent's words in the
// agent's order, so most word pairs of an echo transcript also appear in what the agent is saying.
// Pairs, not single words: a lead reusing common words ("this is", "Rahul") is not echo.
export function isLikelyEcho(heard, agentText) {
  const heardWords = words(heard);
  if (heardWords.length === 0) return true;
  const agentWords = words(agentText);
  if (heardWords.length === 1) return agentWords.includes(heardWords[0]);
  const agentPairs = new Set(pairs(agentWords));
  const heardPairs = pairs(heardWords);
  return heardPairs.filter((pair) => agentPairs.has(pair)).length / heardPairs.length >= 0.5;
}
