/** Gesture-unlocked Web Audio synthesis. No downloads or third-party audio assets. */
export class AudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private boostGain: GainNode | null = null;
  private engine: OscillatorNode[] = [];
  private noise: AudioBuffer | null = null;
  private sources: AudioScheduledSourceNode[] = [];
  private muted = false;
  private disposed = false;
  private previousBoost = false;

  unlock(): void {
    if (this.disposed) return;
    try {
      if (!this.context) {
        const Constructor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Constructor) return;
        const ctx = new Constructor(); this.context = ctx;
        this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : .38;
        const limiter = ctx.createDynamicsCompressor(); limiter.threshold.value = -10; limiter.knee.value = 14; limiter.ratio.value = 6;
        this.master.connect(limiter); limiter.connect(ctx.destination);
        this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const data = this.noise.getChannelData(0); let previous = 0;
        for (let i = 0; i < data.length; i++) { previous = (previous + (Math.random() * 2 - 1) * .04) / 1.04; data[i] = previous * 3.5; }
        this.engineGain = ctx.createGain(); this.engineGain.gain.value = 0;
        const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 1100; filter.Q.value = .5;
        this.engineGain.connect(filter); filter.connect(this.master);
        for (let i = 0; i < 3; i++) { const oscillator = ctx.createOscillator(); oscillator.type = i === 2 ? 'triangle' : 'sawtooth'; oscillator.frequency.value = 44 * (i + 1); oscillator.detune.value = i === 1 ? 7 : -3; oscillator.connect(this.engineGain); oscillator.start(); this.engine.push(oscillator); this.sources.push(oscillator); }
        this.windGain = this.loopNoise('highpass', 650);
        this.boostGain = this.loopNoise('bandpass', 1600);
      }
      if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
    } catch { /* Devices without Web Audio can still play the game. */ }
  }

  private loopNoise(type: BiquadFilterType, frequency: number): GainNode {
    const ctx = this.context!;
    const source = ctx.createBufferSource(); source.buffer = this.noise; source.loop = true;
    const filter = ctx.createBiquadFilter(); filter.type = type; filter.frequency.value = frequency;
    const gain = ctx.createGain(); gain.gain.value = 0;
    source.connect(filter); filter.connect(gain); gain.connect(this.master!); source.start(); this.sources.push(source);
    return gain;
  }

  update(speed: number, boost: boolean, dt: number): void {
    const ctx = this.context; if (!ctx || ctx.state !== 'running' || this.disposed) return;
    const velocity = Math.max(0, Math.abs(speed)), now = ctx.currentTime, smoothing = Math.max(.035, Math.min(.14, dt * 4));
    // Small virtual gear drops keep the motor lively without abrupt sample changes.
    const gear = Math.min(5, Math.floor(velocity / 27));
    const frequency = 32 + velocity * 1.45 - gear * 14;
    this.engine.forEach((oscillator, i) => oscillator.frequency.setTargetAtTime(frequency * (i + 1) * (boost ? 1.12 : 1), now, smoothing));
    this.engineGain?.gain.setTargetAtTime(velocity > .8 ? .018 + Math.min(velocity / 140, 1) * .028 : .006, now, smoothing);
    this.windGain?.gain.setTargetAtTime(Math.min(velocity / 170, 1) ** 2 * .17, now, .18);
    this.boostGain?.gain.setTargetAtTime(boost ? .34 : 0, now, .08);
    if (boost && !this.previousBoost) this.play('nitro');
    this.previousBoost = boost;
  }

  private tone(frequency: number, endFrequency: number, duration: number, type: OscillatorType = 'sine', volume = .15, delay = 0): void {
    const ctx = this.context; if (!ctx || !this.master) return;
    const time = ctx.currentTime + delay;
    const oscillator = ctx.createOscillator(), gain = ctx.createGain(); oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(20, frequency), time); oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), time + duration);
    gain.gain.setValueAtTime(0, time); gain.gain.linearRampToValueAtTime(volume, time + .009); gain.gain.exponentialRampToValueAtTime(.0001, time + duration);
    oscillator.connect(gain); gain.connect(this.master); oscillator.start(time); oscillator.stop(time + duration + .03);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }

  private burst(duration: number, frequency: number, volume: number, type: BiquadFilterType = 'lowpass'): void {
    const ctx = this.context; if (!ctx || !this.master || !this.noise) return;
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain(); source.buffer = this.noise;
    filter.type = type; filter.frequency.setValueAtTime(frequency, ctx.currentTime); filter.frequency.exponentialRampToValueAtTime(Math.max(40, frequency * .2), ctx.currentTime + duration);
    gain.gain.setValueAtTime(volume, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + duration);
    source.connect(filter); filter.connect(gain); gain.connect(this.master); source.start(); source.stop(ctx.currentTime + duration);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
  }

  play(kind: string): void {
    if (!this.context || this.context.state !== 'running' || this.muted || this.disposed) return;
    switch (kind.toLowerCase()) {
      case 'speed': this.tone(330, 950, .32, 'triangle', .17); this.tone(660, 1500, .3, 'sine', .1, .06); break;
      case 'nitro': case 'boost': this.burst(.6, 2600, .65, 'bandpass'); this.tone(140, 650, .48, 'sawtooth', .055); break;
      case 'super': [440, 554.37, 659.25, 880].forEach((f, i) => this.tone(f, f * 1.5, .45, 'triangle', .13, i * .07)); this.burst(.6, 3600, .4, 'highpass'); break;
      case 'shield': this.tone(420, 840, .5, 'sine', .2); this.tone(630, 1260, .65, 'sine', .12, .06); break;
      case 'grip': this.tone(180, 310, .2, 'triangle', .18); this.tone(310, 620, .32, 'triangle', .14, .12); break;
      case 'collision': case 'crash': case 'hit': this.burst(.3, 1300, .9); this.tone(105, 30, .25, 'triangle', .35); break;
      case 'checkpoint': this.tone(660, 660, .15, 'sine', .14); this.tone(990, 990, .25, 'sine', .17, .12); break;
      case 'lap': this.tone(523, 523, .2, 'triangle', .17); this.tone(659, 659, .2, 'triangle', .17, .13); this.tone(1047, 1047, .45, 'triangle', .17, .26); break;
      case 'countdown': case 'tick': this.tone(520, 510, .13, 'square', .065); break;
      case 'go': case 'start': this.tone(1047, 1047, .6, 'square', .075); this.tone(1568, 1568, .45, 'sine', .12); break;
      case 'finish': case 'win': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, .7, 'triangle', .16, i * .16)); break;
      case 'item': case 'pickup': this.tone(740, 1110, .18, 'sine', .17); this.tone(1110, 1480, .25, 'sine', .14, .1); break;
      case 'emp': case 'shockwave': this.burst(.65, 2800, .75, 'bandpass'); this.tone(500, 35, .5, 'sawtooth', .1); break;
      case 'ice': this.burst(.45, 7500, .6, 'highpass'); this.tone(1800, 900, .5, 'sine', .1); break;
      case 'oil': case 'slow': this.tone(180, 45, .4, 'sawtooth', .12); this.burst(.3, 480, .6); break;
      case 'block': this.burst(.22, 800, .8); this.tone(90, 40, .2, 'square', .08); break;
      case 'orb': this.tone(900, 160, .6, 'sine', .2); this.tone(910, 170, .6, 'sine', .1); break;
      case 'switch': this.tone(250, 1400, .22, 'triangle', .16); this.tone(1400, 250, .22, 'triangle', .16, .18); break;
      case 'trap': case 'deploy': this.tone(290, 120, .2, 'triangle', .2); this.burst(.2, 1800, .35); break;
      case 'click': this.tone(700, 450, .055, 'sine', .1); break;
    }
  }

  setMuted(muted: boolean): void { this.muted = muted; if (this.context && this.master) this.master.gain.setTargetAtTime(muted ? 0 : .38, this.context.currentTime, .03); }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.sources.forEach(source => { try { source.stop(); source.disconnect(); } catch { /* Already stopped. */ } }); this.sources = []; this.engine = []; if (this.context) void this.context.close().catch(() => {}); this.context = null; }
}
