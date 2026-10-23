// Computergegner: sucht Lochversuche (mit Positionsspiel) und Safeties, indem er Kandidaten-Stöße
// mit der echten Physik vorausberechnet und das Ergebnis nach den Regeln bewertet.
// Die Spielstärke steuert Suchbreite, Positionsspiel und die Streuung bei der Ausführung.
import { BALL_R as R, BAULK_Z, D_RADIUS, PHYS, TABLE_L } from './constants.js';
import { cloneBalls, strike, step, anyMoving } from './physics.js';
import { respot, minTipY, isSnookered, isFree, inD, rackBalls } from './table.js';
import { evaluatePot, refineAim, TARGETS } from './planner.js';

export const AI_LEVELS = {
  // aimNoise: zufällige Winkelungenauigkeit (rad) bei der Ausführung. selfSigma: wie der Computer seine
  // eigene Streuung einschätzt (Leicht überschätzt sich). posWeight: Gewicht des Positionsspiels.
  // tips: Treffpunkte [seitlich, vertikal]. robust: so viele der besten Varianten werden zusätzlich mit
  // leicht abweichender Stärke und Richtung geprüft (Positionen, die auch bei kleinen Fehlern halten).
  easy: {
    label: 'Leicht', potCands: 3, powers: [0.42], tips: [[0, 0]], posWeight: 0, robust: 0,
    safetyBalls: 1, safetyOffsets: [0], safetyPowers: [0.3],
    aimNoise: 0.0034, selfSigma: 0.0015, powerNoise: 0.1, place: false,
  },
  medium: {
    label: 'Mittel', potCands: 5, powers: [0.28, 0.4, 0.55], tips: [[0, -0.3], [0, 0], [0, 0.3]], posWeight: 0.8, robust: 4,
    safetyBalls: 4, safetyOffsets: [-0.8, 0, 0.8], safetyPowers: [0.22, 0.38],
    aimNoise: 0.0016, selfSigma: 0.0012, powerNoise: 0.05, place: true,
  },
  hard: {
    label: 'Schwer', potCands: 5, powers: [0.22, 0.3, 0.38, 0.48, 0.62],
    tips: [[0, -0.45], [0, -0.15], [0, 0.15], [0, 0.45], [0.3, 0], [-0.3, 0]], posWeight: 1.2, robust: 8,
    safetyBalls: 6, safetyOffsets: [-0.9, -0.6, 0, 0.6, 0.9], safetyPowers: [0.18, 0.28, 0.42],
    aimNoise: 0.00085, selfSigma: 0.0007, powerNoise: 0.03, place: true,
  },
};

const MAX_SIM_STEPS = 30000;

function cloneFrame(frame) {
  const f = Object.assign(Object.create(Object.getPrototypeOf(frame)), frame);
  f.scores = [...frame.scores];
  f.highBreak = [...frame.highBreak];
  return f;
}

// Kugeln, die der Spieler am Tisch anspielen darf (inkl. Freier Kugel)
export function ballsOnFn(frame) {
  return b => b.onTable && b.kind !== 'cue' && (frame.isOn(b) || (frame.freeBall && b.kind === 'colour'));
}

// Alle direkten Lochversuche von der aktuellen Weißen-Position, leichteste zuerst
function potCandidates(cue, balls, isOn) {
  const list = [];
  for (const obj of balls) {
    if (!isOn(obj)) continue;
    for (const t of TARGETS) {
      const r = evaluatePot(cue, obj, t, balls);
      if (r) list.push({ ...r, obj });
    }
  }
  return list.sort((a, b) => b.ease - a.ease);
}

function bestEase(cue, balls, isOn) {
  if (!cue.onTable) return 0;
  const c = potCandidates(cue, balls, isOn);
  return c.length ? c[0].ease : 0;
}

// Fehlerfunktion (Abramowitz/Stegun 7.1.26)
function erf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

// Trefferwahrscheinlichkeit eines Lochversuchs bei gegebener Zielstreuung (rad):
// Toleranz der Tasche gegen die Auswirkung des Zielfehlers auf die Laufrichtung der Objektkugel
function potProb(c, sigma) {
  const corner = c.target.ax !== 0 && c.target.az !== 0;
  const half = (corner ? 0.021 : 0.03) * (0.6 + 0.4 * Math.cos(c.entry));
  const tol = half / Math.max(0.05, c.dOP);
  const k = c.dCG / (2 * R) / Math.max(0.25, Math.cos(c.cut));
  const so = k * sigma + 0.002;
  return erf(tol / (so * Math.SQRT2));
}

// Wert der besten nächsten Kugel aus Sicht des Spielers am Tisch (in Punkten, inkl. Fortsetzung)
function nextValue(cue, balls, frame, sigma) {
  if (!cue.onTable) return 0;
  let best = 0;
  for (const c of potCandidates(cue, balls, ballsOnFn(frame)).slice(0, 8)) {
    best = Math.max(best, potProb(c, sigma) * (c.obj.value + 4));
  }
  return best;
}

// Stoß vollständig simulieren und nach den Regeln auswerten
function simulate(balls, frame, aim, power, tipX, tipY) {
  const sim = cloneBalls(balls);
  const cue = sim[0];
  strike(cue, aim, power, tipX, tipY);
  const shot = { firstHit: null, potted: [], cuePotted: false };
  const ev = [];
  for (let i = 0; i < MAX_SIM_STEPS && anyMoving(sim); i++) {
    ev.length = 0;
    step(sim, PHYS.dt, ev);
    for (const e of ev) {
      if (e.type === 'ball' && !shot.firstHit && (e.a === cue || e.b === cue)) shot.firstHit = e.a === cue ? e.b : e.a;
      else if (e.type === 'pot') { if (e.ball === cue) shot.cuePotted = true; else shot.potted.push(e.ball); }
    }
  }
  for (const b of sim) b.vx = b.vz = b.wx = b.wy = b.wz = 0;
  const f = cloneFrame(frame);
  const out = f.evaluate(shot, sim);
  for (const b of out.respot) respot(b, sim);
  return { sim, out, f };
}

// Wie viele Snooker braucht `me` noch, um das Frame zu gewinnen? (0 = es reicht ohne Fouls des Gegners)
// Ein Snooker bringt so viele Strafpunkte wie das Foul des Gegners: mindestens 4, bei Farben deren Wert.
export function snookersNeeded(frame, balls, me) {
  const behind = frame.scores[1 - me] - frame.scores[me];
  const remaining = frame.pointsRemaining(balls);
  if (behind <= remaining) return 0; // Gleichstand reicht (Re-Black)
  const onValue = frame.on === 'red' || frame.on === 'colour' ? 4
    : Math.max(4, ({ yellow: 2, green: 3, brown: 4, blue: 5, pink: 6, black: 7 })[frame.on]);
  return Math.ceil((behind - remaining) / onValue);
}

// Bewertung eines Ergebnisses aus Sicht des Stoßenden (in Punkten)
function scoreResult(r, cfg, me) {
  const { sim, out, f } = r;
  if (out.frameOver) return f.winner === me ? 200 : -200;
  const cue = sim[0];
  if (out.foul) return -out.penalty - 4 - nextValue(cue, sim, f, cfg.selfSigma);
  if (out.points > 0) return out.points + cfg.posWeight * nextValue(cue, sim, f, cfg.selfSigma);
  // Gegner ist am Tisch: sein bester nächster Lochversuch zählt gegen uns
  const snookered = isSnookered(cue, sim, ballsOnFn(f)) ? cfg.snookerBonus : 0;
  return -nextValue(cue, sim, f, cfg.selfSigma) + snookered;
}

// Denkt über den nächsten Stoß nach. Generator: gibt nach jeder Simulation die Kontrolle ab,
// damit das Spiel flüssig bleibt. Ergebnis: { aim, power, tipX, tipY, kind, ball }
// snookerMode: der Computer braucht einen Snooker und versucht, die Weiße zu verstecken
export function* thinkShot(balls, frame, levelKey, snookerMode = false) {
  const cfg = { ...AI_LEVELS[levelKey], snookerBonus: snookerMode ? 18 : 3 };
  const cue = balls[0];
  const me = frame.current;
  const isOn = ballsOnFn(frame);
  let best = null;
  const consider = (cand) => { if (!best || cand.score > best.score) best = cand; };

  // 1) Lochversuche
  const pots = potCandidates(cue, balls, isOn).slice(0, cfg.potCands);
  const potted = (r, obj) => !r.out.foul && r.out.potted.some(b => b.id === obj.id);
  const variants = [];
  for (const p of pots) {
    const prob = potProb(p, cfg.selfSigma);
    if (prob < 0.05) continue;
    for (const [tipX, tip] of cfg.tips) {
      // Zielkorrektur (Throw, Squirt, Kurve) einmal je Treffpunkt bei mittlerer Stärke
      const tipY = Math.max(tip, minTipY(cue, p.aim, balls, tipX));
      const aim = refineAim(cue, p.obj, p.target, p.aim, { power: 0.4, tipX, tipY });
      for (const power of cfg.powers) {
        const r = simulate(balls, frame, aim, power, tipX, tipY);
        yield;
        if (!potted(r, p.obj)) continue; // Stärke reicht nicht oder Kugel verfehlt die Tasche
        const pos = scoreResult(r, cfg, me);
        // Verfehlt: der Gegner bekommt meist eine Chance
        variants.push({ aim, power, tipX, tipY, pos, prob, score: prob * pos + (1 - prob) * -6, kind: 'pot', ball: p.obj, target: p.target, ease: p.ease });
      }
    }
  }
  // Die besten Varianten mit leicht abweichender Stärke und Richtung nachprüfen: zählt, wie gut die
  // Position im Mittel ist, nicht nur bei perfekter Ausführung
  variants.sort((a, b) => b.score - a.score);
  for (const v of variants.slice(0, cfg.robust)) {
    let sum = v.pos, n = 1;
    for (const s of [-1, 1]) {
      const r = simulate(balls, frame, v.aim + s * cfg.aimNoise * 0.5, v.power * (1 + s * cfg.powerNoise * 1.5), v.tipX, v.tipY);
      yield;
      sum += potted(r, v.ball) ? scoreResult(r, cfg, me) : -6;
      n++;
    }
    v.pos = sum / n;
    v.score = v.prob * v.pos + (1 - v.prob) * -6;
  }
  // Nur nachgeprüfte Varianten vergleichen (sonst gewinnt eine ungeprüfte, zu optimistische Bewertung)
  for (const v of cfg.robust ? variants.slice(0, cfg.robust) : variants) consider(v);

  // 2) Safeties: Kugeln "on" voll bis dünn anspielen, mit wenig Stärke
  const targets = balls.filter(isOn)
    .map(b => ({ b, d: Math.hypot(b.x - cue.x, b.z - cue.z) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, cfg.safetyBalls);
  for (const { b, d } of targets) {
    const base = Math.atan2(b.x - cue.x, -(b.z - cue.z));
    for (const k of cfg.safetyOffsets) {
      const aim = base + Math.asin(Math.max(-1, Math.min(1, k * 2 * R / Math.max(d, 2 * R))));
      for (const power of cfg.safetyPowers) {
        const tipY = Math.max(0, minTipY(cue, aim, balls, 0));
        const r = simulate(balls, frame, aim, power, 0, tipY);
        yield;
        consider({ aim, power, tipX: 0, tipY, score: scoreResult(r, cfg, me), kind: 'safety', ball: b });
      }
    }
  }

  if (!best) {
    // Notlösung: nächste Kugel "on" voll anspielen
    const b = targets[0]?.b || balls.find(x => x.onTable && x.kind !== 'cue');
    best = { aim: Math.atan2(b.x - cue.x, -(b.z - cue.z)), power: 0.35, tipX: 0, tipY: 0, kind: 'safety', ball: b };
  }
  return best;
}

// ---------------------------------------------------------------- Anstoß

const RACK = rackBalls();

// Anstoß: alle Roten liegen noch unberührt im Dreieck und die Weiße ist in der Hand
export function isBreakOff(balls, frame) {
  if (frame.on !== 'red' || !frame.ballInHand) return false;
  return RACK.every(r => r.kind !== 'red' || balls.some(b => b.id === r.id && b.onTable && Math.abs(b.x - r.x) < 1e-4 && Math.abs(b.z - r.z) < 1e-4));
}

// Ergebnisse je Spielstärke und Seite merken: Aufbau und Physik sind bei jedem Anstoß gleich
const breakCache = new Map();

// Klassischer Anstoß: Weiße auf der Baulk-Linie zwischen Braun und Gelb (bzw. Grün), die äußerste Rote
// der hinteren Reihe etwa halbvoll von außen anspielen, mit Effet über Kopfbande und Seitenbande zurück
// bis an die Baulk-Bande. Der Pack soll dabei möglichst geschlossen bleiben.
// Ergebnis wie thinkShot, zusätzlich place: [x, z] für die Weiße.
export function* thinkBreak(balls, frame, levelKey) {
  const cfg = { ...AI_LEVELS[levelKey], snookerBonus: 3 };
  const side = Math.random() < 0.5 ? 1 : -1; // 1 = Gelb-Seite, -1 = Grün-Seite (gespiegelt)
  const key = `${levelKey}:${side}`;
  if (breakCache.has(key)) return breakCache.get(key);
  const me = frame.current;
  const reds = balls.filter(b => b.kind === 'red' && b.onTable);
  const backZ = Math.min(...reds.map(b => b.z));
  const target = reds.filter(b => b.z < backZ + 1e-4).reduce((a, b) => (b.x * side > a.x * side ? b : a));
  const HL = TABLE_L / 2;
  // Ausgangsstellung für jede Variante: Weiße an die gewählte Stelle legen
  const setup = x => {
    const sim = cloneBalls(balls);
    Object.assign(sim[0], { x, z: BAULK_Z, onTable: true });
    return sim;
  };
  const aimFor = (x, frac) => {
    const dx = target.x - x, dz = target.z - BAULK_Z, d = Math.hypot(dx, dz);
    // frac: Versatz der Stoßlinie in Kugeldurchmessern zur Außenseite der Roten (0,5 = halbvoll)
    return Math.atan2(dx, -dz) + side * Math.asin(frac * 2 * R / d);
  };
  const rate = r => {
    const cue = r.sim[0];
    if (r.out.foul) return scoreResult(r, cfg, me) - 10;
    // Je tiefer die Weiße im Baulk-Bereich liegt, desto schwerer hat es der Gegner
    const depth = cue.onTable ? (cue.z - BAULK_Z) / (HL - BAULK_Z) : -1;
    return scoreResult(r, cfg, me) + (depth > 0 ? 3 * Math.min(1, depth) : -4 + 4 * depth);
  };
  const variants = [];
  for (const x of [0.05, 0.12, 0.2].map(v => v * side)) {
    for (const frac of [0.55, 0.6, 0.65, 0.7]) {
      for (const tipX of [-0.3, -0.45].map(v => v * side)) {
        for (const power of [0.72, 0.8, 0.88]) {
          const aim = aimFor(x, frac);
          const r = simulate(setup(x), frame, aim, power, tipX, 0);
          yield;
          variants.push({ x, aim, power, tipX, score: rate(r) });
        }
      }
    }
  }
  // Die besten Varianten auch mit kleinen Fehlern in Richtung und Stärke prüfen
  variants.sort((a, b) => b.score - a.score);
  const top = variants.slice(0, 8);
  for (const v of top) {
    let sum = v.score;
    const checks = [[-1.5, 0], [-0.5, 1], [0.5, -1], [1.5, 0]];
    for (const [da, dp] of checks) {
      const r = simulate(setup(v.x), frame, v.aim + da * cfg.aimNoise, v.power * (1 + dp * cfg.powerNoise), v.tipX, 0);
      yield;
      sum += rate(r);
    }
    v.score = sum / (checks.length + 1);
  }
  top.sort((a, b) => b.score - a.score);
  const v = top[0];
  const plan = { aim: v.aim, power: v.power, tipX: v.tipX, tipY: 0, kind: 'break', ball: target, place: [v.x, BAULK_Z] };
  breakCache.set(key, plan);
  return plan;
}

export function runSync(gen) {
  let r;
  do { r = gen.next(); } while (!r.done);
  return r.value;
}

// Ausführung mit menschlicher Ungenauigkeit je nach Spielstärke
export function withNoise(plan, levelKey) {
  const cfg = AI_LEVELS[levelKey];
  const gauss = () => {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return {
    ...plan,
    aim: plan.aim + gauss() * cfg.aimNoise,
    power: Math.max(0.05, Math.min(1, plan.power * (1 + gauss() * cfg.powerNoise))),
  };
}

// Ball in Hand: Position im D mit dem leichtesten Lochversuch wählen
export function choosePlacement(balls, frame, levelKey) {
  const cfg = AI_LEVELS[levelKey];
  const cue = balls[0];
  const isOn = ballsOnFn(frame);
  const fallback = [D_RADIUS / 2, BAULK_Z];
  const candidates = [fallback];
  if (cfg.place) {
    for (let x = -D_RADIUS; x <= D_RADIUS; x += 0.06) candidates.push([x, BAULK_Z]);
    for (const r of [0.08, 0.16, 0.24]) {
      for (let a = 0.2; a < Math.PI; a += 0.35) candidates.push([r * Math.cos(a), BAULK_Z + r * Math.sin(a)]);
    }
  }
  let best = null;
  const probe = { ...cue, onTable: true };
  for (const [x, z] of candidates) {
    if (!inD(x, z) || !isFree(balls, x, z, cue)) continue;
    probe.x = x; probe.z = z;
    const ease = bestEase(probe, balls.map(b => (b === cue ? probe : b)), isOn);
    if (!best || ease > best.ease) best = { x, z, ease };
  }
  return best ? [best.x, best.z] : fallback;
}
