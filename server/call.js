import WebSocket from 'ws';
import { Call, Lead, getSettings } from './db.js';
import { openStt, GnaniTts, ttsRequest, parseMessage, TTS_SAMPLE_RATE } from './gnani.js';
import { streamChat } from './llm.js';
import { toolSpecs, runTool } from './tools.js';
import { buildSystemPrompt } from './prompt.js';
import { takeSentences, isLikelyEcho, stripLanguageTags } from './speech.js';
import { analyseCall } from './analysis.js';

const MAX_TOOL_ROUNDS = 4;
const STT_FRAME_BYTES = 1024;
// A transcript of the agent's own voice can arrive this long after its audio stopped (VAD silence + STT time).
const ECHO_WINDOW_MS = 2500;
const GREETING_CUE = '[The call has just connected. Greet the lead by name, say you are an AI assistant calling from the company, give the reason for the call in one sentence, and ask for two minutes.]';
const LIVE_TOOLS = new Set(['update_lead', 'book_meeting']);
// A lookup costs one more model round trip; a short phrase covers the silence.
const SLOW_TOOLS = new Set(['search_knowledge', 'check_slots', 'book_meeting']);
const HOLD_PHRASES = { 'hi-IN': 'एक पल रुकिए।' };
const HOLD_PHRASE = 'One moment, please.';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function startCall(ws, leadId) {
  const lead = await Lead.findById(leadId).lean();
  if (!lead) return ws.close(4404, 'Lead not found');
  const [settings, pastCalls] = await Promise.all([
    getSettings(),
    Call.find({ lead: lead._id, status: 'ended', 'analysis.summary': { $exists: true } }).sort({ startedAt: -1 }).limit(3).lean(),
  ]);
  if (ws.readyState !== WebSocket.OPEN) return; // caller left while we were loading
  if (lead.status === 'new') {
    lead.status = 'contacted';
    await Lead.updateOne({ _id: lead._id }, { status: 'contacted' });
  }
  const call = await Call.create({ lead: lead._id });
  new CallSession({ ws, lead, call, settings, pastCalls }).start();
}

class CallSession {
  constructor({ ws, lead, call, settings, pastCalls }) {
    this.ws = ws;
    this.callId = call._id;
    this.ctx = { lead, settings, callId: call._id, endRequested: false };
    this.messages = [{ role: 'system', content: buildSystemPrompt({ settings, lead, pastCalls }) }];
    this.tts = new GnaniTts();
    this.pendingUser = [];
    this.turn = null;
    this.turns = Promise.resolve();
    this.writes = Promise.resolve();
    this.speakingUntil = 0;
    this.agentText = '';
    this.carry = null;
    this.languages = new Set();
    this.language = null;
    this.ended = false;
  }

  start() {
    this.stt = openStt(this.ctx.settings.sttLanguages);
    this.stt.on('message', (raw) => this.onStt(parseMessage(raw)));
    this.stt.on('error', (err) => {
      console.error('Gnani STT socket error:', err.message);
      this.send({ type: 'error', message: `Speech recognition unavailable: ${err.message}` });
    });
    this.stt.on('close', (code) => this.end(code === 1001 ? 'time limit reached' : 'speech service disconnected'));

    this.ws.on('message', (data, isBinary) => {
      if (isBinary) {
        if (data.length === STT_FRAME_BYTES && this.stt.readyState === WebSocket.OPEN) this.stt.send(data);
        return;
      }
      if (String(data).includes('"hangup"')) this.end('caller hung up');
    });
    this.ws.on('close', () => this.end('caller hung up'));

    this.send({ type: 'ready', callId: String(this.callId), sampleRate: TTS_SAMPLE_RATE, lead: this.ctx.lead });
    this.onUserSpeech(GREETING_CUE);
  }

  onStt(event) {
    if (event.type === 'error') {
      console.error('Gnani STT:', event.message);
      this.send({ type: 'error', message: `Speech recognition: ${event.message}` });
      return;
    }
    if (event.type === 'partial_transcript') {
      this.onPartial(event.text ?? '');
      return;
    }
    if (event.type !== 'final_transcript' && event.type !== 'transcript') return;
    const text = event.text?.trim();
    if (!text) return;
    if (Date.now() < this.speakingUntil + ECHO_WINDOW_MS && isLikelyEcho(text, this.agentText)) return;
    const language = event.detected_language_code;
    if (language) {
      this.languages.add(language);
      this.language = language;
    }
    this.log('lead', text);
    this.send({ type: 'transcript', role: 'lead', text, language });
    // The tag tells the model which language to answer in; small models otherwise drift to English.
    this.onUserSpeech(language ? `[${language}] ${text}` : text);
  }

  // Partial words let the agent stop as soon as the lead cuts in, not only after they finish.
  // The reply waits for the final transcript.
  onPartial(text) {
    const agentBusy = this.turn || Date.now() < this.speakingUntil;
    if (!agentBusy || text.trim().split(/\s+/).length < 2 || isLikelyEcho(text, this.agentText)) return;
    this.turn?.abort.abort();
    this.stopSpeaking();
  }

  // New speech from the lead makes whatever the agent was saying stale (barge-in).
  onUserSpeech(text) {
    this.pendingUser.push(text);
    if (this.turn || Date.now() < this.speakingUntil) {
      this.turn?.abort.abort();
      this.stopSpeaking();
    }
    this.turns = this.turns.then(() => this.runTurn()).catch((err) => console.error('Turn crashed:', err));
  }

  async runTurn() {
    if (this.ended || this.pendingUser.length === 0) return; // an earlier turn already took this speech
    this.addUserMessage(this.pendingUser.splice(0).join(' '));
    const turn = { abort: new AbortController(), speech: Promise.resolve(), spoken: [], answered: false };
    this.turn = turn;
    this.send({ type: 'state', state: 'thinking' });
    try {
      await this.think(turn);
    } catch (err) {
      if (!turn.abort.signal.aborted) {
        console.error('Agent turn failed:', err.message);
        this.send({ type: 'error', message: `The agent could not answer: ${err.message.slice(0, 160)}` });
      }
    }
    await turn.speech;
    if (turn.spoken.length) this.log('agent', turn.spoken.join(' '));
    if (!turn.answered) this.closeInterruptedTurn(turn);
    if (this.turn === turn) this.turn = null;
    this.send({ type: 'state', state: 'listening' });
    if (this.ctx.endRequested && !turn.abort.signal.aborted) {
      await sleep(Math.max(0, this.speakingUntil - Date.now()) + 600);
      this.end('completed');
    }
  }

  // Streams the reply, speaking each sentence as soon as it is complete, and runs tool calls.
  async think(turn) {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let pending = '';
      const speakComplete = (text) => {
        const { sentences, rest } = takeSentences(text);
        pending = rest;
        for (const sentence of sentences) this.say(turn, sentence);
      };
      const { content, toolCalls } = await streamChat({
        messages: this.messages,
        tools: toolSpecs,
        signal: turn.abort.signal,
        onText: (delta) => speakComplete(pending + delta),
      });
      speakComplete(`${pending}\n`);
      this.messages.push({ role: 'assistant', content: stripLanguageTags(content), ...(toolCalls.length > 0 && { tool_calls: toolCalls }) });
      if (toolCalls.length === 0) {
        turn.answered = true;
        return;
      }
      if (!turn.saidAnything && toolCalls.some((call) => SLOW_TOOLS.has(call.function.name))) {
        this.say(turn, HOLD_PHRASES[this.language] ?? HOLD_PHRASE);
      }
      // Every tool call gets its result, even after a barge-in, so the history stays valid.
      for (const call of toolCalls) this.messages.push(await this.runToolCall(call));
      if (this.ctx.endRequested) {
        turn.answered = true; // goodbye already said; nothing more to ask the model
        return;
      }
      if (turn.abort.signal.aborted) return;
    }
  }

  async runToolCall(call) {
    const { name } = call.function;
    let result;
    try {
      const args = JSON.parse(call.function.arguments || '{}');
      this.send({ type: 'tool', name, args });
      result = await runTool(name, args, this.ctx);
    } catch (err) {
      console.error(`Tool ${name} failed:`, err.message);
      result = { error: 'This action failed. Tell the lead the team will follow up by email.' };
    }
    if (LIVE_TOOLS.has(name)) this.send({ type: 'lead', lead: this.ctx.lead, result });
    return { role: 'tool', tool_call_id: call.id, name, content: JSON.stringify(result) };
  }

  say(turn, sentence) {
    turn.saidAnything = true;
    turn.speech = turn.speech.then(async () => {
      if (turn.abort.signal.aborted || this.ended) return;
      this.agentText = `${this.agentText} ${sentence}`.slice(-400);
      this.send({ type: 'transcript', role: 'agent', text: sentence });
      await this.tts.speak(ttsRequest(sentence, this.ctx.settings.voice), (pcm) => {
        if (!turn.abort.signal.aborted) this.sendAudio(pcm);
      });
      turn.spoken.push(sentence);
    }).catch((err) => {
      if (turn.abort.signal.aborted || this.ended) return;
      console.error('Speech output failed:', err.message);
      this.send({ type: 'error', message: `Voice output failed: ${err.message}` });
    });
  }

  sendAudio(chunk) {
    // Raw PCM16 chunks can split a sample; carry the odd byte to the next chunk.
    const buffer = this.carry ? Buffer.concat([this.carry, chunk]) : chunk;
    const even = buffer.length - (buffer.length % 2);
    this.carry = even < buffer.length ? buffer.subarray(even) : null;
    if (even === 0 || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(buffer.subarray(0, even), { binary: true });
    this.speakingUntil = Math.max(Date.now(), this.speakingUntil) + (even / 2 / TTS_SAMPLE_RATE) * 1000;
  }

  stopSpeaking() {
    this.send({ type: 'clear' });
    this.speakingUntil = 0;
    this.carry = null;
    this.tts.reset();
  }

  addUserMessage(text) {
    const last = this.messages.at(-1);
    if (last.role === 'user') last.content += `\n${text}`;
    else this.messages.push({ role: 'user', content: text });
  }

  // An interrupted turn still needs an assistant message after tool results, and the
  // model should know which part of its reply the lead actually heard.
  closeInterruptedTurn(turn) {
    if (this.messages.at(-1).role === 'tool' || turn.spoken.length) {
      this.messages.push({ role: 'assistant', content: turn.spoken.join(' ') || '(interrupted)' });
    }
  }

  log(role, text) {
    this.writes = this.writes
      .then(() => Call.updateOne({ _id: this.callId }, { $push: { transcript: { role, text } } }))
      .catch((err) => console.error('Transcript write failed:', err.message));
  }

  send(message) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  async end(reason) {
    if (this.ended) return;
    this.ended = true;
    this.turn?.abort.abort();
    this.tts.close();
    this.stt.close();
    this.send({ type: 'ended', reason });
    this.ws.close();
    try {
      await this.turns;
      await this.writes;
      await Call.updateOne({ _id: this.callId }, { status: 'ended', endedAt: new Date(), endReason: reason, languages: [...this.languages] });
      await analyseCall(this.callId);
    } catch (err) {
      console.error('Call wrap-up failed:', err.message);
    }
  }
}
