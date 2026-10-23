// Geräusche über WebAudio: Stoß, Kugelkontakt und Tasche als echte Aufnahmen (sounds/*.wav, je eine
// leise, mittlere und harte Variante), Fanfaren und Applaus synthetisch. Solange die Aufnahmen noch
// laden (oder fehlen), springen synthetische Klicks ein.
const SAMPLES = ['cue', 'ball', 'pocket'].flatMap(k => ['soft', 'medium', 'hard'].map(l => `${k}-${l}`));

export class Sfx {
  constructor() { this.ctx = null; this.budget = 0; this.enabled = true; this.samples = null; }

  unlock() {
    if (!this.ctx) {
      try { this.ctx = new AudioContext(); } catch { return; }
      const len = this.ctx.sampleRate * 0.25;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.loadSamples();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  loadSamples() {
    this.samples = {};
    for (const name of SAMPLES) {
      fetch(`sounds/${name}.wav`)
        .then(r => r.arrayBuffer())
        .then(b => this.ctx.decodeAudioData(b))
        .then(buf => { this.samples[name] = buf; })
        .catch(() => { /* Datei fehlt: synthetischer Klang bleibt */ });
    }
  }

  frame() { this.budget = 12; }

  // Darf jetzt ein Geräusch starten? (Ton an, höchstens 12 je Bild)
  ready() { return this.ctx && this.enabled && this.budget-- > 0; }

  // Aufnahme abspielen: strength 0..1 wählt leise/mittel/hart, gain die Lautstärke; leicht verstimmt,
  // damit sich wiederholte Treffer nicht identisch anhören. false, wenn die Aufnahme (noch) fehlt.
  sample(kind, strength, gain) {
    const level = strength < 0.33 ? 'soft' : strength < 0.66 ? 'medium' : 'hard';
    const buf = this.samples?.[`${kind}-${level}`];
    if (!buf) return false;
    const c = this.ctx, src = c.createBufferSource(), g = c.createGain();
    src.buffer = buf;
    src.playbackRate.value = 0.96 + Math.random() * 0.08;
    g.gain.value = Math.min(1, gain);
    src.connect(g).connect(c.destination);
    src.start();
    return true;
  }

  hit(freq, q, vol, dur) {
    if (vol >= 0.01 && this.ready()) this.synth(freq, q, vol, dur);
  }

  // Synthetischer Klick: Rauschen durch einen Bandpass mit kurzem Abklingen
  synth(freq, q, vol, dur) {
    if (vol < 0.01) return;
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(Math.min(1, vol), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(c.destination);
    src.start(t, Math.random() * 0.1, dur + 0.02);
  }

  // Kugel trifft Kugel; speed: Aufprallgeschwindigkeit in m/s
  ball(speed) {
    if (speed < 0.03) return;
    const s = Math.min(1, speed / 2.5);
    if (!this.ready()) return;
    if (!this.sample('ball', s, 0.06 + 0.75 * s ** 0.8)) this.synth(3200 + Math.random() * 600, 6, speed * 0.3, 0.05);
  }
  // Queue trifft die Weiße; power: Stoßstärke 0..1
  cue(power) {
    if (!this.ready()) return;
    if (!this.sample('cue', power, 0.25 + 0.6 * power)) this.synth(1800, 3, 0.2 + power * 0.6, 0.04);
  }
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
  // Maximum: Trommelwirbel bis zum Knall, dann eine große Fanfare und langer Applaus
  maximum(rollSec) {
    if (!this.ctx || !this.enabled) return;
    const c = this.ctx, t0 = c.currentTime + 0.05;
    // Wirbel: immer dichtere, lautere Schläge
    for (let t = 0; t < rollSec;) {
      const f = t / rollSec;
      this.noiseHit(t0 + t, 180 + f * 120, 0.8, 0.06 + f * 0.3, 0.09);
      t += 0.11 - f * 0.085;
    }
    const tb = t0 + rollSec;
    this.crashAt(tb, 1);
    // Fanfare: Dreiklänge aufwärts bis zum langen Schlussakkord
    const chords = [[523.25, 659.25, 783.99], [587.33, 739.99, 880], [659.25, 830.61, 987.77], [783.99, 987.77, 1174.66, 1567.98]];
    const times = [0, 0.18, 0.36, 0.62];
    chords.forEach((ch, i) => {
      const t = tb + 0.05 + times[i], dur = i === chords.length - 1 ? 2.6 : 0.2;
      for (const f of ch) {
        for (const type of ['sawtooth', 'triangle']) {
          const o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
          o.type = type; o.frequency.value = f; lp.type = 'lowpass'; lp.frequency.value = 2600;
          const vol = type === 'sawtooth' ? 0.035 : 0.07;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
          g.gain.setValueAtTime(vol, t + dur * 0.6);
          g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
          o.connect(lp).connect(g).connect(c.destination);
          o.start(t); o.stop(t + dur + 0.05);
        }
      }
    });
    // Applaus: Rauschen als Grundteppich, darüber viele einzelne Klatscher
    const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.7;
    const g = c.createGain();
    const ta = tb + 0.4, te = ta + 9;
    g.gain.setValueAtTime(0.0001, ta);
    g.gain.exponentialRampToValueAtTime(0.12, ta + 1.2);
    g.gain.setValueAtTime(0.12, te - 3);
    g.gain.exponentialRampToValueAtTime(0.0001, te);
    src.connect(bp).connect(g).connect(c.destination);
    src.start(ta); src.stop(te + 0.1);
    for (let i = 0; i < 260; i++) {
      const t = ta + Math.random() * 8;
      this.noiseHit(t, 1400 + Math.random() * 1800, 2, 0.05 + Math.random() * 0.08, 0.03);
    }
  }

  // Beckenschlag mit Pauke, Stärke 0..1 (kein Explosionsknall)
  crash(strength) { if (this.ctx && this.enabled) this.crashAt(this.ctx.currentTime + 0.02, strength); }
  crashAt(t, strength) {
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4500;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22 * strength, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    src.connect(hp).connect(g).connect(c.destination);
    src.start(t); src.stop(t + 1.9);
    const o = c.createOscillator(), og = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(98, t); o.frequency.exponentialRampToValueAtTime(82, t + 0.6);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.3 * strength, t + 0.01);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    o.connect(og).connect(c.destination);
    o.start(t); o.stop(t + 0.85);
  }

  // Gefiltertes Rauschen zu einem festen Zeitpunkt (ohne das Budget pro Bild)
  noiseHit(t, freq, q, vol, dur) {
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.min(1, vol), t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(c.destination);
    src.start(t, Math.random() * 0.1, dur + 0.02);
  }
  // Kugel fällt in die Tasche; speed: Tempo beim Einlaufen in m/s
  pocket(speed = 1) {
    const s = Math.min(1, speed / 1.6);
    if (!this.ready()) return;
    if (!this.sample('pocket', s, 0.35 + 0.55 * s)) {
      this.synth(250, 1, 0.6, 0.25);
      setTimeout(() => this.hit(900, 4, 0.25, 0.08), 140);
    }
  }
}
