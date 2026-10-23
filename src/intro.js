// Intro vor dem Startbildschirm: In einem dunklen Holodeck mit Leuchtgitter zeichnen Laserstrahlen
// nach und nach die Kanten des Tisches, die Markierungen und die Kugeln. Am Ende tastet ein Scanner
// das echte 3D-Modell (dasselbe wie im Spiel) von unten nach oben ins Bild. Acht Einstellungen mit
// harten Schnitten, etwa 25 Sekunden.
import * as THREE from 'three';
import { BALL_R as R, BAULK_Z, D_RADIUS } from './constants.js';

const WIRE_COLOR = 0x7fdcff;
const GRID_COLOR = 0xffb000;
const FLOOR_Y = -0.86;
const SCAN_FROM = FLOOR_Y - 0.02, SCAN_TO = 1.26;
// Spielball (Anstoßposition, wie im Vorspann) und Kamera für die Nahaufnahme, die ihn umkreist
const CUE_X = D_RADIUS / 2, CUE_Z = BAULK_Z;
const cueCam = (a, r, y) => [CUE_X + Math.sin(a) * r, y, CUE_Z + Math.cos(a) * r];

const clamp01 = t => Math.max(0, Math.min(1, t));
const ease = t => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// Einstellungen: Zeitfenster, Kamerafahrt (Position/Blickpunkt am Anfang und Ende), Brennweite.
// Alle Fahrten laufen mit gleichmäßigem Tempo durch den Schnitt, nur die letzte bremst ab.
const SHOTS = [
  // Leeres Holodeck, das Gitter breitet sich aus
  { from: 0, to: 2.8, pos: [[4.9, 0.5, 5.2], [4.2, 0.6, 4.5]], look: [[0, -0.4, 0], [0, -0.35, 0]], fov: 52 },
  // Am Boden neben einem Bein: der Laser beginnt unten
  { from: 2.8, to: 5.0, pos: [[-2.0, -0.62, -2.75], [-1.65, -0.58, -3.0]], look: [[-0.9, -0.45, -1.55], [-0.75, -0.42, -1.35]], fov: 48 },
  // Seitlich auf Tischhöhe entlang der langen Bande
  { from: 5.0, to: 7.4, pos: [[2.0, 0.06, 2.0], [2.0, 0.1, -0.5]], look: [[0.9, -0.12, 0.7], [0.9, -0.12, -1.7]], fov: 46 },
  // Ecktasche von nahem
  { from: 7.4, to: 11.2, pos: [[1.75, 0.19, 2.45], [1.05, 0.27, 2.9]], look: [[0.8, -0.06, 1.52], [0.5, -0.05, 1.65]], fov: 46 },
  // Von oben über den Baulk-Bereich: Linien und D
  { from: 11.2, to: 13.6, pos: [[0.6, 1.25, 2.4], [-0.5, 1.3, 2.25]], look: [[0, 0, 0.95], [0, 0, 0.82]], fov: 50 },
  // Flach über dem Tuch am Pack: die Kugeln entstehen
  { from: 13.6, to: 15.8, pos: [[0.52, 0.11, -0.42], [0.34, 0.12, -0.52]], look: [[0, 0.02, -1.0], [-0.03, 0.02, -1.03]], fov: 40 },
  // Nahaufnahme: der Laser zeichnet den Spielball, dann wird er Schicht für Schicht massiv
  { from: 15.8, to: 20.4, pos: [cueCam(2.5, 0.2, R + 0.05), cueCam(1.55, 0.13, R + 0.03)], look: [[CUE_X, R * 0.95, CUE_Z], [CUE_X, R * 0.9, CUE_Z]], fov: 34 },
  // Weite Fahrt, der Tisch entsteht vollständig; endet in der ersten Einstellung des Vorspanns
  { from: 20.4, to: 25.0, pos: [[3.6, 0.8, 3.6], [Math.sin(0.6) * 3.0, 1.45, Math.cos(0.6) * 3.4]], look: [[0, -0.25, 0], [0, 0, -0.2]], fov: 50, brake: true },
];
export const INTRO_DURATION = SHOTS[SHOTS.length - 1].to;

// Laser-Phasen: welche Bauteile wann gezeichnet werden und in welcher Reihenfolge der Strahl wandert
const TRACES = [
  { parts: ['leg', 'skirt', 'slate'], from: 2.2, to: 7.0, order: 'height', emitter: [-2.6, 2.9, 2.2] },
  { parts: ['wood', 'leather', 'cushion', 'throat', 'net'], from: 6.6, to: 11.4, order: 'angle', emitter: [2.4, 2.9, 3.0] },
  { parts: ['cloth', 'marking'], from: 11.3, to: 13.6, order: 'z', emitter: [0, 3.0, 3.4] },
];
const BALLS_FROM = 13.8, BALLS_TO = 15.6, BALLS_EMITTER = [1.8, 2.8, -2.6];
const CUE_DRAW = [16.1, 18.0], CUE_SCAN = [18.1, 19.5], CUE_EMITTER = [CUE_X + 0.6, 1.5, CUE_Z + 1.25];
const SCAN = [20.8, 23.4];
const FADE_WIRES = [22.6, 23.8], FADE_GRID = [23.0, 24.4];

// Leuchtpunkt für Laserspitze und Emitter
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.2, 'rgba(190,240,255,0.9)');
  r.addColorStop(0.5, 'rgba(90,200,255,0.3)');
  r.addColorStop(1, 'rgba(60,160,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// Liniensegmente zu einer Geometrie zusammenfassen, sortiert nach Schlüssel (Reihenfolge des Zeichnens)
function segmentsGeometry(segs) {
  segs.sort((a, b) => a.key - b.key);
  const pos = new Float32Array(segs.length * 6);
  segs.forEach((s, i) => pos.set(s.p, i * 6));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setDrawRange(0, 0);
  return geo;
}

function lineMaterial(color, opacity) {
  return new THREE.LineBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
}

export class Intro {
  constructor(view) {
    this.view = view;
    this.active = false;
    this.t = 0;
  }

  // Startet das Intro mit den Kugeln, die danach auch der Vorspann zeigt; onDone wird am Ende aufgerufen
  start(balls, onDone) {
    const v = this.view, scene = v.scene;
    this.onDone = onDone;
    this.active = true;
    this.t = 0;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.saved = { background: scene.background, fog: scene.fog, fov: v.camera.fov, floorOpacity: v.floor.material.opacity, floorTransparent: v.floor.material.transparent };
    scene.background = new THREE.Color(0x000000);
    scene.fog = null;
    v.setBalls(balls);
    v.syncBalls(balls, 0);
    v.setCue(false);
    v.setPrediction(null);
    v.dArea.visible = false;
    this.ballShadows = [...v.ballShadows.values()].flat();
    for (const sh of this.ballShadows) sh.visible = false;
    v.floor.material.transparent = true;
    v.floor.material.opacity = 0;
    v.lamps.visible = true;

    // Echtes Modell: über eine Schnittebene vollständig ausgeblendet, der Scanner hebt sie später an
    this.plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), SCAN_FROM);
    v.renderer.localClippingEnabled = true;
    const parts = scene.children.filter(o => o.userData.part);
    const clipped = [...parts, ...v.ballMeshes.values(), v.lamps];
    const mats = new Set();
    for (const o of clipped) o.traverse(m => { if (m.material) mats.add(m.material); });
    for (const m of mats) { m.clippingPlanes = [this.plane]; m.clipShadows = true; m.needsUpdate = true; }
    // Der Spielball hat seine eigene Schnittebene: er entsteht schon in der Nahaufnahme
    const cueBall = balls.find(b => b.kind === 'cue');
    this.cuePlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), -0.001);
    v.ballMeshes.get(cueBall.id).material.clippingPlanes = [this.cuePlane];

    this.buildGrid();
    this.buildTraces(parts);
    this.buildBalls(balls);
    this.buildCueBall(cueBall);
    this.buildLasers();
    this.buildScanner();
  }

  // Holodeck: Leuchtgitter auf Boden und Wänden, breitet sich von der Mitte aus
  buildGrid() {
    const segs = [];
    const S = 7, H = 4.6, step = 0.5;
    const add = (a, b) => {
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, mz = (a[2] + b[2]) / 2;
      segs.push({ p: [...a, ...b], key: Math.hypot(mx, mz) + Math.max(0, my - FLOOR_Y) * 0.8 });
    };
    // Boden in kurzen Stücken, damit sich das Gitter ringförmig ausbreitet
    for (let i = -S; i <= S + 1e-6; i += step) {
      for (let j = -S; j < S - 1e-6; j += step) {
        add([i, FLOOR_Y, j], [i, FLOOR_Y, j + step]);
        add([j, FLOOR_Y, i], [j + step, FLOOR_Y, i]);
      }
    }
    // Wände
    for (const [ax, sgn] of [['x', 1], ['x', -1], ['z', 1], ['z', -1]]) {
      const at = (u, y) => (ax === 'x' ? [sgn * S, y, u] : [u, y, sgn * S]);
      for (let u = -S; u <= S + 1e-6; u += step) {
        for (let y = FLOOR_Y; y < FLOOR_Y + H - 1e-6; y += step) add(at(u, y), at(u, y + step));
      }
      for (let y = FLOOR_Y; y <= FLOOR_Y + H + 1e-6; y += step) {
        for (let u = -S; u < S - 1e-6; u += step) add(at(u, y), at(u + step, y));
      }
    }
    this.gridCount = segs.length;
    this.grid = new THREE.LineSegments(segmentsGeometry(segs), lineMaterial(GRID_COLOR, 0.6));
    this.grid.frustumCulled = false;
    this.group.add(this.grid);
  }

  // Kanten der Bauteile je Laser-Phase sammeln (in Weltkoordinaten) und sortieren
  buildTraces(parts) {
    this.traces = TRACES.map(tr => {
      const segs = [];
      for (const mesh of parts.filter(p => tr.parts.includes(p.userData.part))) {
        mesh.updateMatrixWorld();
        const edges = new THREE.EdgesGeometry(mesh.geometry, 28);
        edges.applyMatrix4(mesh.matrixWorld);
        const a = edges.attributes.position.array;
        for (let i = 0; i < a.length; i += 6) {
          const x = (a[i] + a[i + 3]) / 2, y = (a[i + 1] + a[i + 4]) / 2, z = (a[i + 2] + a[i + 5]) / 2;
          const key = tr.order === 'height' ? y * 10 + Math.atan2(z, x) * 0.05
            : tr.order === 'angle' ? Math.atan2(z, x) + y * 0.02
            : -z + Math.abs(x) * 0.05;
          segs.push({ p: Array.from(a.subarray(i, i + 6)), key });
        }
        edges.dispose();
      }
      const geo = segmentsGeometry(segs);
      const lines = new THREE.LineSegments(geo, lineMaterial(WIRE_COLOR, 0.85));
      lines.frustumCulled = false;
      this.group.add(lines);
      return { ...tr, lines, count: segs.length, pos: geo.attributes.position.array };
    });
  }

  // Kugeln als Drahtgitter, nacheinander vom Laser "aufgebaut"
  buildBalls(balls) {
    const geo = new THREE.WireframeGeometry(new THREE.SphereGeometry(R, 14, 10));
    const mat = lineMaterial(WIRE_COLOR, 0.8);
    const order = balls.filter(b => b.kind !== 'cue').sort((a, b) => a.z - b.z);
    this.wireBalls = order.map((b, i) => {
      const m = new THREE.LineSegments(geo, mat);
      m.position.set(b.x, R, b.z);
      m.scale.setScalar(0.001);
      m.visible = false;
      this.group.add(m);
      return { m, at: BALLS_FROM + (BALLS_TO - BALLS_FROM) * i / order.length };
    });
  }

  // Spielball in Nahaufnahme: feines Drahtgitter, das der Strahl Meridian für Meridian zeichnet,
  // dazu ein Leuchtring, der beim Materialisieren an der Schnittkante entlangläuft
  buildCueBall(b) {
    const wire = new THREE.WireframeGeometry(new THREE.SphereGeometry(R * 1.004, 28, 18));
    const a = wire.attributes.position.array, segs = [];
    for (let i = 0; i < a.length; i += 6) {
      const x = (a[i] + a[i + 3]) / 2, y = (a[i + 1] + a[i + 4]) / 2, z = (a[i + 2] + a[i + 5]) / 2;
      const p = Array.from(a.subarray(i, i + 6));
      for (let k = 0; k < 6; k += 3) { p[k] += b.x; p[k + 1] += R; p[k + 2] += b.z; }
      segs.push({ p, key: Math.atan2(z, x) - y / R * 0.15 });
    }
    wire.dispose();
    const geo = segmentsGeometry(segs);
    this.cueWire = new THREE.LineSegments(geo, lineMaterial(WIRE_COLOR, 0.9));
    this.cueWire.frustumCulled = false;
    this.group.add(this.cueWire);
    this.cueCount = segs.length;
    this.cuePos = geo.attributes.position.array;
    this.cueBall = b;
    // Leuchtende Schnittfläche: Kreisscheibe mit hellem Rand (verdeckt das hohle Innere der Kugel)
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    rg.addColorStop(0, 'rgba(120,210,255,0.55)');
    rg.addColorStop(0.82, 'rgba(160,230,255,0.75)');
    rg.addColorStop(0.9, 'rgba(255,255,255,1)');
    rg.addColorStop(1, 'rgba(160,230,255,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, 128, 128);
    this.cueRing = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    this.cueRing.visible = false;
    this.group.add(this.cueRing);
  }

  // Zwei Strahlen (Kern und Glühen) plus Leuchtpunkte an Emitter und Spitze
  buildLasers() {
    const tex = glowTexture();
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true).translate(0, 0.5, 0);
    const mk = () => {
      const core = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      const glow = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0x48c8ff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      const spriteMat = () => new THREE.SpriteMaterial({ map: tex, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      const tip = new THREE.Sprite(spriteMat());
      const src = new THREE.Sprite(spriteMat());
      for (const o of [core, glow, tip, src]) { o.frustumCulled = false; o.visible = false; this.group.add(o); }
      return { core, glow, tip, src };
    };
    this.lasers = [mk(), mk()];
    this.tmpV = new THREE.Vector3();
    this.tmpV2 = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
  }

  // Scanner: leuchtende Ebene, die das Modell von unten nach oben einblendet
  buildScanner() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const r = g.createRadialGradient(64, 64, 10, 64, 64, 64);
    r.addColorStop(0, 'rgba(120,220,255,0.55)');
    r.addColorStop(0.7, 'rgba(80,190,255,0.25)');
    r.addColorStop(1, 'rgba(60,160,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
    this.scanner = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 5.2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    this.scanner.visible = false;
    this.group.add(this.scanner);
  }

  aimLaser(l, from, to, flicker) {
    const v = this.tmpV.set(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const len = v.length();
    // In Nahaufnahmen Strahl und Leuchtpunkt schmaler, sonst überstrahlen sie das Bild
    const near = clamp01(this.view.camera.position.distanceTo(this.tmpV2.set(...to)) / 1.2) * 0.8 + 0.2;
    for (const [beam, w] of [[l.core, 0.0022 * near], [l.glow, 0.011 * flicker * near]]) {
      beam.visible = true;
      beam.position.set(...from);
      beam.quaternion.setFromUnitVectors(this.up, v.clone().normalize());
      beam.scale.set(w, len, w);
    }
    l.tip.visible = l.src.visible = true;
    l.tip.position.set(...to);
    l.tip.scale.setScalar(0.09 * flicker * near);
    l.src.position.set(...from);
    l.src.scale.setScalar(0.35);
  }

  hideLaser(l) { l.core.visible = l.glow.visible = l.tip.visible = l.src.visible = false; }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    const t = this.t, v = this.view;
    v.invalidate();
    v.renderer.shadowMap.needsUpdate = true;

    // Kamera: harte Schnitte zwischen den Einstellungen, innerhalb einer Einstellung sanfte Fahrt
    const i = SHOTS.findIndex(s => t < s.to);
    const shot = SHOTS[i < 0 ? SHOTS.length - 1 : i];
    const x = clamp01((t - shot.from) / (shot.to - shot.from));
    const u = shot.brake ? 1 - (1 - x) ** 3 : x;
    const cam = v.camera;
    cam.position.set(...lerp3(shot.pos[0], shot.pos[1], u));
    cam.up.set(0, 1, 0);
    cam.lookAt(...lerp3(shot.look[0], shot.look[1], u));
    // Hochformat: Brennweite so anpassen, dass der Bildausschnitt in der Breite erhalten bleibt
    const aspect = innerWidth / innerHeight;
    const hHalf = Math.atan(Math.tan(shot.fov * Math.PI / 360) * 1.6);
    const fov = Math.min(88, 2 * Math.atan(Math.tan(hHalf) / Math.max(aspect, 1.6)) * 180 / Math.PI);
    if (Math.abs(cam.fov - fov) > 1e-3) { cam.fov = fov; cam.updateProjectionMatrix(); }

    // Gitter breitet sich aus und verblasst am Ende
    this.grid.geometry.setDrawRange(0, Math.floor(this.gridCount * ease(clamp01(t / 2.6))) * 2);
    this.grid.material.opacity = 0.6 * (1 - ease(clamp01((t - FADE_GRID[0]) / (FADE_GRID[1] - FADE_GRID[0]))));
    const wireFade = 1 - ease(clamp01((t - FADE_WIRES[0]) / (FADE_WIRES[1] - FADE_WIRES[0])));

    // Laser zeichnen die Kanten
    const flicker = 0.85 + Math.random() * 0.3;
    let used = 0;
    for (const tr of this.traces) {
      const p = clamp01((t - tr.from) / (tr.to - tr.from));
      const n = Math.floor(tr.count * p);
      tr.lines.geometry.setDrawRange(0, n * 2);
      tr.lines.material.opacity = 0.85 * wireFade;
      if (p > 0 && p < 1 && used < this.lasers.length) {
        const k = Math.max(0, n - 1) * 6;
        this.aimLaser(this.lasers[used++], tr.emitter, [tr.pos[k + 3], tr.pos[k + 4], tr.pos[k + 5]], flicker);
      }
    }
    // Kugeln: der Strahl springt von Kugel zu Kugel, jede wächst kurz auf
    let current = null;
    for (const wb of this.wireBalls) {
      const a = clamp01((t - wb.at) / 0.18);
      wb.m.visible = t >= wb.at;
      wb.m.scale.setScalar(Math.max(0.001, ease(a) * (1 + 0.25 * Math.sin(a * Math.PI))));
      if (t >= wb.at && t < wb.at + 0.12) current = wb.m.position;
    }
    this.wireBalls[0].m.material.opacity = 0.8 * wireFade;
    if (current && used < this.lasers.length) this.aimLaser(this.lasers[used++], BALLS_EMITTER, [current.x, current.y, current.z], flicker);

    // Spielball: erst das Drahtgitter, dann wächst er von unten nach oben massiv heran
    const cd = clamp01((t - CUE_DRAW[0]) / (CUE_DRAW[1] - CUE_DRAW[0]));
    const cn = Math.floor(this.cueCount * cd);
    this.cueWire.geometry.setDrawRange(0, cn * 2);
    const cs = ease(clamp01((t - CUE_SCAN[0]) / (CUE_SCAN[1] - CUE_SCAN[0])));
    const ch = lerp(-0.001, 2 * R + 0.002, cs);
    this.cuePlane.constant = ch;
    this.cueWire.material.opacity = 0.9 * (1 - ease(clamp01((t - CUE_SCAN[1] + 0.2) / 0.8))) * wireFade;
    const cb = this.cueBall, ringR = Math.sqrt(Math.max(0, R * R - (ch - R) ** 2));
    this.cueRing.visible = cs > 0 && cs < 1;
    this.cueRing.position.set(cb.x, ch, cb.z);
    this.cueRing.scale.setScalar(Math.max(0.001, ringR * 1.02));
    this.cueRing.material.opacity = 0.9 * Math.sin(cs * Math.PI);
    if (used < this.lasers.length) {
      if (cd > 0 && cd < 1) {
        const k = Math.max(0, cn - 1) * 6;
        this.aimLaser(this.lasers[used++], CUE_EMITTER, [this.cuePos[k + 3], this.cuePos[k + 4], this.cuePos[k + 5]], flicker);
      } else if (cs > 0 && cs < 1) {
        // Während des Materialisierens wandert der Strahl rasch um die Schnittkante
        const a = t * 14;
        this.aimLaser(this.lasers[used++], CUE_EMITTER, [cb.x + Math.cos(a) * ringR, ch, cb.z + Math.sin(a) * ringR], flicker);
      }
    }
    for (let k = used; k < this.lasers.length; k++) this.hideLaser(this.lasers[k]);

    // Scanner hebt die Schnittebene an: das echte Modell erscheint
    const s = ease(clamp01((t - SCAN[0]) / (SCAN[1] - SCAN[0])));
    const h = lerp(SCAN_FROM, SCAN_TO, s);
    this.plane.constant = h;
    this.scanner.visible = s > 0 && s < 1;
    this.scanner.position.y = h;
    this.scanner.material.opacity = Math.sin(s * Math.PI) * 0.9 + 0.1;
    for (const sh of this.ballShadows) sh.visible = h > R * 2;
    v.floor.material.opacity = ease(clamp01((t - FADE_GRID[0]) / (FADE_GRID[1] - FADE_GRID[0])));

    if (t >= INTRO_DURATION) this.finish();
  }

  // Ende oder Überspringen: alles auf den normalen Zustand zurücksetzen
  finish() {
    if (!this.active) return;
    this.active = false;
    const v = this.view, scene = v.scene;
    this.plane.constant = 1e6; // Schnittebene bleibt, schneidet aber nichts mehr (kein Shader-Neubau)
    this.cuePlane.constant = 1e6;
    scene.remove(this.group);
    this.group.traverse(o => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); });
    scene.background = this.saved.background;
    scene.fog = this.saved.fog;
    v.floor.material.opacity = this.saved.floorOpacity;
    v.floor.material.transparent = this.saved.floorTransparent;
    v.floor.material.needsUpdate = true;
    for (const sh of this.ballShadows) sh.visible = true;
    v.camera.fov = this.saved.fov;
    v.camera.updateProjectionMatrix();
    v.invalidate();
    v.renderer.shadowMap.needsUpdate = true;
    this.onDone?.();
  }
}
