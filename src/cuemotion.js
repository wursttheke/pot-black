// Darstellung der Queue-Bewegung beim Stoß: Ausholen, Zustoßen, Durchschwingen und Anheben, wenn
// eine Kugel auf das liegende Queue zurollt. Nur Optik – Zeitpunkt und Physik des Stoßes bleiben gleich.
import { BALL_R as R } from './constants.js';

const REST = 0.012;          // Abstand der Spitze zur Kugel in Ruhe
const HOLD_T = 0.5;          // kurze Pause zwischen Ausholen und Zustoßen
const FOLLOW = 0.05;         // so weit läuft das Queue nach dem Treffen weiter
const CUE_LEN = 1.47;

const smooth = t => t * t * (3 - 2 * t);

// Ausholen: Weg und Dauer wachsen mit der Stärke (leicht: kurz und zügig, voll: weit und ruhig)
const backDist = power => 0.03 + power * 0.17;
const backT = power => 0.4 + power * 0.37;
// Vorschwung: Dauer (kräftige Stöße sind schneller) und Verlauf Weg ~ f^FWD_EXP, also eine immer
// stärkere Beschleunigung bis zum Treffen – aber mit einem Endtempo, bei dem das Abbremsen danach
// noch sichtbar ist
const FWD_EXP = 2.5;
const forwardT = power => 0.2 - power * 0.08;
const hitSpeed = power => FWD_EXP * (REST + backDist(power)) / forwardT(power);

// Zeit vom Beginn des Ausholens bis zum Treffpunkt
export function strokeDuration(power) {
  return backT(power) + HOLD_T + forwardT(power);
}

// Abstand Spitze -> Kugel t Sekunden nach Beginn des Ausholens; hit = Kugel wird jetzt getroffen.
// Ausholen weich an- und auslaufend, kurzes Verharren, dann ein Vorschwung, der immer stärker
// beschleunigt bis zum Treffpunkt.
export function strokePull(t, power) {
  const back = backDist(power), T1 = backT(power);
  if (t < T1) return { pull: REST + back * smooth(Math.max(0, t) / T1), hit: false };
  if (t < T1 + HOLD_T) return { pull: REST + back, hit: false };
  const f = Math.min(1, (t - T1 - HOLD_T) / forwardT(power));
  return { pull: (REST + back) * (1 - f ** FWD_EXP), hit: f >= 1 };
}

// Durchschwingen nach dem Treffen (negativer Abstand: die Spitze geht durch die Kugelposition):
// startet mit dem Tempo des Treffmoments und bremst gleichmäßig über FOLLOW ab, dann bleibt das
// Queue liegen
export function followThrough(t, power) {
  const T = 2 * FOLLOW / hitSpeed(power), f = Math.min(1, t / T);
  return -FOLLOW * (1 - (1 - f) * (1 - f));
}

// Rollt eine Kugel auf das liegende Queue zu (oder liegt schon darunter)? pos: Stoßposition der Weißen,
// elev/tipY: Neigung und Treffhöhe des Queues (über Kugeln, die tiefer liegen, ist es ohnehin hoch genug).
// state merkt sich Kugeln, die beim Stoß schon ruhig unter dem Queue lagen: die hat das Zielen bereits
// berücksichtigt, sie lösen erst etwas aus, wenn sie sich bewegen.
export function ballNearCue(balls, pos, aim, pull, elev = 0.07, tipY = 0, state = {}) {
  const dx = Math.sin(aim), dz = -Math.cos(aim);
  const tx = pos.x - dx * (R + pull), tz = pos.z - dz * (R + pull);
  const tipH = R + tipY * R;
  // Nah am Queue (Strecke von der Spitze bis zum Griff, in der Draufsicht)? Rollende Kugeln zählen
  // nur, wenn sie darauf zu unterwegs sind (die Weiße direkt nach dem Stoß entfernt sich), ruhende
  // immer – etwa die Weiße, die nach einem Rückläufer unter dem Queue liegen bleibt.
  const near = (x, z, vx, vz) => {
    const along = -((x - tx) * dx + (z - tz) * dz); // > 0: hinter der Spitze, also unter dem Queue
    const s = Math.max(0, Math.min(CUE_LEN, along));
    const shaftR = 0.005 + s * 0.0045;
    if (tipH + s * Math.tan(elev) - shaftR > 2 * R + 0.004) return false; // Queue liegt dort über der Kugel
    const qx = tx - dx * s - x, qz = tz - dz * s - z, dist = Math.hypot(qx, qz);
    if (dist >= R + shaftR + 0.025) return false;
    // Direkt unter dem Queue: immer; daneben nur ruhend oder darauf zu rollend
    return (along > 0 && dist < R) || (vx === 0 && vz === 0) || qx * vx + qz * vz > 0;
  };
  const still = b => b.vx === 0 && b.vz === 0;
  if (!state.ignore) state.ignore = new Set(balls.filter(b => b.onTable && still(b) && near(b.x, b.z, 0, 0)).map(b => b.id));
  for (const b of balls) {
    if (!b.onTable || (still(b) && state.ignore.has(b.id))) continue;
    if (near(b.x, b.z, b.vx, b.vz) || near(b.x + b.vx * 0.35, b.z + b.vz * 0.35, b.vx, b.vz)) return true;
  }
  return false;
}

// Anheben weich nachführen: hält kurz, nachdem die Gefahr vorbei ist, und senkt dann wieder ab
export function updateLift(state, danger, dt) {
  state.hold = danger ? 0.6 : (state.hold || 0) - dt;
  const target = state.hold > 0 ? 1 : 0;
  state.lift = (state.lift || 0) + (target - (state.lift || 0)) * (1 - Math.exp(-dt * 8));
  return smooth(Math.min(1, Math.max(0, state.lift)));
}
