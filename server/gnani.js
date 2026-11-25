import WebSocket from 'ws';

const STT_URL = 'wss://api.vachana.ai/stt/v3/stream';
const TTS_URL = 'wss://api.vachana.ai/api/v1/tts';
export const TTS_SAMPLE_RATE = 24000;
const TTS_TIMEOUT_MS = 15_000;
// Timbre v3.0 voices; each one speaks all ten supported Indian languages.
export const VOICES = [
  'Anitasingh', 'Chetana', 'Kalpana', 'Lakshmi', 'Lakshmidevi', 'Neelam', 'Priyasharm', 'Rajni', 'Rekha', 'Riyaa',
  'Shivani', 'Shruthi', 'Sneha', 'Sohini', 'Sunaina', 'Swathi', 'Tarika', 'Vasudha',
  'Arko', 'Avinash', 'Devansh', 'Harshad', 'Mahendra', 'Manjunath', 'Nitin', 'Prakash', 'Rahulmehta', 'Rajeev',
  'Rakesh', 'Santosh', 'Shubham', 'Vikramdasu', 'Vinod', 'Yashraj',
];

// Streaming speech-to-text. Send 1024-byte frames (512 samples of 16 kHz mono PCM16) in real time;
// Gnani's own VAD cuts the speech into segments. With `x-partials` (not in the public docs) it sends
// `partial_transcript` events while the lead talks and a `final_transcript` per segment.
export function openStt(languages) {
  return new WebSocket(STT_URL, {
    headers: {
      'x-api-key-id': process.env.GNANI_API_KEY,
      model: 'prisma-v3.0',
      language_code: languages,
      'x-sample-rate': '16000',
      'x-vad-threshold': '0.5',
      'x-min-silence-ms': '600',
      'x-idle-timeout-sec': '300',
      'x-partials': 'true',
    },
  });
}

// A malformed frame from Gnani must not throw inside a socket handler and take the server down.
export function parseMessage(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    console.error('Gnani sent a non-JSON message:', String(raw).slice(0, 120));
    return {};
  }
}

export function ttsRequest(text, voice) {
  return {
    text,
    voice,
    model: 'timbre-v3.0',
    // Every Timbre v3 voice speaks all ten languages; "auto" picks the language from the script.
    language: 'auto',
    speed: 1.0,
    audio_config: { sample_rate: TTS_SAMPLE_RATE, num_channels: 1, sample_width: 2, encoding: 'linear_pcm', container: 'raw' },
  };
}

// One realtime TTS socket per call; Gnani handles one synthesis request at a time on it,
// so requests are chained.
export class GnaniTts {
  #ws = null;
  #ready = null;
  #current = null;
  #chain = Promise.resolve();

  #connect() {
    const ws = new WebSocket(TTS_URL, { headers: { 'X-API-Key-ID': process.env.GNANI_API_KEY } });
    this.#ready = new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    ws.on('message', (raw) => {
      const message = parseMessage(raw);
      const current = this.#current;
      if (!current) return;
      if (message.type === 'start') {
        current.requestId = message.request_id;
        return;
      }
      // Gnani sends two `complete` frames per request; the second (with request_id) can land after
      // the next request was sent, so frames are matched to the request they belong to.
      if (message.request_id && message.request_id !== current.requestId) return;
      if (message.type === 'error') this.#finish(new Error(`Gnani TTS: ${message.message}`));
      else if (!current.requestId) return;
      else if (message.type === 'audio') current.onAudio(Buffer.from(message.data.audio, 'base64'));
      else if (message.type === 'complete') this.#finish(null);
    });
    ws.on('error', (err) => console.error('Gnani TTS socket error:', err.message));
    ws.on('close', () => {
      if (this.#ws === ws) this.#ws = null;
      this.#finish(new Error('Gnani TTS connection closed'));
    });
    this.#ws = ws;
  }

  #finish(err) {
    const current = this.#current;
    this.#current = null;
    if (!current) return;
    clearTimeout(current.timer);
    if (err) current.reject(err);
    else current.resolve();
  }

  speak(request, onAudio) {
    const run = this.#chain.then(() => this.#speakNow(request, onAudio));
    this.#chain = run.catch(() => {}); // the caller handles the error; the chain only keeps order
    return run;
  }

  async #speakNow(request, onAudio) {
    if (!this.#ws) this.#connect();
    const ws = this.#ws;
    try {
      await this.#ready;
    } catch (err) {
      if (ws !== this.#ws) return; // reset() while connecting: nothing to say any more
      throw err;
    }
    if (ws !== this.#ws) return;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.#finish(new Error('Gnani TTS timed out')), TTS_TIMEOUT_MS);
      this.#current = { resolve, reject, onAudio, timer };
      ws.send(JSON.stringify(request));
    });
  }

  // Drops the sentence being synthesised. The socket is replaced because Gnani cannot cancel a request;
  // an idle socket is kept so the next reply does not pay for a new handshake.
  reset() {
    if (this.#current) this.close();
  }

  close() {
    const ws = this.#ws;
    this.#ws = null;
    this.#finish(null);
    ws?.close();
  }
}
