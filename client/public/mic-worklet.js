// Runs on the audio thread of a 16 kHz AudioContext and emits the exact frames Gnani's
// streaming STT expects: 512 samples of mono signed 16-bit PCM (1024 bytes) every 32 ms.
const FRAME_SAMPLES = 512;

class MicFrames extends AudioWorkletProcessor {
  frame = new Int16Array(FRAME_SAMPLES);
  filled = 0;

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      const sample = Math.max(-1, Math.min(1, channel[i]));
      this.frame[this.filled++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      if (this.filled === FRAME_SAMPLES) {
        this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
        this.frame = new Int16Array(FRAME_SAMPLES);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('mic-frames', MicFrames);
