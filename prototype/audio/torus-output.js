// Bounded polyphonic Web Audio output for the torus pointer's 12-bin PCD.
// Oscillators are created per enabled octave, then reused while the pointer moves.
export class TorusAudioOutput {
  constructor() {
    this.context = null;
    this.master = null;
    this.voices = new Map();
    this.pcd = new Float32Array(12);
    this.octaves = [4];
    this.threshold = 0.16;
    this.volume = 0.25;
  }

  isRunning() { return this.context !== null; }

  setThreshold(value) {
    this.threshold = Math.max(0, Math.min(0.4, value));
    this.applyLevels();
  }

  setVolume(value) {
    this.volume = Math.max(0, Math.min(0.5, value));
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.025);
    }
  }

  setOctaves(octaves) {
    this.octaves = [...new Set(octaves.filter(n => Number.isInteger(n) && n >= 2 && n <= 6))];
    if (!this.context) return;
    for (const [key, voice] of this.voices) {
      if (!this.octaves.includes(voice.octave)) {
        this.releaseVoice(voice);
        this.voices.delete(key);
      }
    }
    for (const octave of this.octaves) {
      for (let pitchClass = 0; pitchClass < 12; pitchClass++) {
        const key = octave * 12 + pitchClass;
        if (!this.voices.has(key)) this.createVoice(octave, pitchClass);
      }
    }
    this.applyLevels();
  }

  async start() {
    if (this.context) return;
    const context = new (window.AudioContext || window.webkitAudioContext)();
    try {
      const master = context.createGain();
      master.gain.value = this.volume;
      master.connect(context.destination);
      await context.resume();
      this.context = context;
      this.master = master;
      this.setOctaves(this.octaves);
    } catch (error) {
      await context.close();
      throw error;
    }
  }

  createVoice(octave, pitchClass) {
    const context = this.context;
    const midi = 12 * (octave + 1) + pitchClass;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    gain.gain.value = 0;
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start();
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
    this.voices.set(octave * 12 + pitchClass, { oscillator, gain, octave, pitchClass, lastTarget: 0 });
  }

  releaseVoice(voice) {
    const now = this.context.currentTime;
    voice.gain.gain.setTargetAtTime(0, now, 0.025);
    voice.oscillator.stop(now + 0.15);
  }

  update(pcd) {
    this.pcd.set(pcd);
    this.applyLevels();
  }

  applyLevels() {
    if (!this.context) return;
    let active = 0;
    for (let i = 0; i < 12; i++) if (this.pcd[i] >= this.threshold) active++;
    const divisor = Math.sqrt(Math.max(1, active * this.octaves.length));
    const now = this.context.currentTime;
    for (const voice of this.voices.values()) {
      const value = this.pcd[voice.pitchClass];
      const target = value >= this.threshold ? value / divisor : 0;
      if (Math.abs(target - voice.lastTarget) < 0.002) continue;
      voice.gain.gain.setTargetAtTime(target, now, 0.025);
      voice.lastTarget = target;
    }
  }

  async stop() {
    if (!this.context) return;
    const context = this.context;
    this.context = null;
    for (const voice of this.voices.values()) {
      const now = context.currentTime;
      voice.gain.gain.setTargetAtTime(0, now, 0.025);
      voice.oscillator.stop(now + 0.15);
    }
    this.voices.clear();
    await new Promise(resolve => setTimeout(resolve, 180));
    try { await context.close(); } catch {}
    this.master?.disconnect();
    this.master = null;
  }
}
