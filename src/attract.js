// Vorspann im Startbildschirm: kurze Szenen mit echten Stößen, gefilmt aus wechselnden,
// teils leicht schiefen Kamerapositionen. Zwischen den Szenen wird hart geschnitten.
import { BALL_R as R, TABLE_L, TABLE_W, BAULK_Z, PHYS } from './constants.js';
import { strike, step } from './physics.js';
import { rackBalls } from './table.js';
import { evaluatePot, refineAim, TARGETS } from './planner.js';

const HW = TABLE_W / 2, HL = TABLE_L / 2;
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t * t * (3 - 2 * t);
const byName = (balls, name) => balls.find(b => b.name === name);
const target = (sx, sz) => TARGETS.find(t => Math.sign(t.x) === sx && (sz === 0 ? Math.abs(t.z) < 0.01 : Math.sign(t.z) === sz));

// Zielwinkel für einen Lochversuch (mit Ausgleich von Throw/Squirt)
function potAim(balls, obj, pocket, shot) {
  const cue = balls[0];
  const r = evaluatePot(cue, obj, pocket, balls);
  const dx = pocket.x - obj.x, dz = pocket.z - obj.z, l = Math.hypot(dx, dz);
  const gx = obj.x - dx / l * 2 * R, gz = obj.z - dz / l * 2 * R;
  const aim = r ? r.aim : Math.atan2(gx - cue.x, -(gz - cue.z));
  return refineAim(cue, obj, pocket, aim, shot);
}

// Weiße hinter die Geisterkugel legen, sodass ein Schnitt von `cutDeg` entsteht
function placeForPot(balls, obj, pocket, dist, cutDeg) {
  const dx = pocket.x - obj.x, dz = pocket.z - obj.z, l = Math.hypot(dx, dz);
  const ux = dx / l, uz = dz / l;
  const gx = obj.x - ux * 2 * R, gz = obj.z - uz * 2 * R;
  const a = cutDeg * Math.PI / 180;
  const bx = ux * Math.cos(a) - uz * Math.sin(a), bz = ux * Math.sin(a) + uz * Math.cos(a);
  Object.assign(balls[0], { x: gx - bx * dist, z: gz - bz * dist });
}

function clearReds(balls, keep = 0) {
  let n = 0;
  for (const b of balls) if (b.kind === 'red' && n++ >= keep) b.onTable = false;
}

const SCENES = [
  {
    // Ruhige Kreisfahrt über den aufgebauten Tisch
    name: 'orbit', dur: 7,
    setup: () => ({ balls: rackBalls() }),
    cam: (t) => {
      const a = 0.6 + t * 0.07;
      return { pos: [Math.sin(a) * 3.0, 1.45, Math.cos(a) * 3.4], look: [0, 0, -0.2], roll: 0 };
    },
  },
  {
    // Seitenansicht über den ganzen Tisch mit langsamer Fahrt entlang der Längsseite;
    // eine Rote wird mit leichtem Schnitt in die gegenüberliegende Mitteltasche gespielt
    name: 'side', dur: 7.5, shotAt: 2.2,
    setup: () => {
      const balls = rackBalls();
      clearReds(balls, 7);
      const spots = [[-0.32, -0.28], [0.35, -0.55], [-0.15, -1.15], [0.3, -1.25], [-0.5, 0.55], [0.55, 0.35], [0.1, 0.65]];
      balls.filter(b => b.kind === 'red' && b.onTable).forEach((b, i) => Object.assign(b, { x: spots[i][0], z: spots[i][1] }));
      const red = balls.find(b => b.kind === 'red' && b.onTable);
      const pocket = target(-1, 0);
      placeForPot(balls, red, pocket, 0.85, 18);
      const shot = { power: 0.4, tipX: 0, tipY: 0.1 };
      return { balls, shot: { ...shot, aim: potAim(balls, red, pocket, shot) } };
    },
    cam: (t) => {
      // Abstand so wählen, dass die ganze Tischlänge (inkl. Rahmen) ins Bild passt
      const aspect = innerWidth / innerHeight;
      const hHalf = Math.atan(Math.tan(25 * Math.PI / 180) * aspect);
      const d = Math.max(3.4, 2.45 / Math.tan(hHalf));
      const z = lerp(0.35, -0.35, t / 7.5);
      return { pos: [d, lerp(0.75, 0.95, t / 7.5), z], look: [0, -0.05, z * 0.6], roll: 0.02 };
    },
  },
  {
    // Anstoß, gefilmt von hinter dem Pack: die Weiße kommt auf die Kamera zu
    name: 'break', dur: 7.5, shotAt: 1.4,
    setup: () => {
      const balls = rackBalls();
      const reds = balls.filter(b => b.kind === 'red');
      const back = reds.reduce((a, b) => (b.z < a.z - 1e-6 || (Math.abs(b.z - a.z) < 1e-6 && b.x > a.x) ? b : a));
      const cue = balls[0];
      const d = Math.hypot(back.x - cue.x, back.z - cue.z);
      const aim = Math.atan2(back.x - cue.x, -(back.z - cue.z)) + Math.asin(2 * R * 0.93 / d);
      return { balls, shot: { aim, power: 0.62, tipX: 0.35, tipY: 0.05 } };
    },
    cam: (t) => ({ pos: [lerp(0.2, 0.3, t / 7.5), lerp(0.16, 0.22, t / 7.5), -1.66], look: [0.05, 0, 0.6], roll: 0.07 }),
  },
  {
    // Lange Rote in die Ecke – Kamera tief in der Tasche, die Kugel rollt auf sie zu
    name: 'long-red', dur: 6.5, shotAt: 1.2,
    setup: () => {
      const balls = rackBalls();
      const red = balls.find(b => b.kind === 'red');
      Object.assign(red, { x: -0.62, z: -1.05 });
      for (const b of balls) if (b.kind === 'red' && b !== red && b.x < -0.03) b.onTable = false;
      const pocket = target(-1, -1);
      placeForPot(balls, red, pocket, 1.25, 8);
      const shot = { power: 0.48, tipX: 0, tipY: 0.25 };
      return { balls, shot: { ...shot, aim: potAim(balls, red, pocket, shot) }, focus: red };
    },
    cam: (t, balls) => {
      const c = balls[0];
      return { pos: [-HW + 0.05, 0.075, -HL + 0.05], look: [lerp(c.x, -0.62, 0.35), 0, lerp(c.z, -1.05, 0.35)], roll: -0.06 };
    },
  },
  {
    // Schwarze vom Spot mit Rückläufer, seitlich tief gefilmt mit langsamer Fahrt
    name: 'black-screw', dur: 6.5, shotAt: 1.2,
    setup: () => {
      // Letzte Schwarze: nur noch Weiße und Schwarz auf dem Tisch
      const balls = rackBalls();
      for (const b of balls) if (b.kind !== 'cue' && b.name !== 'black') b.onTable = false;
      const black = byName(balls, 'black');
      const pocket = target(1, -1);
      placeForPot(balls, black, pocket, 0.42, 6);
      const shot = { power: 0.42, tipX: 0, tipY: -0.45 };
      return { balls, shot: { ...shot, aim: potAim(balls, black, pocket, shot) } };
    },
    cam: (t, balls, scene) => {
      // Seitlich zur Stoßlinie (Baulk-Seite), langsame Fahrt entlang der Linie
      const { x, z } = scene.start, bx = 0, bz = -HL + 0.324;
      const dx = bx - x, dz = bz - z, l = Math.hypot(dx, dz), ux = dx / l, uz = dz / l;
      const mx = (x + bx) / 2 + ux * 0.05, mz = (z + bz) / 2 + uz * 0.05;
      const px = -uz, pz = ux; // senkrecht zur Linie, Richtung Baulk
      const side = pz > 0 ? 1 : -1, slide = lerp(-0.12, 0.12, t / 6.5);
      return { pos: [mx + px * side * 1.05 + ux * slide, 0.2, mz + pz * side * 1.05 + uz * slide], look: [mx, 0, mz], roll: 0.05 };
    },
  },
  {
    // Kranfahrt über dem Tisch: Blau mit leichtem Schnitt in die Mitteltasche
    name: 'blue-middle', dur: 7, shotAt: 1.6,
    setup: () => {
      const balls = rackBalls();
      clearReds(balls, 6);
      const blue = byName(balls, 'blue');
      Object.assign(blue, { x: 0.35, z: 0.12 });
      const pocket = target(1, 0);
      placeForPot(balls, blue, pocket, 0.7, -14);
      const shot = { power: 0.38, tipX: 0, tipY: 0 };
      return { balls, shot: { ...shot, aim: potAim(balls, blue, pocket, shot) } };
    },
    cam: (t, balls, scene) => {
      // Kran kreist langsam um die Mitte zwischen Weißer und Mitteltasche, Blick zurück Richtung Baulk
      const cx = (scene.start.x + HW) / 2, cz = scene.start.z / 2;
      const a = 2.25 + t * 0.06;
      return { pos: [cx + Math.sin(a) * 1.05, lerp(0.95, 0.75, t / 7), cz + Math.cos(a) * 1.05], look: [cx, 0, cz], roll: 0.12 };
    },
  },
  {
    // Pink in die Ecke mit Nachläufer, aus der Spielerperspektive mit leichter Schräglage
    name: 'pink-follow', dur: 6.5, shotAt: 1.5,
    setup: () => {
      const balls = rackBalls();
      clearReds(balls, 3);
      const spots = [[0.45, -0.35], [0.6, 0.45], [-0.55, 0.3]];
      balls.filter(b => b.kind === 'red' && b.onTable).forEach((b, i) => Object.assign(b, { x: spots[i][0], z: spots[i][1] }));
      const pink = byName(balls, 'pink');
      Object.assign(pink, { x: -0.3, z: -1.2 });
      const pocket = target(-1, -1);
      placeForPot(balls, pink, pocket, 0.9, -10);
      const shot = { power: 0.4, tipX: 0, tipY: 0.4 };
      return { balls, shot: { ...shot, aim: potAim(balls, pink, pocket, shot) }, behind: true };
    },
    cam: (t, balls, scene) => {
      const { x, z } = scene.start, a = scene.shot.aim;
      const dx = Math.sin(a), dz = -Math.cos(a);
      const back = lerp(0.55, 0.75, t / 6.5), h = lerp(0.12, 0.22, t / 6.5);
      return { pos: [x - dx * back + dz * 0.08, h, z - dz * back - dx * 0.08], look: [x + dx * 1.2, 0, z + dz * 1.2], roll: -0.09 };
    },
  },
];

export class Attract {
  constructor() {
    this.index = -1;
    this.changed = false;
    this.next();
  }

  next() {
    this.index = (this.index + 1) % SCENES.length;
    const def = SCENES[this.index];
    const s = def.setup();
    this.def = def;
    this.balls = s.balls;
    this.shot = s.shot || null;
    this.start = { x: this.balls[0].x, z: this.balls[0].z };
    this.t = 0;
    this.struck = false;
    this.simAcc = 0;
    this.changed = true;
  }

  // Liefert Kamera und Queue-Zustand für das aktuelle Bild
  update(dt) {
    this.t += dt;
    if (this.t >= this.def.dur) this.next();
    const def = this.def, shot = this.shot, cue = this.balls[0];
    let cueState = null;
    if (shot) {
      const tShot = this.t - def.shotAt;
      if (!this.struck) {
        // Ausholen und Zustoßen wie im Spiel
        const back = 0.03 + shot.power * 0.17;
        let pull = 0.012 + back * ease(Math.min(1, Math.max(0, (tShot + 0.9) / 0.5)));
        if (tShot > 0) pull = Math.max(0, (0.012 + back) * (1 - (tShot / 0.1) ** 2));
        if (tShot >= 0.1) {
          strike(cue, shot.aim, shot.power, shot.tipX, shot.tipY);
          this.struck = true;
        }
        cueState = { pos: this.start, pull };
      } else if (tShot < 0.6) {
        cueState = { pos: this.start, pull: -0.05 * Math.min(1, (tShot - 0.1) / 0.12) };
      }
    }
    if (this.struck) {
      this.simAcc += dt;
      while (this.simAcc >= PHYS.dt) { this.simAcc -= PHYS.dt; step(this.balls, PHYS.dt, []); }
    }
    const cam = def.cam(this.t, this.balls, this);
    return { cam, cue: cueState && shot ? { ...cueState, aim: shot.aim, tipX: shot.tipX, tipY: shot.tipY } : null };
  }
}

export { SCENES };
