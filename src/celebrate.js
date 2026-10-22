// Feier-Animationen über dem Spiel: Konfetti, Feuerwerk und Banner in drei Steigerungsstufen.
// Stufe 1: 50er-Break, Stufe 2: Century, Stufe 3: Clearance / Maximum.

const LEVELS = {
  1: { confetti: 160, cannons: 0, bursts: 0, duration: 3.5, palette: ['#f2c91a', '#ffffff', '#3fbf5a', '#e8b84a'] },
  2: { confetti: 380, cannons: 2, bursts: 4, duration: 5.5, palette: ['#ffd700', '#fff4c2', '#f2c91a', '#ffffff', '#e05a5a', '#3fbf5a'] },
  3: { confetti: 800, cannons: 6, bursts: 12, duration: 8, palette: ['#ffd700', '#ff4d6d', '#4dabff', '#7dff8a', '#ffffff', '#c77dff', '#ff9f1c'] },
};

// Welche Feier steht nach einem Stoß an? Clearance = Frame in einer Aufnahme beendet, die mit
// mindestens allen sechs Farben auf dem Tisch begann. Liefert null oder { level, title, subtitle }.
export function celebrationFor(out, prevBreak, visitStart, name) {
  if (out.foul || !out.points) return null;
  const brk = prevBreak + out.points;
  if (out.frameOver && visitStart >= 6) {
    return { level: 3, title: brk === 147 ? 'Maximum 147!' : 'Clearance!', subtitle: `${name} räumt den Tisch ab · Break ${brk}` };
  }
  if (prevBreak < 100 && brk >= 100) return { level: 2, title: 'Century Break!', subtitle: `${name} · Break ${brk}` };
  if (prevBreak < 50 && brk >= 50) return { level: 1, title: '50er-Break!', subtitle: `${name} · Break ${brk}` };
  return null;
}

const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

export class Celebration {
  constructor(sfx) {
    this.sfx = sfx;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'fx';
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.banner = document.createElement('div');
    this.banner.id = 'celebrate';
    document.body.appendChild(this.banner);
    this.parts = [];
    this.sparks = [];
    this.timers = [];
    this.running = false;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    this.dpr = Math.min(devicePixelRatio, 2);
    this.canvas.width = innerWidth * this.dpr;
    this.canvas.height = innerHeight * this.dpr;
  }

  play(level, title, subtitle) {
    const cfg = LEVELS[level];
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    const W = innerWidth, H = innerHeight;

    // Konfettiregen von oben, über eine Sekunde verteilt
    for (let i = 0; i < cfg.confetti; i++) {
      this.later(rand(0, 1000 + level * 400), () => this.parts.push(this.confetto(rand(0, W), rand(-60, -10), rand(-60, 60), rand(40, 160), cfg)));
    }
    // Konfettikanonen aus den unteren Ecken
    for (let c = 0; c < cfg.cannons; c++) {
      this.later(c * 450, () => {
        for (const side of [0, 1]) {
          for (let i = 0; i < 70; i++) {
            const a = side ? rand(-2.6, -2.0) : rand(-1.15, -0.55);
            const v = rand(550, 1000);
            this.parts.push(this.confetto(side ? W + 10 : -10, H * 0.9, Math.cos(a) * v, Math.sin(a) * v, cfg));
          }
        }
      });
    }
    // Feuerwerk
    for (let b = 0; b < cfg.bursts; b++) {
      this.later(300 + b * (level === 3 ? 450 : 650), () => this.burst(rand(W * 0.15, W * 0.85), rand(H * 0.12, H * 0.45), cfg, level));
    }

    this.banner.className = `lvl${level}`;
    this.banner.innerHTML = `<h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}`;
    void this.banner.offsetWidth; // Animation neu starten
    this.banner.classList.add('show');
    this.later(cfg.duration * 1000, () => this.banner.classList.remove('show'));
    this.sfx?.fanfare(level);

    if (!this.running) {
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame(t => this.frame(t));
    }
  }

  later(ms, fn) { this.timers.push(setTimeout(fn, ms)); }

  confetto(x, y, vx, vy, cfg) {
    return {
      x, y, vx, vy, w: rand(6, 11), h: rand(10, 18), rot: rand(0, Math.PI * 2), vr: rand(-8, 8),
      flip: rand(0, Math.PI * 2), vf: rand(4, 10), sway: rand(0.5, 1.5), color: pick(cfg.palette),
    };
  }

  burst(x, y, cfg, level) {
    const n = 60 + level * 30;
    const color = pick(cfg.palette);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(-0.05, 0.05);
      const v = rand(120, 320 + level * 40);
      this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.9, 1.6), age: 0, color: Math.random() < 0.25 ? '#ffffff' : color });
    }
  }

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const c = this.ctx, H = innerHeight;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, innerWidth, H);

    for (const p of this.parts) {
      p.vy += 520 * dt;
      p.vx *= 1 - 1.6 * dt; p.vy *= 1 - 1.1 * dt;
      p.x += (p.vx + Math.sin(p.flip) * 30 * p.sway) * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt; p.flip += p.vf * dt;
      c.save();
      c.translate(p.x, p.y); c.rotate(p.rot); c.scale(1, Math.cos(p.flip));
      c.fillStyle = p.color;
      c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      c.restore();
    }
    this.parts = this.parts.filter(p => p.y < H + 40);

    c.globalCompositeOperation = 'lighter';
    for (const s of this.sparks) {
      s.age += dt;
      s.vy += 160 * dt;
      s.vx *= 1 - 1.2 * dt; s.vy *= 1 - 1.2 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
      const a = Math.max(0, 1 - s.age / s.life);
      c.globalAlpha = a;
      c.fillStyle = s.color;
      c.beginPath(); c.arc(s.x, s.y, 2.2 + a * 1.5, 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    this.sparks = this.sparks.filter(s => s.age < s.life);

    if (this.parts.length || this.sparks.length || this.banner.classList.contains('show')) {
      requestAnimationFrame(t => this.frame(t));
    } else {
      this.running = false;
      c.clearRect(0, 0, innerWidth, H);
    }
  }
}
