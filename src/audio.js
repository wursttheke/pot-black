// Synthetische Klick-/Stoßgeräusche über WebAudio.
export class Sfx {
  constructor() { this.ctx = null; this.budget = 0; this.enabled = true; }

  unlock() {
    if (!this.ctx) {
      try { this.ctx = new AudioContext(); } catch { return; }
      const len = this.ctx.sampleRate * 0.25;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  frame() { this.budget = 12; }

  hit(freq, q, vol, dur) {
    if (!this.ctx || !this.enabled || this.budget-- <= 0 || vol < 0.01) return;
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(Math.min(1, vol), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(c.destination);
    src.start(t, Math.random() * 0.1, dur + 0.02);
  }

  ball(speed) { this.hit(3200 + Math.random() * 600, 6, speed * 0.9, 0.05); }
  cue(power) { this.hit(1800, 3, 0.2 + power * 0.6, 0.04); }
  // Kleine Fanfare: aufsteigender Dreiklang, je Stufe länger und höher
  fanfare(level) {
    if (!this.ctx || !this.enabled) return;
    const c = this.ctx, t0 = c.currentTime + 0.05;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568.0].slice(0, 2 + level * 1.4 | 0);
    notes.forEach((f, i) => {
      const t = t0 + i * 0.12, dur = i === notes.length - 1 ? 0.9 : 0.22;
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(c.destination);
      o.start(t); o.stop(t + dur + 0.05);
    });
  }
  pocket() { this.hit(250, 1, 0.6, 0.25); setTimeout(() => this.hit(900, 4, 0.25, 0.08), 140); }
}
