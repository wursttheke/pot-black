// Shot-Planer: bewertet alle Kombinationen aus Kugel "on" und Tasche und
// liefert den aussichtsreichsten Lochversuch (für die automatische Blickrichtung).
import { BALL_R as R, TABLE_L, TABLE_W, PHYS } from './constants.js';
import { cloneBalls, strike, step } from './physics.js';

const HW = TABLE_W / 2, HL = TABLE_L / 2;
const D2R = Math.PI / 180;

// Zielpunkte in den Taschenmündungen und erlaubte Einlaufwinkel
export const TARGETS = [];
for (const sx of [-1, 1]) {
  for (const sz of [-1, 1]) {
    TARGETS.push({
      x: sx * (HW - 0.008), z: sz * (HL - 0.008), ax: sx * Math.SQRT1_2, az: sz * Math.SQRT1_2,
      maxAngle: 52 * D2R, name: `Ecktasche ${sz < 0 ? 'oben' : 'unten'} ${sx > 0 ? 'rechts' : 'links'}`,
    });
  }
  TARGETS.push({ x: sx * (HW + 0.01), z: 0, ax: sx, az: 0, maxAngle: 42 * D2R, name: `Mitteltasche ${sx > 0 ? 'rechts' : 'links'}` });
}

const MAX_CUT = 78 * D2R;

// Abstand Punkt -> Strecke
function segDist(px, pz, x0, z0, x1, z1) {
  const ex = x1 - x0, ez = z1 - z0, l2 = ex * ex + ez * ez;
  let t = l2 ? ((px - x0) * ex + (pz - z0) * ez) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (x0 + t * ex), pz - (z0 + t * ez));
}

function pathClear(x0, z0, x1, z1, balls, skip, clearance) {
  for (const b of balls) {
    if (!b.onTable || skip.includes(b)) continue;
    if (segDist(b.x, b.z, x0, z0, x1, z1) < clearance) return false;
  }
  return true;
}

function aimAngle(fromX, fromZ, toX, toZ) {
  return Math.atan2(toX - fromX, -(toZ - fromZ));
}

// Bewertung eines einzelnen Lochversuchs (null = nicht spielbar)
export function evaluatePot(cue, obj, target, balls) {
  let dx = target.x - obj.x, dz = target.z - obj.z;
  const dOP = Math.hypot(dx, dz);
  if (dOP < 1e-6) return null;
  dx /= dOP; dz /= dOP;
  // Einlaufwinkel in die Tasche
  const entry = Math.acos(Math.min(1, dx * target.ax + dz * target.az));
  if (entry > target.maxAngle) return null;
  // Geisterkugel: Position der Weißen im Moment des Kontakts
  const gx = obj.x - dx * 2 * R, gz = obj.z - dz * 2 * R;
  if (Math.abs(gx) > HW - R || Math.abs(gz) > HL - R) return null;
  let cx = gx - cue.x, cz = gz - cue.z;
  const dCG = Math.hypot(cx, cz);
  if (dCG < 1e-6) return null;
  cx /= dCG; cz /= dCG;
  const cosCut = cx * dx + cz * dz;
  const cut = Math.acos(Math.max(-1, Math.min(1, cosCut)));
  if (cut > MAX_CUT) return null;
  // Wege frei? Weiße zur Geisterkugel, Objektkugel zur Tasche
  if (!pathClear(cue.x, cue.z, gx, gz, balls, [cue, obj], 2 * R - 0.001)) return null;
  if (!pathClear(obj.x, obj.z, target.x, target.z, balls, [cue, obj], 2 * R - 0.001)) return null;
  // Schwierigkeit: dünne Schnitte und lange Wege sind schwerer
  const ease = Math.pow(cosCut, 1.6) / ((0.35 + dCG) * (0.35 + dOP)) * (0.6 + 0.4 * Math.cos(entry));
  return { ease, cut, entry, dCG, dOP, aim: aimAngle(cue.x, cue.z, gx, gz), ghost: [gx, gz], target };
}

// Laufrichtung der Objektkugel direkt nach dem ersten Kontakt (nur Weiße + Objektkugel)
function objectDirection(cue, obj, aim, shot) {
  const [c, o] = cloneBalls([cue, obj]);
  strike(c, aim, shot.power, shot.tipX, shot.tipY);
  const ev = [];
  for (let i = 0; i < 20000; i++) {
    ev.length = 0;
    step([c, o], PHYS.dt, ev);
    if (ev.some(e => e.type === 'ball')) return Math.atan2(o.vx, -o.vz);
    if (!c.onTable || (c.vx === 0 && c.vz === 0)) return null;
  }
  return null;
}

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// Zielwinkel so nachjustieren, dass Throw und Squirt ausgeglichen werden
export function refineAim(cue, obj, target, aim, shot) {
  const want = Math.atan2(target.x - obj.x, -(target.z - obj.z));
  let a = aim;
  for (let it = 0; it < 4; it++) {
    const got = objectDirection(cue, obj, a, shot);
    if (got === null) return aim;
    const err = wrap(want - got);
    if (Math.abs(err) < 0.0005) break;
    // Objektwinkel ändert sich bei Schnittstößen schneller als der Zielwinkel
    const h = 0.002;
    const got2 = objectDirection(cue, obj, a + h, shot);
    const slope = got2 === null ? 1 : wrap(got2 - got) / h;
    a += err / (Math.abs(slope) > 0.2 ? slope : 1);
  }
  return a;
}

// Beste nächste Kugel. isOn(b) entscheidet, welche Kugeln erlaubt sind.
export function planNextShot(cue, balls, isOn, shot = { power: 0.35, tipX: 0, tipY: 0 }) {
  const candidates = balls.filter(b => b.onTable && b !== cue && isOn(b));
  if (!candidates.length) return null;
  const multipleColours = candidates.length > 1 && candidates.every(b => b.kind === 'colour');
  let best = null;
  for (const obj of candidates) {
    // Bei freier Farbwahl leicht höherwertige Farben bevorzugen
    const valueBonus = multipleColours ? 1 + 0.07 * obj.value : 1;
    for (const t of TARGETS) {
      const r = evaluatePot(cue, obj, t, balls);
      if (!r) continue;
      const score = r.ease * valueBonus;
      if (!best || score > best.score) best = { ...r, ball: obj, score, pottable: true };
    }
  }
  if (best) {
    best.aim = refineAim(cue, best.ball, best.target, best.aim, shot);
    return best;
  }

  // Kein direkter Lochversuch möglich: nächste frei anspielbare Kugel voll anvisieren
  const byDist = candidates
    .map(b => ({ b, d: Math.hypot(b.x - cue.x, b.z - cue.z) }))
    .sort((a, c) => a.d - c.d);
  const free = byDist.find(({ b }) => pathClear(cue.x, cue.z, b.x, b.z, balls, [cue, b], 2 * R - 0.001)) || byDist[0];
  return { ball: free.b, aim: aimAngle(cue.x, cue.z, free.b.x, free.b.z), pottable: false, score: 0 };
}
