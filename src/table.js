// Tischhilfen: Aufbau, Wiederaufsetzen von Farben, D-Bereich, Snooker-Prüfung.
import { BALL_R as R, TABLE_L, TABLE_W, BAULK_Z, D_RADIUS, PINK_SPOT_Z, COLOURS,
  CUSHION_HEIGHT, CUSHION_WIDTH, RAIL_HEIGHT } from './constants.js';
import { makeBall } from './physics.js';

const HL = TABLE_L / 2, HW = TABLE_W / 2;

// Queue über die Bande: steilste übliche Queuehaltung und Schaftdicke
const MAX_ELEV_TAN = 0.3;
const SHAFT_R0 = 0.0049, SHAFT_TAPER = 0.0066;
export const TIP_TOP_LIMIT = 0.5; // höchster erzwungener Mindest-Treffpunkt (oberer Kugelbereich)

export function rackBalls() {
  // Anstoßposition: genau zwischen Braun und Gelb auf der Baulk-Linie
  const balls = [makeBall(0, 'cue', 'cue', 0, D_RADIUS / 2, BAULK_Z)];
  let id = 1;
  const gap = 0.0003;
  const apexZ = PINK_SPOT_Z - 2 * R - 0.003;
  for (let row = 0; row < 5; row++) {
    for (let k = 0; k <= row; k++) {
      const x = (k - row / 2) * (2 * R + gap);
      const z = apexZ - row * (2 * R + gap) * Math.sqrt(3) / 2;
      balls.push(makeBall(id++, 'red', 'red', 1, x, z));
    }
  }
  for (const c of COLOURS) {
    const b = makeBall(id++, 'colour', c.name, c.value, c.spot[0], c.spot[1]);
    b.spot = c.spot;
    balls.push(b);
  }
  return balls;
}

export function isFree(balls, x, z, except) {
  for (const b of balls) {
    if (!b.onTable || b === except) continue;
    if (Math.hypot(b.x - x, b.z - z) < 2 * R + 0.0005) return false;
  }
  return true;
}

function place(ball, x, z) {
  ball.x = x; ball.z = z; ball.onTable = true; ball.pocket = null;
  ball.vx = ball.vz = ball.wx = ball.wy = ball.wz = 0;
}

// Regel: eigener Punkt, sonst höchstwertiger freier Punkt, sonst möglichst nah
// am eigenen Punkt in Richtung Kopfbande (bzw. notfalls Richtung Baulk).
export function respot(ball, balls) {
  const [sx, sz] = ball.spot;
  if (isFree(balls, sx, sz, ball)) return place(ball, sx, sz);
  for (const c of [...COLOURS].reverse()) {
    if (isFree(balls, c.spot[0], c.spot[1], ball)) return place(ball, c.spot[0], c.spot[1]);
  }
  for (let z = sz; z > -HL + R; z -= 0.001) if (isFree(balls, sx, z, ball)) return place(ball, sx, z);
  for (let z = sz; z < HL - R; z += 0.001) if (isFree(balls, sx, z, ball)) return place(ball, sx, z);
}

export function inD(x, z) {
  return z >= BAULK_Z && x * x + (z - BAULK_Z) ** 2 <= D_RADIUS * D_RADIUS;
}

export function clampToD(x, z) {
  if (z < BAULK_Z) z = BAULK_Z;
  const dx = x, dz = z - BAULK_Z, l = Math.hypot(dx, dz);
  if (l > D_RADIUS) { x = dx / l * D_RADIUS; z = BAULK_Z + dz / l * D_RADIUS; }
  return [x, z];
}

// Freie Position im D in der Nähe von (x, z) finden
export function freeSpotInD(balls, cue, x, z) {
  [x, z] = clampToD(x, z);
  if (isFree(balls, x, z, cue)) return [x, z];
  for (let r = 0.005; r < 0.6; r += 0.005) {
    for (let a = 0; a < Math.PI * 2; a += 0.2) {
      const [px, pz] = clampToD(x + Math.cos(a) * r, z + Math.sin(a) * r);
      if (isFree(balls, px, pz, cue)) return [px, pz];
    }
  }
  return null;
}

function pathBlocked(x0, z0, x1, z1, obstacles) {
  const ex = x1 - x0, ez = z1 - z0, l2 = ex * ex + ez * ez;
  for (const o of obstacles) {
    let t = ((o.x - x0) * ex + (o.z - z0) * ez) / l2;
    t = Math.max(0, Math.min(1, t));
    if (Math.hypot(o.x - (x0 + t * ex), o.z - (z0 + t * ez)) < 2 * R - 1e-4) return true;
  }
  return false;
}

// Gesnookert = jede Kugel "on" ist auf direktem Weg (beide äußeren Kanten)
// ganz oder teilweise durch eine Kugel, die nicht "on" ist, verdeckt.
export function isSnookered(cue, balls, isOn) {
  const targets = balls.filter(b => b.onTable && b !== cue && isOn(b));
  if (!targets.length) return false;
  const obstacles = balls.filter(b => b.onTable && b !== cue && !isOn(b));
  for (const t of targets) {
    const dx = t.x - cue.x, dz = t.z - cue.z, d = Math.hypot(dx, dz);
    const px = -dz / d, pz = dx / d;
    let clear = true;
    for (const side of [-1, 1]) {
      const ex = t.x + px * side * 2 * R * 0.98, ez = t.z + pz * side * 2 * R * 0.98;
      if (pathBlocked(cue.x, cue.z, ex, ez, obstacles)) { clear = false; break; }
    }
    if (clear) return false;
  }
  return true;
}

// Hindernisse hinter der Weißen entlang der Queue-Linie: [horizontaler Abstand, Oberkante].
// Bande/Rahmen sowie Kugeln, über die das Queue hinweggeführt werden muss.
function cueObstacles(cue, aim, balls = [], tipX = 0) {
  const dx = Math.sin(aim), dz = -Math.cos(aim);
  const px = cue.x - dx * R * 0.8, pz = cue.z - dz * R * 0.8; // ungefährer Treffpunkt
  let t = Infinity;
  if (dx < 0) t = Math.min(t, (HW - px) / -dx);
  if (dx > 0) t = Math.min(t, (px + HW) / dx);
  if (dz < 0) t = Math.min(t, (HL - pz) / -dz);
  if (dz > 0) t = Math.min(t, (pz + HL) / dz);
  t = Math.max(0.003, t);
  const obstacles = [[t, CUSHION_HEIGHT], [t + CUSHION_WIDTH, RAIL_HEIGHT]];
  // Kugeln hinter der Weißen: Queue-Achse (seitlich um den Effet versetzt) muss Abstand
  // R + Schaftradius zum Kugelmittelpunkt halten. Umgerechnet in eine Oberkante bei Abstand tc.
  const rx = -dz, rz = dx, side = tipX * R;
  const k = Math.sqrt(1 + MAX_ELEV_TAN * MAX_ELEV_TAN);
  for (const b of balls) {
    if (!b.onTable || b === cue) continue;
    const ox = b.x - px, oz = b.z - pz;
    const tc = -(ox * dx + oz * dz);            // Abstand hinter dem Treffpunkt
    if (tc <= 0 || tc > 0.4) continue;
    const l = Math.abs(ox * rx + oz * rz - side); // seitlicher Abstand zur Queue-Achse
    const rs = SHAFT_R0 + SHAFT_TAPER * tc;
    if (l >= R + rs) continue;
    obstacles.push([tc, R + k * Math.sqrt((R + rs) ** 2 - l * l) - rs]);
  }
  return obstacles;
}

// Niedrigster spielbarer Treffpunkt (in Kugelradien), wenn das Queue über Bande, Rahmen
// oder nahe Kugeln geführt werden muss
export function minTipY(cue, aim, balls, tipX) {
  let h = -Infinity;
  for (const [t, top] of cueObstacles(cue, aim, balls, tipX)) {
    h = Math.max(h, top + SHAFT_R0 + SHAFT_TAPER * t - t * MAX_ELEV_TAN);
  }
  return Math.min(TIP_TOP_LIMIT, h / R - 1);
}

// Queue-Anhebung (rad), die für den gewählten Treffpunkt nötig ist (für die Darstellung)
export function cueElevation(cue, aim, tipY, base = 0.07, balls, tipX) {
  const hTip = R * (1 + tipY);
  let e = base;
  for (const [t, top] of cueObstacles(cue, aim, balls, tipX)) {
    e = Math.max(e, Math.atan2(top + SHAFT_R0 + SHAFT_TAPER * t - hTip, t));
  }
  return Math.min(e, 1.0);
}
