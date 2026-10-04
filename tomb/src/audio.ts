// Chiptune sound effects and music, synthesised with WebAudio (no files).
// Browsers only allow audio after a tap or key press, so unlock() is called
// from the first input event.

type Wave = OscillatorType;

const NOTE = (semis: number) => 440 * Math.pow(2, semis / 12);

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noiseBuf: AudioBuffer | null = null;
  sfxOn = true;
  musicOn = true;
  private seq: { timer: number; step: number; next: number; song: Song } | null = null;
  private lastDot = 0;

  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.connect(this.master);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.musicOn ? 0.55 : 0;
      this.musicBus.connect(this.master);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    if (this.ctx) this.musicBus.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.05);
  }

  private tone(freq: number, dur: number, type: Wave, vol: number, to?: number, delay = 0, bus?: GainNode): void {
    const ctx = this.ctx;
    if (!ctx || (!this.sfxOn && !bus)) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus ?? this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, f0: number, f1: number, delay = 0, bus?: GainNode, q = 0.8): void {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuf || (!this.sfxOn && !bus)) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 1;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(bus ?? this.sfxBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  move(): void {
    this.noise(0.12, 0.25, 900, 3500);
  }

  land(len: number): void {
    this.tone(150, 0.07, 'square', 0.12, 70);
    if (len > 5) this.noise(0.06, 0.15, 400, 200);
  }

  bump(): void {
    this.tone(110, 0.05, 'square', 0.08, 90);
  }

  dot(combo: number): void {
    const now = performance.now();
    if (now - this.lastDot < 25) return;
    this.lastDot = now;
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
    this.tone(NOTE(3 + scale[Math.min(combo, scale.length - 1)]) * 2, 0.05, 'square', 0.05);
  }

  coin(): void {
    this.tone(NOTE(14), 0.06, 'square', 0.09);
    this.tone(NOTE(19), 0.16, 'square', 0.09, undefined, 0.06);
  }

  star(): void {
    [12, 16, 19, 24, 28].forEach((n, i) => this.tone(NOTE(n), 0.14, 'square', 0.08, undefined, i * 0.05));
  }

  power(): void {
    this.tone(NOTE(0), 0.3, 'triangle', 0.15, NOTE(24));
    this.tone(NOTE(7), 0.3, 'square', 0.04, NOTE(31), 0.04);
  }

  shield(): void {
    this.noise(0.25, 0.3, 3000, 400);
    this.tone(NOTE(12), 0.25, 'triangle', 0.15, NOTE(0));
  }

  trap(): void {
    this.tone(NOTE(-5), 0.05, 'square', 0.06);
    this.tone(NOTE(-5), 0.05, 'square', 0.06, undefined, 0.12);
  }

  death(cause: string): void {
    if (cause === 'context') this.noise(0.7, 0.35, 2000, 150, 0, undefined, 0.5);
    else this.noise(0.25, 0.35, 2500, 300);
    this.tone(NOTE(0), 0.5, 'square', 0.12, NOTE(-24));
  }

  win(): void {
    [0, 4, 7, 12, 7, 12, 16, 24].forEach((n, i) => this.tone(NOTE(n + 3), 0.16, 'square', 0.08, undefined, i * 0.07));
    this.tone(NOTE(-9), 0.6, 'triangle', 0.2, undefined, 0);
  }

  click(): void {
    this.tone(NOTE(12), 0.03, 'square', 0.05);
  }

  tick(): void {
    this.tone(NOTE(24), 0.015, 'square', 0.02);
  }

  // -------------------------------------------------------------- music ----

  startMusic(world: number): void {
    if (!this.ctx) return;
    if (this.seq && this.seq.song.world === world) return;
    this.stopMusic();
    const song = makeSong(world);
    const seq = { timer: 0, step: 0, next: this.ctx.currentTime + 0.1, song };
    seq.timer = window.setInterval(() => this.schedule(), 40);
    this.seq = seq;
  }

  stopMusic(): void {
    if (this.seq) clearInterval(this.seq.timer);
    this.seq = null;
  }

  private schedule(): void {
    const ctx = this.ctx;
    const seq = this.seq;
    if (!ctx || !seq) return;
    const stepDur = 60 / seq.song.bpm / 4;
    while (seq.next < ctx.currentTime + 0.2) {
      const delay = Math.max(0, seq.next - ctx.currentTime);
      const s = seq.step % 64;
      const chord = seq.song.chords[Math.floor(s / 16)];
      const i = s % 16;
      if (seq.song.bass[i]) this.tone(NOTE(chord[0] - 24), stepDur * 1.8, 'triangle', 0.22, undefined, delay, this.musicBus);
      const lead = seq.song.lead[i];
      if (lead >= 0) this.tone(NOTE(chord[lead % 3] + 12 * (lead >= 3 ? 1 : 0)), stepDur * 0.9, 'square', 0.035, undefined, delay, this.musicBus);
      if (i % 4 === 2) this.noise(0.03, 0.06, 7000, 6000, delay, this.musicBus, 2);
      if (i === 0 || i === 8) this.tone(70, 0.08, 'sine', 0.25, 40, delay, this.musicBus);
      seq.next += stepDur;
      seq.step++;
    }
  }
}

interface Song {
  world: number;
  bpm: number;
  chords: number[][];
  bass: boolean[];
  lead: number[];
}

/** A short loop per world: a four-chord progression with a seeded arpeggio. */
function makeSong(world: number): Song {
  let s = (world + 1) * 2654435761;
  const rnd = () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return (s >>> 8) / 16777216;
  };
  // Minor-key progressions, semitones from A.
  const progs = [
    [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]],
    [[2, 5, 9], [-2, 2, 5], [0, 4, 7], [-3, 0, 4]],
    [[-5, -2, 2], [-9, -5, -2], [-2, 2, 5], [-4, 0, 3]],
    [[0, 3, 7], [5, 8, 12], [-2, 2, 5], [3, 7, 10]],
    [[-3, 0, 4], [-7, -3, 0], [-5, -1, 2], [-10, -7, -3]],
  ];
  const chords = progs[world % progs.length];
  const bass = Array.from({ length: 16 }, (_, i) => i % 4 === 0 || (i % 4 === 3 && rnd() < 0.4));
  const lead = Array.from({ length: 16 }, (_, i) => (i % 2 === 0 || rnd() < 0.3 ? Math.floor(rnd() * 5) : -1));
  return { world, bpm: 128 + (world % 3) * 8, chords, bass, lead };
}
