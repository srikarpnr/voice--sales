// Browser side of a call: mic -> 16 kHz PCM frames -> WebSocket, and agent PCM audio -> speakers.
export async function startVoiceCall({ leadId, token, onEvent }) {
  const mic = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  // The browser resamples the mic into this 16 kHz context, the rate Gnani STT is told to expect.
  const micContext = new AudioContext({ sampleRate: 16000 });
  const speaker = new AudioContext();
  await speaker.resume();
  await micContext.audioWorklet.addModule('/mic-worklet.js');

  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const query = new URLSearchParams({ lead: leadId });
  // The login token rides in the subprotocol header, not the URL, so it stays out of access logs.
  const ws = new WebSocket(`${scheme}://${window.location.host}/ws/call?${query}`, ['bearer', token]);
  ws.binaryType = 'arraybuffer';

  let sampleRate = 24000;
  let playAt = 0;
  const playing = new Set();
  // Analysers feed the live voice orb: who is talking right now, and how loud.
  const agentLevel = speaker.createAnalyser();
  agentLevel.connect(speaker.destination);
  const leadLevel = micContext.createAnalyser();

  function stopAudio() {
    for (const source of playing) source.stop();
    playing.clear();
    playAt = 0;
  }

  function play(buffer) {
    const pcm = new Int16Array(buffer);
    const clip = speaker.createBuffer(1, pcm.length, sampleRate);
    const channel = clip.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 32768;
    const source = speaker.createBufferSource();
    source.buffer = clip;
    source.connect(agentLevel);
    playAt = Math.max(playAt, speaker.currentTime + 0.05);
    source.start(playAt);
    playAt += clip.duration;
    playing.add(source);
    source.onended = () => playing.delete(source);
  }

  let closed = false;
  function release() {
    if (closed) return;
    closed = true;
    stopAudio();
    mic.getTracks().forEach((track) => track.stop());
    micContext.close();
    speaker.close();
  }

  ws.onmessage = ({ data }) => {
    if (data instanceof ArrayBuffer) {
      play(data);
      return;
    }
    const event = JSON.parse(data);
    if (event.type === 'ready') sampleRate = event.sampleRate;
    if (event.type === 'clear') stopAudio();
    onEvent(event);
  };
  ws.onclose = (event) => {
    release();
    onEvent({ type: 'closed', code: event.code, reason: event.reason });
  };

  const micNode = new AudioWorkletNode(micContext, 'mic-frames', { numberOfOutputs: 0 });
  micNode.port.onmessage = ({ data }) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  };
  const micSource = micContext.createMediaStreamSource(mic);
  micSource.connect(micNode);
  micSource.connect(leadLevel);

  const samples = new Float32Array(1024);
  function loudness(analyser) {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const s of samples) sum += s * s;
    return Math.min(1, Math.sqrt(sum / samples.length) * 6);
  }

  return {
    levels() {
      return closed ? { agent: 0, lead: 0 } : { agent: loudness(agentLevel), lead: loudness(leadLevel) };
    },
    hangUp() {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'hangup' }));
      setTimeout(() => ws.close(), 1500); // in case the server never answers
    },
    close() {
      ws.close();
      release();
    },
  };
}
