// Kugelphysik: Gleiten/Rollen mit Spin, Kugel-Kugel-Stöße mit Reibung (Throw),
// Bandenstöße mit erhöhter Bandennase, Taschen mit Backen.
import { BALL_R as R, TABLE_L, TABLE_W, CORNER_MOUTH, MIDDLE_MOUTH, PHYS } from './constants.js';

const HW = TABLE_W / 2, HL = TABLE_L / 2;
const R2 = R * R;

// Bandennase als Polylinien (eine pro Bande, von Taschenbacke zu Taschenbacke).
// Gerundete Einläufe ("Knuckles") gehen tangential in die Backen über – wie am echten Tisch.
export const CUSHION_PATHS = [];
export const SEGMENTS = [];  // Bandenkanten als Liniensegmente (Kapsel-Kollision)
export const POCKETS = [];   // Fallkreise (x, z, r) und sichtbare Tasche (hx, hz, hr)

const CORNER_KNUCKLE = 0.06, CORNER_JAW = 0.065;
const MIDDLE_KNUCKLE = 0.045, MIDDLE_JAW = 0.05, MIDDLE_TURN = 85 * Math.PI / 180;

function arc(cu, cv, r, a0, a1, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * i / n;
    pts.push([cu + r * Math.cos(a), cv + r * Math.sin(a)]);
  }
  return pts;
}

// Ecktasche, kanonisch: Bande auf v = V läuft in +u Richtung zur Ecke (U, V).
// Rundung 45° nach außen, dann gerade Backe parallel zur Taschenachse.
function cornerJaw(U, V) {
  const rk = CORNER_KNUCKLE;
  const uk = U - CORNER_MOUTH / Math.SQRT2 - (Math.SQRT2 - 1) * rk;
  const pts = arc(uk, V + rk, rk, -Math.PI / 2, -Math.PI / 4, 12);
  const [eu, ev] = pts[pts.length - 1];
  pts.push([eu + CORNER_JAW * Math.SQRT1_2, ev + CORNER_JAW * Math.SQRT1_2]);
  return pts;
}

// Mitteltasche, kanonisch: Bande auf v = V läuft in -u Richtung zur Mitte (u = 0).
// Große Rundung (85°) nach außen, Backe verengt sich leicht.
function middleJaw(V) {
  const rm = MIDDLE_KNUCKLE;
  const uk = MIDDLE_MOUTH / 2 + Math.sin(MIDDLE_TURN) * rm;
  const pts = arc(uk, V + rm, rm, -Math.PI / 2, -Math.PI / 2 - MIDDLE_TURN, 10);
  const [eu, ev] = pts[pts.length - 1];
  const a = -Math.PI / 2 - MIDDLE_TURN;
  pts.push([eu + Math.sin(a) * MIDDLE_JAW, ev - Math.cos(a) * MIDDLE_JAW]);
  return pts;
}

function addPath(pts) {
  CUSHION_PATHS.push(pts);
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const ex = bx - ax, ez = bz - az;
    SEGMENTS.push({ ax, az, bx, bz, ex, ez, len2: ex * ex + ez * ez });
  }
}

(function buildTable() {
  // Kopf- und Baulkbande
  for (const sz of [-1, 1]) {
    const left = cornerJaw(HW, HL).map(([u, v]) => [-u, sz * v]).reverse();
    const right = cornerJaw(HW, HL).map(([u, v]) => [u, sz * v]);
    addPath([...left, ...right]);
  }
  // Seitenbanden (je zwei Hälften zwischen Ecke und Mitte)
  for (const sx of [-1, 1]) for (const h of [-1, 1]) {
    const mid = middleJaw(HW).map(([u, v]) => [sx * v, h * u]).reverse();
    const corner = cornerJaw(HL, HW).map(([u, v]) => [sx * v, h * u]);
    addPath([...mid, ...corner]);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    POCKETS.push({ x: sx * (HW + 0.015), z: sz * (HL + 0.015), r: 0.052, corner: true,
      hx: sx * (HW + 0.03), hz: sz * (HL + 0.03), hr: 0.065, ax: sx, az: sz });
  }
  for (const sx of [-1, 1]) {
    POCKETS.push({ x: sx * (HW + 0.06), z: 0, r: 0.045, corner: false,
      hx: sx * (HW + 0.07), hz: 0, hr: 0.058, ax: sx, az: 0 });
  }
})();

export function makeBall(id, kind, name, value, x, z) {
  return { id, kind, name, value, x, z, vx: 0, vz: 0, wx: 0, wy: 0, wz: 0, onTable: true, pocket: null };
}

export function cloneBalls(balls) {
  return balls.map(b => ({ ...b }));
}

export function isMoving(b) {
  return b.onTable && (b.vx !== 0 || b.vz !== 0 || b.wx !== 0 || b.wz !== 0);
}

export function anyMoving(balls) {
  for (const b of balls) if (isMoving(b)) return true;
  return false;
}

// Stoß des Queues. aim: Winkel (0 = Richtung Kopfbande), power 0..1,
// tipX/tipY: Treffpunkt in Kugelradien (rechts / oben positiv).
export function strike(cue, aim, power, tipX, tipY) {
  const v = Math.max(0.02, Math.pow(power, 1.4) * PHYS.maxSpeed);
  const dx = Math.sin(aim), dz = -Math.cos(aim);
  const rx = -dz, rz = dx;
  let ddx = dx - rx * tipX * PHYS.squirt, ddz = dz - rz * tipX * PHYS.squirt;
  const l = Math.hypot(ddx, ddz); ddx /= l; ddz /= l;
  cue.vx = ddx * v; cue.vz = ddz * v;
  // Drehimpuls aus exzentrischem Treffpunkt: w = 5 v b / (2 R)
  const k = 2.5 * v / R;
  cue.wx = k * tipY * ddz;
  cue.wz = -k * tipY * ddx;
  cue.wy = k * tipX;
}

function integrate(b, dt) {
  const g = PHYS.g;
  const ux = b.vx + R * b.wz, uz = b.vz - R * b.wx; // Geschwindigkeit des Auflagepunkts
  const u = Math.hypot(ux, uz);
  if (u > 1e-4) {
    // Gleiten: Reibung entgegen dem Schlupf, bis Rollbedingung erreicht ist
    const dv = PHYS.muSlide * g * dt;
    if (3.5 * dv >= u) {
      b.vx -= ux / 3.5; b.vz -= uz / 3.5;
      b.wz = -b.vx / R; b.wx = b.vz / R;
    } else {
      const dvx = -dv * ux / u, dvz = -dv * uz / u;
      b.vx += dvx; b.vz += dvz;
      b.wx -= 2.5 / R * dvz; b.wz += 2.5 / R * dvx;
    }
  } else {
    const s = Math.hypot(b.vx, b.vz);
    if (s > 0) {
      const dv = PHYS.muRoll * g * dt;
      if (s <= dv || s < 0.004) { b.vx = 0; b.vz = 0; }
      else { const k = (s - dv) / s; b.vx *= k; b.vz *= k; }
    }
    b.wz = -b.vx / R; b.wx = b.vz / R;
  }
  // Leicht angehobenes Queue + Seiteneffet: die Weiße zieht eine kleine Kurve zur Effetseite.
  // Querbeschleunigung ~ Effet; Krümmung ~ Effet / v², also bei langsamen Stößen deutlicher.
  if (b.kind === 'cue' && b.wy !== 0) {
    const s = Math.hypot(b.vx, b.vz);
    if (s > 0.02) {
      const a = PHYS.swerve * b.wy * dt / s;
      b.vx -= a * b.vz; b.vz += a * b.vx;
    }
  }
  if (b.wy !== 0) {
    const d = PHYS.spinDecel * dt;
    b.wy = Math.abs(b.wy) <= d ? 0 : b.wy - Math.sign(b.wy) * d;
  }
  b.x += b.vx * dt; b.z += b.vz * dt;
}

function collideBalls(a, b, events) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const d2 = dx * dx + dz * dz;
  if (d2 >= 4 * R2 || d2 === 0) return;
  const d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
  const ov = (2 * R - d) / 2;
  a.x -= nx * ov; a.z -= nz * ov; b.x += nx * ov; b.z += nz * ov;
  const vrel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
  if (vrel >= 0) return;
  const Jn = -(1 + PHYS.eBall) * vrel / 2;
  a.vx -= Jn * nx; a.vz -= Jn * nz; b.vx += Jn * nx; b.vz += Jn * nz;

  // Schlupf am Berührpunkt -> Throw und Effetübertragung
  const sx = (a.vx - b.vx) + R * (a.wy + b.wy) * nz;
  const sy = R * ((a.wz + b.wz) * nx - (a.wx + b.wx) * nz);
  const sz = (a.vz - b.vz) - R * (a.wy + b.wy) * nx;
  const sn = sx * nx + sz * nz;
  const tx = sx - sn * nx, ty = sy, tz = sz - sn * nz;
  const st = Math.hypot(tx, ty, tz);
  if (st > 1e-7) {
    const Jt = Math.min(PHYS.muBall * Jn, st / 7);
    const ux = tx / st, uy = ty / st, uz = tz / st;
    a.vx -= Jt * ux; a.vz -= Jt * uz; b.vx += Jt * ux; b.vz += Jt * uz;
    const k = -2.5 * Jt / R;
    const cx = -nz * uy, cy = nz * ux - nx * uz, cz = nx * uy;
    a.wx += k * cx; a.wy += k * cy; a.wz += k * cz;
    b.wx += k * cx; b.wy += k * cy; b.wz += k * cz;
  }
  events.push({ type: 'ball', a, b, speed: -vrel });
}

const NOSE_SIN = PHYS.cushionNose - 1;
const NOSE_COS = Math.sqrt(1 - NOSE_SIN * NOSE_SIN);

function collideSegment(b, s, events) {
  let t = ((b.x - s.ax) * s.ex + (b.z - s.az) * s.ez) / s.len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = s.ax + t * s.ex, cz = s.az + t * s.ez;
  const dx = b.x - cx, dz = b.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= R2 || d2 === 0) return;
  const d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
  b.x = cx + nx * R; b.z = cz + nz * R;
  const vn = b.vx * nx + b.vz * nz;
  if (vn >= 0) return;
  const e = Math.max(0.6, Math.min(0.86, 0.88 - 0.045 * -vn));
  const Jn = -(1 + e) * vn;
  b.vx += Jn * nx; b.vz += Jn * nz;

  // Bandennase liegt oberhalb des Kugelmittelpunkts: Kontaktpunkt r
  const rx = -R * NOSE_COS * nx, ry = R * NOSE_SIN, rz = -R * NOSE_COS * nz;
  const sx = b.vx + (b.wy * rz - b.wz * ry);
  const sy = b.wz * rx - b.wx * rz;
  const sz = b.vz + (b.wx * ry - b.wy * rx);
  const Nx = NOSE_COS * nx, Ny = -NOSE_SIN, Nz = NOSE_COS * nz;
  const sn = sx * Nx + sy * Ny + sz * Nz;
  const tx = sx - sn * Nx, ty = sy - sn * Ny, tz = sz - sn * Nz;
  const st = Math.hypot(tx, ty, tz);
  if (st > 1e-7) {
    const Jt = Math.min(PHYS.muCushion * Jn, st / 3.5);
    const ux = tx / st, uy = ty / st, uz = tz / st;
    b.vx -= Jt * ux; b.vz -= Jt * uz;
    const k = -2.5 * Jt / R2;
    b.wx += k * (ry * uz - rz * uy);
    b.wy += k * (rz * ux - rx * uz);
    b.wz += k * (rx * uy - ry * ux);
  }
  events.push({ type: 'cushion', ball: b, speed: -vn });
}

function checkPockets(b, events) {
  for (const p of POCKETS) {
    const dx = b.x - p.x, dz = b.z - p.z;
    if (dx * dx + dz * dz < p.r * p.r) return pot(b, p, events);
  }
  if (Math.abs(b.x) > HW + R || Math.abs(b.z) > HL + R) {
    let best = POCKETS[0], bd = Infinity;
    for (const p of POCKETS) { const d = Math.hypot(b.x - p.x, b.z - p.z); if (d < bd) { bd = d; best = p; } }
    pot(b, best, events);
  }
}

function pot(b, p, events) {
  const speed = Math.hypot(b.vx, b.vz);
  b.onTable = false; b.pocket = p;
  b.vx = b.vz = b.wx = b.wy = b.wz = 0;
  events.push({ type: 'pot', ball: b, pocket: p, speed });
}

export function step(balls, dt, events) {
  const n = balls.length;
  for (let i = 0; i < n; i++) if (balls[i].onTable) integrate(balls[i], dt);
  for (let i = 0; i < n; i++) {
    const a = balls[i];
    if (!a.onTable) continue;
    const am = a.vx !== 0 || a.vz !== 0;
    for (let j = i + 1; j < n; j++) {
      const b = balls[j];
      if (!b.onTable || (!am && b.vx === 0 && b.vz === 0)) continue;
      const dx = b.x - a.x;
      if (dx > 2 * R || dx < -2 * R) continue;
      collideBalls(a, b, events);
    }
  }
  for (let i = 0; i < n; i++) {
    const b = balls[i];
    if (!b.onTable) continue;
    if (Math.abs(b.x) < HW - R && Math.abs(b.z) < HL - R) continue;
    for (const s of SEGMENTS) collideSegment(b, s, events);
    checkPockets(b, events);
  }
}

// Ruhende Kugeln: Restdrall um die Hochachse verwerfen
export function settle(balls) {
  for (const b of balls) { b.vx = b.vz = b.wx = b.wy = b.wz = 0; }
}
