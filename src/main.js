// Spielsteuerung: Eingabe, Kamera, Ablauf, HUD, Vorschau.
import * as THREE from 'three';
import { View } from './render.js';
import { Sfx } from './audio.js';
import { BALL_R as R, BAULK_Z, PHYS, MAX_TIP, TABLE_L, TABLE_W, CUSHION_WIDTH, RAIL_WIDTH } from './constants.js';
import { cloneBalls, strike, step, anyMoving, settle, POCKETS } from './physics.js';
import { rackBalls, respot, freeSpotInD, isSnookered, minTipY, cueElevation } from './table.js';
import { Frame, ballLabel } from './rules.js';
import { planNextShot } from './planner.js';
import { Celebration, celebrationFor } from './celebrate.js';
import { AI_LEVELS, thinkShot, withNoise, choosePlacement } from './ai.js';
import { Attract } from './attract.js';
import { Net } from './net.js';

const $ = id => document.getElementById(id);
const view = new View($('app'));
const sfx = new Sfx();
const fx = new Celebration(sfx);
const net = new Net();
const canvas = view.canvas;

const LINE_MODES = ['aus', 'kurz', 'voll'];
const st = {
  mode: 'menu', aim: 0, power: 0.35, tipX: 0, tipY: 0, wantX: 0, wantY: 0, minTipY: -MAX_TIP, elev: 0.07,
  camMode: 'fp', prevCam: 'fp', lines: 2, ghosts: true, camH: 0.16,
  shotCam: null, predDirty: true, predAt: 0,
  shotT: 0, shot: null, simAcc: 0, strikePos: null, moveT: 0, travel: null,
  frames: [0, 0], names: ['Spieler 1', 'Spieler 2'], starter: 0,
  vsAi: true, aiLevel: 'medium', aiPlayer: 1, aiBusy: false, aiToken: 0, aiShootAt: 0,
  menuMode: 'ai', online: null, remoteShot: false, netQueue: [], aimSentAt: 0, lastAimMsg: '',
};
let balls = [], cue = null, frame = null;

// ---------------------------------------------------------------- Ablauf

function newFrame() {
  balls = rackBalls();
  cue = balls[0];
  view.setBalls(balls);
  frame = new Frame(st.names, st.starter);
  st.starter = 1 - st.starter;
  st.tipX = st.tipY = st.wantX = st.wantY = 0;
  hideOverlay();
  st.aiBusy = false; st.aiToken++;
  startPlacing();
  aimAtPoint(0.03, balls[1].z);
  toast(inputLocked() ? `${st.names[frame.current]} hat Anstoß` : `${st.names[frame.current]} hat Anstoß – Weiße im D platzieren`);
  maybeStartAi();
}

function startPlacing() {
  st.mode = 'place';
  const p = freeSpotInD(balls, cue, cue.onTable ? cue.x : 0.1, cue.onTable ? cue.z : BAULK_Z);
  Object.assign(cue, { x: p[0], z: p[1], onTable: true, pocket: null });
  if (st.camMode !== 'top') { st.prevCam = st.camMode; st.camMode = 'top'; }
  view.dArea.visible = true;
  st.predDirty = true;
  updateHud();
}

function confirmPlacement() {
  view.dArea.visible = false;
  st.mode = 'aim';
  st.camMode = st.prevCam;
  st.predDirty = true;
  updateHud();
}

function aimAtPoint(x, z) {
  st.aim = Math.atan2(x - cue.x, -(z - cue.z));
  st.predDirty = true;
}

function shoot() {
  if (st.mode !== 'aim') return;
  st.aiBusy = false;
  if (st.travel) { st.aim = st.travel.to; st.travel = null; }
  st.mode = 'shooting';
  st.shotT = 0;
  // Beginn einer Aufnahme: Kugeln auf dem Tisch merken (für die Clearance-Erkennung)
  if (frame.breakPts === 0) st.visitStart = balls.filter(b => b.onTable && b.kind !== 'cue').length;
  st.shotCam = { pos: view.camera.position.clone(), look: camLook.clone(), up: view.camera.up.clone() };
  st.strikePos = { x: cue.x, z: cue.z };
  st.broadcast = broadcastActive() ? planBroadcast() : null;
  if (st.online && !st.remoteShot) {
    net.send({ type: 'shot', aim: st.aim, power: st.power, tipX: st.tipX, tipY: st.tipY, x: cue.x, z: cue.z });
  }
  updateHud();
}

function doStrike() {
  strike(cue, st.aim, st.power, st.tipX, st.tipY);
  sfx.cue(st.power);
  st.shot = { firstHit: null, potted: [], cuePotted: false };
  st.mode = 'moving';
  st.moveT = 0;
  st.watchActive = false;
  st.simAcc = 0;
  view.setPrediction(null);
}

function handleEvents(events) {
  for (const e of events) {
    if (e.type === 'ball') {
      if (!st.shot.firstHit && (e.a === cue || e.b === cue)) st.shot.firstHit = e.a === cue ? e.b : e.a;
      sfx.ball(e.speed / 3);
    } else if (e.type === 'pot') {
      if (e.ball === cue) st.shot.cuePotted = true;
      else st.shot.potted.push(e.ball);
      sfx.pocket();
    }
  }
}

function endOfShot() {
  settle(balls);
  st.camTransition = true; // Linien erst zeigen, wenn die Kamera angekommen ist
  setTip(0, 0);
  if (st.remoteShot) {
    // Stoß eines anderen Spielers: auf dessen verbindliches Ergebnis warten
    st.remoteShot = false;
    st.mode = 'waiting';
    updateHud();
    return;
  }
  const prevBreak = frame.breakPts, shooter = frame.current;
  const out = frame.evaluate(st.shot, balls);
  const celebration = celebrationFor(out, prevBreak, st.visitStart, frame.names[shooter]);
  for (const b of out.respot.sort((a, b) => b.value - a.value)) respot(b, balls);
  if (out.reBlack) {
    const black = balls.find(b => b.name === 'black');
    black.onTable = false;
    respot(black, balls);
  }
  if (out.foul && !out.frameOver && !frame.ballInHand) frame.freeBall = isSnookered(cue, balls, b => frame.isOn(b));
  if (out.frameOver) st.frames[frame.winner]++;
  if (st.online) {
    net.send({ type: 'result', snapshot: makeSnapshot('result'), out: outSummary(out), celebration });
  }
  presentOutcome(out, celebration);
}

// Ergebnis eines Stoßes anzeigen und den Spielablauf fortsetzen (lokal wie online)
function presentOutcome(out, celebration) {
  if (celebration) playCelebration(celebration.level, celebration.title, celebration.subtitle);
  const celebrated = celebration ? celebration.level : 0;
  const msgs = [...out.messages];
  if (out.frameOver) {
    toast(msgs.join(' · '));
    st.mode = 'over';
    updateHud();
    const spectator = st.online && st.online.seat == null;
    // Bei einer Feier den Dialog etwas später zeigen, damit die Animation sichtbar bleibt
    setTimeout(() => showOverlay('Frame beendet',
      `<p><b>${frame.names[frame.winner]}</b> gewinnt das Frame ${frame.scores[0]} : ${frame.scores[1]}.</p>
       <p>Höchstes Break: ${frame.names[0]} ${frame.highBreak[0]} · ${frame.names[1]} ${frame.highBreak[1]}</p>
       <p>Frames: ${st.frames[0]} : ${st.frames[1]}</p>
       ${spectator ? '<p class="sub">Warte auf das nächste Frame…</p>' : ''}`,
      spectator ? [['Spiel verlassen', confirmLeave]] : [['Nächstes Frame', requestNewFrame], ['Spiel verlassen', confirmLeave]]), celebrated ? 3500 : 0);
    return;
  }
  if (out.foul) {
    toast(msgs.join(' · '));
    if (st.online && (st.online.seat == null || st.online.seat === out.offender)) {
      // Online entscheidet der Gegner des Verursachers in seinem Browser
      st.mode = 'decision';
      updateHud();
      showOverlay('Foul', `<p>${out.reasons.map(r => r[0].toUpperCase() + r.slice(1)).join('<br>')}</p>
        <p><b>${out.penalty} Punkte</b> für ${frame.names[1 - out.offender]}.</p>
        <p class="sub">Warte auf die Entscheidung von ${frame.names[1 - out.offender]}…</p>`, []);
      return;
    }
    if (st.vsAi && 1 - out.offender === st.aiPlayer) {
      // Der Computer entscheidet nach einem Foul des Menschen: er spielt selbst
      proceedTurn();
      return;
    }
    const off = frame.names[out.offender], nxt = frame.names[1 - out.offender];
    st.mode = 'decision';
    updateHud();
    showOverlay('Foul',
      `<p>${out.reasons.map(r => r[0].toUpperCase() + r.slice(1)).join('<br>')}</p>
       <p><b>${out.penalty} Punkte</b> für ${nxt}.</p>
       ${frame.freeBall ? '<p class="fb">Freie Kugel! Jede Kugel darf als Kugel „on“ gespielt werden.</p>' : ''}
       ${frame.ballInHand ? '<p>Ball in Hand: die Weiße wird im D platziert.</p>' : ''}
       <p>${nxt}, wie möchtest du fortfahren?</p>`,
      [[`${nxt} spielt`, () => decide(false)],
       [`${off} muss erneut spielen`, () => decide(true)]]);
    return;
  }
  proceedTurn();
  // Nach erfolgreichem Lochen: Blick auf die sinnvollste nächste Kugel schwenken
  if (out.points > 0 && st.mode === 'aim' && !inputLocked()) {
    const hint = suggestNextShot();
    if (hint) msgs.push(hint);
  }
  if (msgs.length) toast(msgs.join(' · '));
}

function suggestNextShot() {
  const plan = planNextShot(cue, balls, b => frame.isOn(b), { power: st.power, tipX: 0, tipY: 0 });
  if (!plan) return null;
  const from = st.aim;
  const to = from + Math.atan2(Math.sin(plan.aim - from), Math.cos(plan.aim - from));
  st.travel = { from, to, t: 0, dur: 1.6 };
  view.setPrediction(null);
  return plan.pottable
    ? `Nächste: ${ballLabel(plan.ball)} → ${plan.target.name}`
    : `Nächste: ${ballLabel(plan.ball)} (kein direkter Lochversuch)`;
}

// Entscheidung nach einem Foul: selbst spielen oder den Verursacher erneut spielen lassen
function decide(putBack) {
  if (st.online) net.send({ type: 'decision', putBack });
  applyDecision(putBack);
}
function applyDecision(putBack) {
  if (putBack) frame.putBack();
  hideOverlay();
  proceedTurn();
}

function requestNewFrame() {
  if (st.mode !== 'over') return; // schon gestartet (z. B. vom Gegner)
  if (st.online) net.send({ type: 'newFrame' });
  newFrame();
  if (st.online) sendState();
}

function playCelebration(level, title, subtitle) {
  fx.play(level, title, subtitle);
}

function proceedTurn() {
  if (frame.ballInHand) startPlacing();
  else { st.mode = 'aim'; }
  st.predDirty = true;
  updateHud();
  maybeStartAi();
}

// ---------------------------------------------------------------- Computergegner

function isAiTurn() {
  return st.vsAi && !st.online && frame && !frame.over && frame.current === st.aiPlayer;
}

// Darf der Mensch an diesem Gerät gerade nicht spielen? (Computer am Zug, Online-Gegner am Zug, Zuschauer)
function inputLocked() {
  if (isAiTurn()) return true;
  if (!st.online) return false;
  return st.online.seat == null || !frame || frame.current !== st.online.seat;
}

function maybeStartAi() {
  if (!isAiTurn()) {
    // Eigene Stoßstärke des Menschen nach dem Computerzug wiederherstellen
    if (st.humanPower != null) { st.power = st.humanPower; st.humanPower = null; updateHud(); }
    return;
  }
  if (st.aiBusy || (st.mode !== 'aim' && st.mode !== 'place')) return;
  if (st.humanPower == null) st.humanPower = st.power;
  st.aiBusy = true;
  const token = ++st.aiToken;
  updateHud();
  setTimeout(() => { if (token === st.aiToken) runAi(token); }, 700);
}

function runAi(token) {
  if (st.mode === 'place') {
    const [x, z] = choosePlacement(balls, frame, st.aiLevel);
    Object.assign(cue, { x, z });
    confirmPlacement();
  }
  // Nachdenken in kleinen Häppchen, damit Darstellung und Kamera flüssig bleiben
  const gen = thinkShot(balls, frame, st.aiLevel);
  const pump = () => {
    if (token !== st.aiToken) return;
    const t0 = performance.now();
    while (performance.now() - t0 < 10) {
      const r = gen.next();
      if (r.done) { executeAi(r.value); return; }
    }
    setTimeout(pump, 0);
  };
  pump();
}

function executeAi(plan) {
  const p = withNoise(plan, st.aiLevel);
  st.power = p.power;
  setTip(p.tipX, p.tipY);
  const from = st.aim;
  const to = from + Math.atan2(Math.sin(p.aim - from), Math.cos(p.aim - from));
  st.travel = { from, to, t: 0, dur: 1.4 };
  st.aiShootAt = performance.now() + 1400 + 900;
  updateHud();
}

// ---------------------------------------------------------------- Online

function makeSnapshot(kind) {
  return {
    kind,
    balls: balls.map(b => ({ id: b.id, x: b.x, z: b.z, onTable: b.onTable })),
    frame: {
      names: frame.names, scores: frame.scores, current: frame.current, on: frame.on, breakPts: frame.breakPts,
      highBreak: frame.highBreak, freeBall: frame.freeBall, ballInHand: frame.ballInHand,
      over: frame.over, winner: frame.winner, reBlack: frame.reBlack,
    },
    frames: st.frames, starter: st.starter, mode: st.mode,
  };
}

function outSummary(out) {
  const { foul, reasons, penalty, points, offender, messages, frameOver, reBlack } = out;
  return { foul, reasons, penalty, points, offender, messages, frameOver, reBlack };
}

function sendState() {
  net.send({ type: 'state', snapshot: makeSnapshot('state') });
}

// Verbindlichen Spielstand übernehmen
function applySnapshot(snap) {
  if (!balls.length || balls.length !== snap.balls.length || balls === attract.balls) {
    balls = rackBalls();
    cue = balls[0];
    view.setBalls(balls);
  }
  for (const s of snap.balls) {
    const b = balls.find(x => x.id === s.id);
    if (!b) continue;
    if (b.onTable && !s.onTable && b.pocket) { b.onTable = false; continue; } // läuft gerade in die Tasche
    Object.assign(b, { x: s.x, z: s.z, onTable: s.onTable, vx: 0, vz: 0, wx: 0, wy: 0, wz: 0 });
    if (s.onTable) b.pocket = null;
  }
  frame = Object.assign(new Frame(snap.frame.names), structuredClone(snap.frame));
  st.names = [...snap.frame.names];
  st.frames = [...snap.frames];
  st.starter = snap.starter;
}

function applyResult(msg) {
  applySnapshot(msg.snapshot);
  presentOutcome(msg.out, msg.celebration);
}

// Online-Spiel betreten (als Spieler oder Zuschauer)
function enterOnlineGame(names, seat, gameId) {
  st.online = { gameId, seat };
  st.vsAi = false;
  st.netQueue = [];
  st.names = [...names];
  st.frames = [0, 0];
  st.starter = 0;
  st.remoteShot = false;
  $('menu').classList.add('hidden');
  $('hud').classList.remove('hidden');
  setHelp(initialHelp());
  hideOverlay();
}

// Eingehende Spielnachrichten der Reihe nach abarbeiten, sobald der lokale Zustand dazu passt
function processNet() {
  while (st.online && st.netQueue.length) {
    const m = st.netQueue[0];
    if (m.type === 'aim') {
      st.netQueue.shift();
      if (inputLocked() && (st.mode === 'aim' || st.mode === 'place')) {
        if (st.mode === 'place') Object.assign(cue, { x: m.x, z: m.z });
        st.aim = m.aim; st.power = m.power; st.wantX = m.tipX; st.wantY = m.tipY;
        st.predDirty = true;
        drawSpin(); updateHud();
      }
      continue;
    }
    if (m.type === 'shot') {
      if (st.mode !== 'aim' && st.mode !== 'place') return;
      st.netQueue.shift();
      if (st.mode === 'place') confirmPlacement();
      Object.assign(cue, { x: m.x, z: m.z });
      st.aim = m.aim; st.power = m.power;
      st.wantX = st.tipX = m.tipX; st.wantY = st.tipY = m.tipY;
      st.travel = null;
      st.remoteShot = true;
      shoot();
      continue;
    }
    if (m.type === 'result') {
      if (st.mode === 'shooting' || st.mode === 'moving') return;
      st.netQueue.shift();
      applyResult(m);
      continue;
    }
    if (m.type === 'decision') {
      if (st.mode !== 'decision') return;
      st.netQueue.shift();
      applyDecision(m.putBack);
      continue;
    }
    if (m.type === 'newFrame') {
      if (st.mode === 'shooting' || st.mode === 'moving') return;
      st.netQueue.shift();
      if (st.mode === 'over') newFrame(); // beide haben gleichzeitig geklickt: nur einmal starten
      continue;
    }
    if (m.type === 'state') {
      st.netQueue.shift();
      if (st.mode !== 'shooting' && st.mode !== 'moving') applySnapshot(m.snapshot);
      continue;
    }
    st.netQueue.shift();
  }
}

// Eigene Zielbewegung für Gegner und Zuschauer (gedrosselt)
function sendAim(now) {
  if (!st.online || inputLocked() || (st.mode !== 'aim' && st.mode !== 'place') || now - st.aimSentAt < 90) return;
  const m = { type: 'aim', aim: st.aim, power: st.power, tipX: st.wantX, tipY: st.wantY, x: cue.x, z: cue.z, mode: st.mode };
  const key = JSON.stringify(m);
  if (key === st.lastAimMsg) return;
  st.lastAimMsg = key;
  st.aimSentAt = now;
  net.send(m);
}

for (const t of ['aim', 'shot', 'result', 'decision', 'newFrame', 'state']) {
  net.on(t, m => { if (st.online) st.netQueue.push(m); });
}
net.on('created', m => {
  st.pendingGame = m.gameId;
  showOverlay('Warte auf Gegner', '<p>Dein Spiel ist erstellt und erscheint bei anderen Spielern in der Lobby.</p><p class="sub">Sobald jemand beitritt, beginnt das Frame. Du hast Anstoß.</p>',
    [['Abbrechen', () => { net.send({ type: 'leave' }); st.pendingGame = null; hideOverlay(); }]]);
});
net.on('start', m => {
  st.pendingGame = null;
  enterOnlineGame(m.names, m.seat, m.gameId);
  newFrame();
  if (m.seat === 0) sendState();
  toast(m.seat == null ? `${m.names[0]} gegen ${m.names[1]} – das Frame beginnt` : `Online-Frame gegen ${m.names[1 - m.seat]}`);
});
net.on('watching', m => {
  enterOnlineGame(m.names, null, m.gameId);
  if (m.snapshot) {
    applySnapshot(m.snapshot);
    if (m.snapshot.mode === 'over') { st.mode = 'over'; updateHud(); }
    else if (frame.ballInHand) startPlacing();
    else { st.mode = 'aim'; updateHud(); }
  } else if (m.started) {
    newFrame();
  } else {
    showOverlay('Zuschauen', `<p>${m.names[0]} wartet noch auf einen Gegner.</p>`, [['Spiel verlassen', confirmLeave]]);
    balls = rackBalls(); cue = balls[0]; view.setBalls(balls);
    frame = new Frame([m.names[0], '…']);
    st.mode = 'over';
    updateHud();
  }
});
net.on('opponentLeft', m => {
  if (!st.online) return;
  st.online = null;
  showOverlay('Spiel beendet', `<p>${m.name} hat das Spiel verlassen.</p>`, [['Zum Menü', backToMenu]]);
  st.mode = 'over';
  updateHud();
});
net.on('error', m => { $('netStatus').textContent = m.message; });
net.on('status', m => {
  const el = $('netStatus');
  el.textContent = { connecting: 'Verbinde…', open: 'Verbunden', closed: 'Getrennt – verbinde neu…' }[m.state];
  el.classList.toggle('ok', m.state === 'open');
});
net.on('lobby', m => renderLobby(m.games));

function renderLobby(games) {
  const list = $('lobbyList');
  list.innerHTML = '';
  if (!games.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Noch keine Spiele – erstelle eins!';
    list.appendChild(li);
    return;
  }
  for (const g of games) {
    const li = document.createElement('li');
    const names = document.createElement('span');
    names.className = 'g-names';
    names.textContent = g.players.join(' vs. ');
    const state = document.createElement('span');
    state.className = 'g-state' + (g.status === 'open' ? ' open' : '');
    state.textContent = g.status === 'open' ? 'wartet' : `läuft${g.watchers ? ` · ${g.watchers} 👁` : ''}`;
    li.append(names, state);
    if (g.id === st.pendingGame) {
      const own = document.createElement('span');
      own.className = 'g-state';
      own.textContent = 'dein Spiel';
      li.append(own);
    } else {
      if (g.status === 'open') li.append(lobbyButton('Beitreten', () => net.send({ type: 'join', gameId: g.id, name: playerName() })));
      li.append(lobbyButton('Zuschauen', () => net.send({ type: 'watch', gameId: g.id })));
    }
    list.appendChild(li);
  }
}

function lobbyButton(label, fn) {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = () => { sfx.unlock(); fn(); };
  return b;
}

const playerName = () => $('n1').value.trim() || 'Spieler';

// ---------------------------------------------------------------- Navigation

function confirmLeave() {
  // Ein gerade offener Dialog (z. B. Foul-Entscheidung) wird beim Abbrechen wiederhergestellt
  const prev = $('overlay').classList.contains('hidden') ? null : st.lastOverlay;
  const player = st.online && st.online.seat != null;
  showOverlay('Spiel verlassen?',
    player ? '<p>Das Online-Spiel endet damit auch für deinen Gegner.</p>'
      : st.online ? '<p>Du verlässt das Spiel als Zuschauer.</p>' : '<p>Der aktuelle Spielstand geht verloren.</p>',
    [['Verlassen', () => { if (st.online) net.send({ type: 'leave' }); backToMenu(); }],
     ['Weiterspielen', () => (prev ? showOverlay(...prev) : hideOverlay())]]);
}

function backToMenu() {
  st.online = null;
  st.pendingGame = null;
  st.netQueue = [];
  st.remoteShot = false;
  st.aiBusy = false; st.aiToken++;
  st.travel = null;
  st.camTransition = false;
  st.camMode = 'fp';
  frame = null;
  st.mode = 'menu';
  hideOverlay();
  view.dArea.visible = false;
  view.setPrediction(null);
  $('hud').classList.add('hidden');
  $('menu').classList.remove('hidden');
  attract.next();
  if (st.menuMode === 'online') net.connect(playerName());
}

// ---------------------------------------------------------------- Vorschau

function pathLen(arr) {
  let l = 0;
  for (let i = 1; i < arr.length; i++) l += Math.hypot(arr[i][0] - arr[i - 1][0], arr[i][1] - arr[i - 1][1]);
  return l;
}

function computePrediction() {
  if ((st.lines === 0 && !st.ghosts) || (st.mode !== 'aim' && st.mode !== 'place')) return null;
  const sim = cloneBalls(balls);
  const c = sim[0];
  strike(c, st.aim, st.power, st.tipX, st.tipY);
  const full = st.lines === 2;
  const limCue = full ? 12 : 0.3, limObj = full ? 12 : 0.6, limObj2 = full ? 1.2 : 0;
  const ev = [];
  const cueBefore = [[c.x, c.z]], cueAfter = [], obj = [], obj2 = [];
  let first = null, second = null, ghost = null;
  let cueDone = false, objDone = false, obj2Done = limObj2 === 0;
  for (let i = 0; i < 18000; i++) {
    ev.length = 0;
    step(sim, PHYS.dt, ev);
    for (const e of ev) {
      if (e.type === 'ball') {
        const isCue = e.a === c || e.b === c;
        const other = e.a === c ? e.b : e.a;
        if (isCue && !first) {
          first = other; ghost = [c.x, c.z];
          cueBefore.push([c.x, c.z]); cueAfter.push([c.x, c.z]); obj.push([first.x, first.z]);
        } else if (isCue && !cueDone) {
          cueAfter.push([c.x, c.z]); cueDone = true;
        }
        if (first && !isCue && !objDone && (e.a === first || e.b === first)) {
          obj.push([first.x, first.z]); objDone = true;
          second = e.a === first ? e.b : e.a;
          obj2.push([second.x, second.z]);
        }
      } else if (e.type === 'pot') {
        if (e.ball === c) { (first ? cueAfter : cueBefore).push([c.x, c.z]); cueDone = true; }
        if (e.ball === first && !objDone) { obj.push([first.x, first.z]); objDone = true; }
        if (e.ball === second) obj2Done = true;
      }
    }
    if (i % 6 === 0) {
      if (!first) { if (c.onTable) cueBefore.push([c.x, c.z]); }
      else {
        if (!cueDone && c.onTable) { cueAfter.push([c.x, c.z]); if (pathLen(cueAfter) > limCue) cueDone = true; }
        if (!objDone && first.onTable) { obj.push([first.x, first.z]); if (pathLen(obj) > limObj) objDone = true; }
        if (second && !obj2Done && second.onTable) { obj2.push([second.x, second.z]); if (pathLen(obj2) > limObj2) obj2Done = true; }
      }
    }
    if (!anyMoving(sim)) break;
    if (first && cueDone && objDone && (!second || obj2Done)) break;
  }
  if (!first && c.onTable) cueBefore.push([c.x, c.z]);
  if (first && !cueDone && c.onTable) cueAfter.push([c.x, c.z]);
  if (first && !objDone && first.onTable) obj.push([first.x, first.z]);
  // Endposition der Weißen: weitersimulieren, bis alle Kugeln liegen
  let end = null;
  if (st.ghosts) {
    for (let i = 0; i < 40000 && c.onTable && anyMoving(sim); i++) { ev.length = 0; step(sim, PHYS.dt, ev); }
    if (c.onTable) end = [c.x, c.z];
  }
  if (!st.ghosts) ghost = null;
  if (st.lines === 0) return { cueBefore: [], cueAfter: [], obj: [], obj2: [], ghost, end };
  return { cueBefore, cueAfter, obj, obj2: second && limObj2 ? obj2 : [], ghost, end };
}

// ---------------------------------------------------------------- Kamera

const camPos = new THREE.Vector3(0, 3, 4), camLook = new THREE.Vector3(), camUp = new THREE.Vector3(0, 1, 0);
const tPos = new THREE.Vector3(), tLook = new THREE.Vector3(), tUp = new THREE.Vector3();
const tmpF = new THREE.Vector3(), tmpR = new THREE.Vector3(), Y_UP = new THREE.Vector3(0, 1, 0);

function cameraTarget() {
  const cam = view.camera;
  if (st.debugCam) { // per Konsole: snooker.st.debugCam = { pos: [x, y, z], look: [x, y, z] }
    tPos.set(...st.debugCam.pos); tLook.set(...st.debugCam.look); tUp.set(0, 1, 0);
    return;
  }
  if (broadcastActive()) {
    broadcastCam();
    return;
  }
  if (st.camMode === 'top') {
    // Tisch (inkl. Rahmen) in den freien Bildbereich zwischen den Bedienelementen einpassen
    const fit = topViewFit();
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const h = fit.wpp * innerHeight / (2 * tanHalf);
    // Bildschirm: rechts = -z, oben = -x. Kamera so verschieben, dass die Tischmitte in der Mitte des freien Bereichs liegt.
    const ox = -fit.dy * fit.wpp, oz = fit.dx * fit.wpp;
    tPos.set(ox, h, oz + 0.0001); tLook.set(ox, 0, oz); tUp.set(-1, 0, 0);
    return;
  }
  if ((st.mode === 'moving' || st.mode === 'shooting') && st.shotCam) {
    tPos.copy(st.shotCam.pos); tLook.copy(st.shotCam.look); tUp.copy(st.shotCam.up);
    if (st.mode === 'moving' && cue.onTable) followCueBall();
    return;
  }
  if (st.mode === 'menu' && st.attractCam) {
    // Vorspann: Kamera aus der Szene, mit optionaler Schräglage (Roll um die Blickachse)
    const { pos, look, roll } = st.attractCam;
    tPos.set(...pos); tLook.set(...look);
    const f = tmpF.copy(tLook).sub(tPos).normalize();
    const right = tmpR.crossVectors(f, Y_UP).normalize();
    tUp.crossVectors(right, f).multiplyScalar(Math.cos(roll)).addScaledVector(right, Math.sin(roll));
    return;
  }
  if (st.mode === 'menu' || st.mode === 'over') {
    const t = performance.now() / 1000 * 0.05;
    tPos.set(Math.sin(t) * 3.2, 1.6, Math.cos(t) * 3.6); tLook.set(0, 0, 0); tUp.set(0, 1, 0);
    return;
  }
  const dx = Math.sin(st.aim), dz = -Math.cos(st.aim);
  const lift = st.travel ? 0.45 * Math.sin(Math.PI * Math.min(1, st.travel.t / st.travel.dur)) : 0;
  let h = st.camH + lift;
  let dist = 0.38 + h * 1.1;
  // Bei angehobenem Queue (Weiße an der Bande) Augen über das Queue bringen
  const cueH = R * st.tipY + dist * Math.tan(st.elev) + 0.07;
  if (h < cueH) { h = cueH; dist = 0.38 + h * 0.6; }
  tPos.set(cue.x - dx * dist, R + h, cue.z - dz * dist);
  const ahead = 0.9 + st.camH * 0.8;
  tLook.set(cue.x + dx * ahead, 0, cue.z + dz * ahead);
  tUp.set(0, 1, 0);
}

// Freier Bildbereich für die Draufsicht: entweder ein Band zwischen oberen und unteren
// Bedienelementen oder eine Spalte zwischen linken und rechten – je nachdem, wo der Tisch größer wird.
const FRAME_W = CUSHION_WIDTH + RAIL_WIDTH; // Bande + Holzrahmen
const TABLE_HALF_X = TABLE_L / 2 + FRAME_W, TABLE_HALF_Y = TABLE_W / 2 + FRAME_W; // Bildschirm-Breite = Tischlänge
let fitCache = null, fitAt = 0;
function topViewFit() {
  const now = performance.now();
  if (fitCache && now - fitAt < 400) return fitCache;
  const W = innerWidth, H = innerHeight, pad = 10;
  const rect = id => { const e = $(id); if (!e || e.classList.contains('hidden') || !e.offsetParent && getComputedStyle(e).position !== 'fixed') return null; const r = e.getBoundingClientRect(); return r.width && r.height ? r : null; };
  const hudOn = !$('hud').classList.contains('hidden');
  const topEls = hudOn ? ['board', 'tools'].map(rect).filter(Boolean) : [];
  const bottomEls = hudOn ? ['powerBox', 'spinBox', 'status', 'btnPlace'].map(rect).filter(Boolean) : [];
  const leftEls = hudOn ? ['powerBox'].map(rect).filter(Boolean) : [];
  const rightEls = hudOn ? ['tools', 'spinBox'].map(rect).filter(Boolean) : [];
  const areas = [];
  // Band zwischen oben und unten, volle Breite
  {
    const top = Math.max(0, ...topEls.map(r => r.bottom)) + pad;
    const bottom = Math.min(H, ...bottomEls.map(r => r.top)) - pad;
    areas.push({ left: pad, right: W - pad, top, bottom });
  }
  // Spalte zwischen links und rechts, nur unter der Anzeigetafel und über der Statuszeile
  {
    const board = rect('board'), status = rect('status');
    const left = Math.max(0, ...leftEls.map(r => r.right)) + pad;
    const right = Math.min(W, ...rightEls.map(r => r.left)) - pad;
    areas.push({ left, right, top: (board ? board.bottom : 0) + pad, bottom: (status ? status.top : H) - pad });
  }
  let best = null;
  for (const a of areas) {
    const w = a.right - a.left, h = a.bottom - a.top;
    if (w <= 50 || h <= 50) continue;
    const wpp = Math.max(2 * TABLE_HALF_X / w, 2 * TABLE_HALF_Y / h);
    if (!best || wpp < best.wpp) best = { wpp, dx: (a.left + a.right) / 2 - W / 2, dy: (a.top + a.bottom) / 2 - H / 2 };
  }
  fitCache = best || { wpp: Math.max(2 * TABLE_HALF_X / W, 2 * TABLE_HALF_Y / H), dx: 0, dy: 0 };
  fitAt = now;
  return fitCache;
}

// ---------------------------------------------------------------- TV-Regie
// Wer nur zuschaut (oder gerade nicht am Zug ist), sieht das Spiel wie im Fernsehen: Hauptkamera
// erhöht hinter der Baulk-Bande; beim Stoß Schnitte auf die Tasche und danach auf die Weiße.

function broadcastActive() {
  return st.mode !== 'menu' && st.camMode !== 'top' && !st.debugCam && !!frame && inputLocked();
}

function tvMainCam() {
  // Hinter der Kopfbande (Seite mit dem Spot der Schwarzen), erhöht, Blick über den ganzen Tisch
  const cam = view.camera;
  const hHalf = Math.atan(Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * cam.aspect);
  const d = Math.max(4.0, 1.3 / Math.tan(hHalf));
  const el = 0.62; // ca. 35° über der Tischebene
  return { pos: [0, d * Math.sin(el), -0.25 - d * Math.cos(el)], look: [0, 0, -0.1] };
}

// Schnittfolge für den kommenden Stoß vorausberechnen (gleiche Physik wie die Anzeige):
// Wird eine Kugel gelocht, filmt ab dem Stoß die Taschenkamera, danach sofort wieder die Hauptkamera.
function planBroadcast() {
  const sim = cloneBalls(balls);
  const c = sim[0];
  strike(c, st.aim, st.power, st.tipX, st.tipY);
  const ev = [];
  let t = 0, pot = null;
  for (let i = 0; i < 40000 && anyMoving(sim) && !pot; i++) {
    ev.length = 0;
    step(sim, PHYS.dt, ev);
    t += PHYS.dt;
    for (const e of ev) if (e.type === 'pot' && e.ball !== c && !pot) pot = { ball: e.ball, pocket: e.pocket, t };
  }
  const main = tvMainCam();
  const cuts = [{ t: 0, cam: main }];
  if (pot) {
    // Taschenkamera: leicht erhöht hinter der Tasche, Blick auf den Weg der Kugel zur Tasche
    const start = balls.find(b => b.id === pot.ball.id);
    const p = pot.pocket;
    let dx = p.hx - start.x, dz = p.hz - start.z;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    cuts.push({ t: 0, pre: true, cam: { pos: [p.hx + dx * 0.32, 0.3, p.hz + dz * 0.32], look: [(start.x + p.hx) / 2, 0, (start.z + p.hz) / 2] } });
    cuts.push({ t: pot.t + 0.7, cam: main });
  }
  return { cuts };
}

function broadcastCam() {
  let cam = tvMainCam();
  if (st.broadcast && st.mode === 'shooting') {
    // Kurz vor dem Stoß (während des Ausholens) bereits in die Taschenkamera schneiden
    const pre = st.broadcast.cuts.find(c => c.pre);
    if (pre && st.shotT >= 0.3) cam = pre.cam;
  } else if (st.broadcast && (st.mode === 'moving' || st.mode === 'waiting')) {
    const t = st.mode === 'moving' ? st.moveT : Infinity;
    for (const c of st.broadcast.cuts) if (c.t <= t) cam = c.cam;
  }
  tPos.set(...cam.pos); tLook.set(...cam.look); tUp.set(0, 1, 0);
}

// Läuft die Weiße aus dem Bild, schwenkt die Kamera auf die Mitte zwischen ursprünglichem
// Blickpunkt und Weißer und fährt so weit zurück und nach oben, dass beide ins Bild passen.
const tmpC = new THREE.Vector3();
function followCueBall() {
  const cam = view.camera;
  const C = tmpC.set(cue.x, R, cue.z);
  if (!st.watchActive) {
    const v = C.clone().project(cam);
    if (v.z < 1 && Math.abs(v.x) < 0.8 && Math.abs(v.y) < 0.8) return;
    st.watchActive = true;
  }
  const L0 = st.shotCam.look, P0 = st.shotCam.pos;
  tLook.set((L0.x + C.x) / 2, 0, (L0.z + C.z) / 2);
  let dx = L0.x - P0.x, dz = L0.z - P0.z;
  const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
  const vHalf = THREE.MathUtils.degToRad(cam.fov / 2);
  const hHalf = Math.atan(Math.tan(vHalf) * cam.aspect);
  const half = Math.min(vHalf, hHalf) * 0.7;
  const span = Math.hypot(C.x - L0.x, C.z - L0.z) / 2 + 0.25;
  const dist = Math.max(Math.hypot(P0.x - L0.x, P0.y, P0.z - L0.z), span / Math.tan(half));
  const pitch = Math.max(Math.atan2(P0.y, dl), 0.65);
  tPos.set(tLook.x - dx * dist * Math.cos(pitch), dist * Math.sin(pitch), tLook.z - dz * dist * Math.cos(pitch));
}

function updateCamera(dt) {
  cameraTarget();
  // Harte Schnitte: im Vorspann, in der TV-Regie und beim Wechsel zwischen TV-Regie und eigener Sicht
  const tv = broadcastActive();
  const cut = (st.mode === 'menu' && st.attractCam) || tv || tv !== st.wasTv;
  st.wasTv = tv;
  const k = cut ? 1 : 1 - Math.exp(-dt * (st.travel ? 4 : st.mode === 'aim' ? 14 : 5));
  camPos.lerp(tPos, k); camLook.lerp(tLook, k); camUp.lerp(tUp, k).normalize();
  const cam = view.camera;
  cam.position.copy(camPos);
  cam.up.copy(camUp);
  cam.lookAt(camLook);
  view.lamps.visible = camPos.y < 1.05;
  if (st.camTransition && !st.travel && camPos.distanceTo(tPos) < 0.02 && camLook.distanceTo(tLook) < 0.02) st.camTransition = false;
}

// ---------------------------------------------------------------- Eingabe

let drag = null;
canvas.addEventListener('pointerdown', e => {
  sfx.unlock();
  if (e.button !== 0 || inputLocked()) return;
  drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY };
  try { canvas.setPointerCapture(e.pointerId); } catch { /* kein aktiver Zeiger */ }
});
canvas.addEventListener('pointermove', e => {
  if (st.mode === 'place') {
    if (!drag) return;
    const p = view.pickTable(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    if (p) {
      const q = freeSpotInD(balls, cue, p[0], p[1]);
      if (q) { cue.x = q[0]; cue.z = q[1]; st.predDirty = true; }
    }
    return;
  }
  if (!drag || st.mode !== 'aim') return;
  st.travel = null;
  st.camTransition = false;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  const sens = e.shiftKey ? 0.00012 : (st.camMode === 'top' ? 0.003 : 0.0018);
  st.aim += dx * sens;
  if (st.camMode === 'fp' && !e.shiftKey) st.camH = THREE.MathUtils.clamp(st.camH + dy * 0.0012, 0.045, 1.3);
  st.predDirty = true;
});
canvas.addEventListener('pointerup', e => {
  // Im Platziermodus: Ziehen verschiebt die Weiße, einfacher Klick bestätigt
  if (drag && st.mode === 'place' && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) confirmPlacement();
  drag = null;
});
canvas.addEventListener('dblclick', e => {
  if (st.mode !== 'aim' || inputLocked()) return;
  const b = view.pickBall(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  if (b && b !== cue) { st.travel = null; aimAtPoint(b.x, b.z); }
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  if (inputLocked()) return;
  setPower(st.power + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 0.05 : 0.01));
}, { passive: false });

function setPower(p) {
  st.power = THREE.MathUtils.clamp(Math.round(p * 100) / 100, 0.01, 1);
  st.predDirty = true;
  updateHud();
}
// Gewünschter Treffpunkt; der tatsächliche wird durch Bande/Rahmen hinter der Weißen begrenzt
function setTip(x, y) {
  const l = Math.hypot(x, y);
  if (l > MAX_TIP) { x *= MAX_TIP / l; y *= MAX_TIP / l; }
  st.wantX = x; st.wantY = y;
  applyTipLimit(true);
}

function applyTipLimit(force = false) {
  const min = cue && cue.onTable ? minTipY(cue, st.aim, balls, st.wantX) : -MAX_TIP;
  let x = st.wantX, y = Math.max(st.wantY, min);
  const maxX = Math.sqrt(Math.max(0, MAX_TIP * MAX_TIP - y * y));
  x = THREE.MathUtils.clamp(x, -maxX, maxX);
  const changed = Math.abs(min - st.minTipY) > 0.003 || x !== st.tipX || y !== st.tipY;
  st.minTipY = min;
  st.tipX = x; st.tipY = y;
  if (changed || force) { st.predDirty = true; drawSpin(); }
}

addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  sfx.unlock();
  const k = e.key.toLowerCase();
  // Während der Computer am Zug ist, nur Ansichts-Tasten zulassen
  if (inputLocked() && !['v', 'h', 'g', 't', 'm', 'f1', '?'].includes(k)) return;
  const aimStep = e.shiftKey ? 0.01 : e.altKey ? 0.0002 : 0.0015;
  const canAim = st.mode === 'aim';
  if (canAim && ['arrowleft', 'arrowright', 'a', 'd'].includes(k)) st.travel = null;
  if ((k === 'arrowleft' || k === 'a') && canAim) { st.aim -= aimStep; st.predDirty = true; }
  else if ((k === 'arrowright' || k === 'd') && canAim) { st.aim += aimStep; st.predDirty = true; }
  else if (k === 'arrowup' || k === 'w') setPower(st.power + (e.shiftKey ? 0.05 : 0.01));
  else if (k === 'arrowdown' || k === 's') setPower(st.power - (e.shiftKey ? 0.05 : 0.01));
  else if (k === 'i') setTip(st.tipX, st.tipY + 0.05);
  else if (k === 'k') setTip(st.tipX, st.tipY - 0.05);
  else if (k === 'j') setTip(st.tipX - 0.05, st.tipY);
  else if (k === 'l') setTip(st.tipX + 0.05, st.tipY);
  else if (k === 'x') setTip(0, 0);
  else if (k === ' ') { if (st.mode === 'place') confirmPlacement(); else shoot(); }
  else if (k === 'v') {
    if (st.mode === 'place') return;
    st.camMode = st.camMode === 'fp' ? 'top' : 'fp';
    if (st.mode === 'moving' || st.mode === 'shooting') st.shotCam = null;
    updateHud();
  }
  else if (k === 'h') { st.lines = (st.lines + 2) % 3; st.predDirty = true; updateHud(); }
  else if (k === 'g') { st.ghosts = !st.ghosts; st.predDirty = true; updateHud(); }
  else if (k === 'p' && st.mode === 'aim' && frame && frame.ballInHand) startPlacing();
  else if (k === 'f1' || k === '?' || k === 't') setHelp($('help').classList.contains('hidden'));
  else if (k === 'm') { setSound(!sfx.enabled); toast(sfx.enabled ? 'Ton an' : 'Ton aus'); }
  else return;
  e.preventDefault();
});

// Treffpunkt-Widget
const spin = $('spin'), sctx = spin.getContext('2d');
function drawSpin() {
  const s = spin.width, c = s / 2, r = s * 0.42;
  sctx.clearRect(0, 0, s, s);
  const g = sctx.createRadialGradient(c - r * 0.3, c - r * 0.35, r * 0.1, c, c, r);
  g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#c9c4b4');
  sctx.fillStyle = g;
  sctx.beginPath(); sctx.arc(c, c, r, 0, Math.PI * 2); sctx.fill();
  sctx.strokeStyle = 'rgba(0,0,0,0.25)'; sctx.lineWidth = 1;
  sctx.beginPath(); sctx.moveTo(c - r, c); sctx.lineTo(c + r, c); sctx.moveTo(c, c - r); sctx.lineTo(c, c + r); sctx.stroke();
  // Wegen der Bande nicht erreichbarer Bereich
  if (st.minTipY > -MAX_TIP) {
    const ly = c - st.minTipY * r;
    sctx.save();
    sctx.beginPath(); sctx.arc(c, c, r, 0, Math.PI * 2); sctx.clip();
    sctx.fillStyle = 'rgba(40,30,25,0.55)';
    sctx.fillRect(0, ly, s, s - ly);
    sctx.strokeStyle = 'rgba(120,60,20,0.9)'; sctx.lineWidth = 2;
    sctx.beginPath(); sctx.moveTo(0, ly); sctx.lineTo(s, ly); sctx.stroke();
    sctx.restore();
  }
  sctx.setLineDash([4, 4]); sctx.strokeStyle = 'rgba(180,0,0,0.5)';
  sctx.beginPath(); sctx.arc(c, c, r * MAX_TIP, 0, Math.PI * 2); sctx.stroke();
  sctx.setLineDash([]);
  sctx.fillStyle = '#1f6fd6';
  sctx.beginPath(); sctx.arc(c + st.tipX * r, c - st.tipY * r, s * 0.045, 0, Math.PI * 2); sctx.fill();
  sctx.strokeStyle = '#fff'; sctx.lineWidth = 2; sctx.stroke();
}
let spinDrag = false;
const spinFromEvent = e => {
  const b = spin.getBoundingClientRect(), r = b.width * 0.42;
  setTip((e.clientX - b.left - b.width / 2) / r, -(e.clientY - b.top - b.height / 2) / r);
};
spin.addEventListener('pointerdown', e => { if (inputLocked()) return; spinDrag = true; spin.setPointerCapture(e.pointerId); spinFromEvent(e); });
spin.addEventListener('pointermove', e => { if (spinDrag) spinFromEvent(e); });
spin.addEventListener('pointerup', () => { spinDrag = false; });
spin.addEventListener('dblclick', () => setTip(0, 0));

const powerBar = $('power');
let powerDrag = false;
const powerFromEvent = e => {
  const b = powerBar.getBoundingClientRect();
  setPower(1 - (e.clientY - b.top) / b.height);
};
powerBar.addEventListener('pointerdown', e => { if (inputLocked()) return; powerDrag = true; powerBar.setPointerCapture(e.pointerId); powerFromEvent(e); });
powerBar.addEventListener('pointermove', e => { if (powerDrag) powerFromEvent(e); });
powerBar.addEventListener('pointerup', () => { powerDrag = false; });

$('btnPlace').addEventListener('click', () => { sfx.unlock(); if (st.mode === 'place' && !inputLocked()) confirmPlacement(); });
$('btnShoot').addEventListener('click', () => { sfx.unlock(); if (inputLocked()) return; if (st.mode === 'place') confirmPlacement(); else shoot(); });
$('btnView').addEventListener('click', () => dispatchEvent(new KeyboardEvent('keydown', { key: 'v' })));
$('btnLines').addEventListener('click', () => dispatchEvent(new KeyboardEvent('keydown', { key: 'h' })));
$('btnGhost').addEventListener('click', () => dispatchEvent(new KeyboardEvent('keydown', { key: 'g' })));
$('btnHelp').addEventListener('click', () => setHelp($('help').classList.contains('hidden')));
$('helpClose').addEventListener('click', () => setHelp(false));

// Steuerungs-Legende ein-/ausblenden; Einstellung bleibt im Browser gespeichert
function setHelp(visible) {
  $('help').classList.toggle('hidden', !visible);
  $('btnHelp').textContent = `Steuerung: ${visible ? 'an' : 'aus'} (T)`;
  $('btnHelp').classList.toggle('on', visible);
  try { localStorage.setItem('potblack.help', visible ? '1' : '0'); } catch { /* Speicher nicht verfügbar */ }
}
function initialHelp() {
  let stored = null;
  try { stored = localStorage.getItem('potblack.help'); } catch { /* Speicher nicht verfügbar */ }
  return stored === null ? innerWidth >= 1200 : stored === '1';
}
// Startmenü: Single Player (gegen Computer), Multi Player (ein Gerät) oder Online; Felder nur bei Bedarf
function setMode(mode) {
  st.menuMode = mode;
  st.vsAi = mode === 'ai';
  for (const [id, m] of [['modeAi', 'ai'], ['modePvp', 'pvp'], ['modeOnline', 'online']]) {
    $(id).classList.toggle('on', mode === m);
    $(id).setAttribute('aria-checked', mode === m);
  }
  $('aiRow').classList.toggle('hidden', mode !== 'ai');
  $('n2Field').classList.toggle('hidden', mode !== 'pvp');
  $('onlineRow').classList.toggle('hidden', mode !== 'online');
  $('start').classList.toggle('hidden', mode === 'online');
  $('n1Label').textContent = mode === 'pvp' ? 'Spieler 1' : 'Dein Name';
  if (mode === 'online') net.connect(playerName());
}
$('modeAi').addEventListener('click', () => setMode('ai'));
$('modePvp').addEventListener('click', () => setMode('pvp'));
$('modeOnline').addEventListener('click', () => setMode('online'));
for (const b of document.querySelectorAll('#aiRow button')) {
  b.addEventListener('click', () => {
    st.aiLevel = b.dataset.level;
    for (const o of document.querySelectorAll('#aiRow button')) o.classList.toggle('on', o === b);
  });
}
$('createGame').addEventListener('click', () => { sfx.unlock(); net.send({ type: 'create', name: playerName() }); });
$('n1').addEventListener('change', () => { if (st.menuMode === 'online') net.connect(playerName()); });
$('btnLeave').addEventListener('click', confirmLeave);

// Ton ein/aus; Einstellung bleibt im Browser gespeichert
function setSound(on) {
  sfx.enabled = on;
  $('btnSound').textContent = `Ton: ${on ? 'an' : 'aus'} (M)`;
  $('btnSound').classList.toggle('on', on);
  try { localStorage.setItem('potblack.sound', on ? '1' : '0'); } catch { /* Speicher nicht verfügbar */ }
}
$('btnSound').addEventListener('click', () => { sfx.unlock(); setSound(!sfx.enabled); });
{
  let stored = null;
  try { stored = localStorage.getItem('potblack.sound'); } catch { /* Speicher nicht verfügbar */ }
  setSound(stored !== '0');
}

// Optionen-Dropdown: öffnet per Klick, schließt bei Klick daneben oder mit Escape
function setOptionsOpen(open) {
  $('optMenu').classList.toggle('hidden', !open);
  $('btnOptions').setAttribute('aria-expanded', open);
}
$('btnOptions').addEventListener('click', e => { e.stopPropagation(); setOptionsOpen($('optMenu').classList.contains('hidden')); });
$('optMenu').addEventListener('click', e => e.stopPropagation());
addEventListener('pointerdown', e => { if (!e.target.closest('.dropdown')) setOptionsOpen(false); });
addEventListener('keydown', e => { if (e.key === 'Escape') setOptionsOpen(false); });

// Spielernamen im Browser merken (localStorage) und beim nächsten Besuch wieder eintragen
for (const id of ['n1', 'n2']) {
  const key = `potblack.${id}`;
  try {
    const saved = localStorage.getItem(key);
    if (saved) $(id).value = saved;
  } catch { /* Speicher nicht verfügbar */ }
  $(id).addEventListener('input', () => {
    try { localStorage.setItem(key, $(id).value.trim()); } catch { /* Speicher nicht verfügbar */ }
  });
}
setMode('ai');

$('start').addEventListener('click', () => {
  sfx.unlock();
  st.online = null;
  st.names = [$('n1').value.trim() || 'Spieler 1',
    st.vsAi ? `Computer (${AI_LEVELS[st.aiLevel].label})` : $('n2').value.trim() || 'Spieler 2'];
  st.starter = 0;
  st.frames = [0, 0];
  $('menu').classList.add('hidden');
  $('hud').classList.remove('hidden');
  setHelp(initialHelp());
  newFrame();
});

// ---------------------------------------------------------------- HUD

let toastTimer = 0;
function toast(text) {
  const m = $('msg');
  m.textContent = text;
  m.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => m.classList.remove('show'), 4500);
}

function showOverlay(title, html, buttons) {
  st.lastOverlay = [title, html, buttons];
  $('ovTitle').textContent = title;
  $('ovBody').innerHTML = html;
  const bb = $('ovButtons');
  bb.innerHTML = '';
  for (const [label, fn] of buttons) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = fn;
    bb.appendChild(b);
  }
  $('overlay').classList.remove('hidden');
}
function hideOverlay() { $('overlay').classList.add('hidden'); }

function updateHud() {
  if (!frame) return;
  for (const i of [0, 1]) {
    $(`p${i}`).classList.toggle('active', frame.current === i);
    $(`p${i}name`).textContent = frame.names[i];
    $(`p${i}score`).textContent = frame.scores[i];
  }
  $('frames').textContent = `${st.frames[0]} (Frames) ${st.frames[1]}`;
  const reds = balls.filter(b => b.kind === 'red' && b.onTable).length;
  const remain = frame.pointsRemaining(balls);
  const diff = Math.abs(frame.scores[0] - frame.scores[1]);
  $('on').textContent = frame.freeBall ? `Freie Kugel (${frame.onLabel()})` : frame.onLabel();
  $('on').className = 'on-' + frame.on;
  $('brk').textContent = frame.breakPts;
  $('reds').textContent = reds;
  $('remain').textContent = remain + (diff > remain ? ' · Snooker nötig' : '');
  $('powerFill').style.height = `${st.power * 100}%`;
  $('powerVal').textContent = `${Math.round(st.power * 100)} %`;
  $('btnView').textContent = st.camMode === 'fp' ? 'Ansicht: Spieler (V)' : 'Ansicht: Draufsicht (V)';
  $('btnLines').textContent = `Linien: ${LINE_MODES[st.lines]} (H)`;
  $('btnGhost').textContent = `Geisterball: ${st.ghosts ? 'an' : 'aus'} (G)`;
  $('btnGhost').classList.toggle('on', st.ghosts);
  $('btnShoot').textContent = st.mode === 'place' ? 'Platzieren' : 'Stoß (Leertaste)';
  const ai = inputLocked();
  $('btnShoot').disabled = ai || !(st.mode === 'aim' || st.mode === 'place');
  $('btnPlace').classList.toggle('hidden', st.mode !== 'place' || ai);
  const watching = st.online && st.online.seat == null ? 'Zuschauer · ' : '';
  if (ai && (st.mode === 'aim' || st.mode === 'place')) {
    $('status').textContent = isAiTurn()
      ? (st.travel || st.aiShootAt > performance.now() ? `${frame.names[st.aiPlayer]} zielt…` : `${frame.names[st.aiPlayer]} denkt nach…`)
      : `${watching}${frame.names[frame.current]} ist am Zug`;
    return;
  }
  $('status').textContent = watching + ({
    place: 'Weiße im D platzieren: ziehen zum Verschieben, Klick oder Leertaste zum Bestätigen',
    aim: frame.ballInHand ? 'Zielen · P = Weiße neu platzieren' : 'Zielen',
    shooting: 'Stoß…', moving: 'Kugeln laufen…', waiting: 'Warte auf das Ergebnis…',
    decision: 'Entscheidung nach Foul', over: 'Frame beendet',
  }[st.mode] || '');
}

// ---------------------------------------------------------------- Hauptschleife

let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  sfx.frame();
  processNet();
  sendAim(now);

  if (st.mode === 'shooting') {
    st.shotT += dt;
    const back = 0.03 + st.power * 0.17;
    const T1 = 0.45, T2 = 0.6, fd = 0.16 - st.power * 0.1;
    let pull;
    if (st.shotT < T1) { const f = st.shotT / T1; pull = 0.012 + back * (1 - (1 - f) * (1 - f)); }
    else if (st.shotT < T2) pull = 0.012 + back;
    else {
      const f = Math.min(1, (st.shotT - T2) / fd);
      pull = (0.012 + back) * (1 - f * f);
      if (f >= 1) doStrike();
    }
    view.setCue(true, cue, st.aim, st.tipX, st.tipY, pull, st.elev);
  } else if (st.mode === 'moving') {
    st.moveT += dt;
    st.simAcc += dt;
    const ev = [];
    while (st.simAcc >= PHYS.dt) {
      st.simAcc -= PHYS.dt;
      ev.length = 0;
      step(balls, PHYS.dt, ev);
      if (ev.length) handleEvents(ev);
    }
    const ft = Math.min(1, st.moveT / 0.12);
    view.setCue(st.moveT < 0.7, st.strikePos, st.aim, st.tipX, st.tipY, -0.05 * ft, st.elev);
    if (!anyMoving(balls) && st.moveT > 0.3) {
      view.setCue(false);
      endOfShot();
    }
  } else if (st.mode === 'aim') {
    if (st.travel) {
      const tr = st.travel;
      tr.t += dt;
      const f = Math.min(1, tr.t / tr.dur);
      st.aim = tr.from + (tr.to - tr.from) * (f * f * (3 - 2 * f));
      st.predDirty = true;
      if (f >= 1) st.travel = null;
    }
    if (st.aiBusy && st.aiShootAt && !st.travel && now >= st.aiShootAt) { st.aiShootAt = 0; shoot(); }
    applyTipLimit();
    st.elev = cueElevation(cue, st.aim, st.tipY, 0.07, balls, st.tipX);
    view.setCue(true, cue, st.aim, st.tipX, st.tipY, 0.012, st.elev);
  } else if (st.mode === 'menu') {
    const a = attract.update(dt);
    if (attract.changed) {
      attract.changed = false;
      balls = attract.balls;
      cue = balls[0];
      view.setBalls(balls);
    }
    st.attractCam = a.cam;
    if (a.cue) view.setCue(true, a.cue.pos, a.cue.aim, a.cue.tipX, a.cue.tipY, a.cue.pull, 0.07);
    else view.setCue(false);
  } else {
    view.setCue(false);
  }

  const camBusy = st.travel || st.camTransition;
  if (frame && inputLocked()) {
    // Zuschauer und wartende Spieler sehen keine Hilfslinien und Geisterbälle
    view.setPrediction(null);
  } else if (camBusy && st.mode === 'aim') {
    view.setPrediction(null);
    st.predDirty = true;
  } else if ((st.mode === 'aim' || st.mode === 'place') && st.predDirty && now - st.predAt > 60) {
    st.predDirty = false;
    st.predAt = now;
    view.setPrediction(computePrediction());
  } else if (st.mode !== 'aim' && st.mode !== 'place' && st.mode !== 'shooting') {
    view.setPrediction(null);
  }

  view.syncBalls(balls, dt);
  updateCamera(dt);
  view.render();
}

drawSpin();
requestAnimationFrame(loop);

// Hintergrund im Menü: Vorspann mit Szenen typischer Stöße
const attract = new Attract();

// Debug-Zugriff in der Browser-Konsole
window.snooker = { st, view, attract, shoot, get balls() { return balls; }, get frame() { return frame; } };
