// three.js-Darstellung: Raum, Tisch, Kugeln, Queue, Vorschaulinien.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { BALL_R as R, TABLE_L, TABLE_W, BAULK_Z, D_RADIUS, COLOURS, RED_COLOR, MAX_TIP,
  CUSHION_HEIGHT as CUSHION_H, CUSHION_WIDTH as CUSHION_W, RAIL_HEIGHT as RAIL_H, RAIL_WIDTH as RAIL_W } from './constants.js';
import { CUSHION_PATHS, POCKETS } from './physics.js';

const HW = TABLE_W / 2, HL = TABLE_L / 2;
const FLOOR_Y = -0.86;
const SKIRT_H = 0.1; // Zarge unter dem Rahmen (flach wie am echten Tisch)
const FRAME_H = 0.11; // nach innen versetzter Unterrahmen darunter, trägt die Beine
// Ballrinne an jeder Tasche: das Netz mündet in einen Messingring, von dort führt eine leicht schräge
// Rinne aus drei Stangen weg, in der die gelochten Kugeln liegen bleiben
const RING_Y = -0.19, RAIL_Y = RING_Y - 0.058, RING_R = 0.038, RAIL_LEN = 0.38, RAIL_DROP = 0.03, RAIL_HALF = 0.024, ROD_R = 0.0035;
const RAIL_BALL_UP = Math.sqrt((R + ROD_R) ** 2 - RAIL_HALF ** 2); // Kugelmitte über den oberen Stangen
const COLOUR_OF = Object.fromEntries(COLOURS.map(c => [c.name, c.color]));

function clothTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 256);
  const img = g.getImageData(0, 0, 256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 118 + Math.random() * 20;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(10, 20);
  return t;
}

// Weiße mit sechs roten Punkten (an den Achsen), als Kugel-Textur für SphereGeometry-UVs
function cueBallTexture() {
  const W = 1024, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const base = [244, 241, 230], dot = [200, 16, 46];
  const rad = 0.0055 / R, edge = 0.012; // Winkelradius der Punkte, weicher Rand
  const axes = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (let j = 0; j < H; j++) {
    const th = (j + 0.5) / H * Math.PI, st = Math.sin(th), ct = Math.cos(th);
    for (let i = 0; i < W; i++) {
      const ph = (i + 0.5) / W * Math.PI * 2;
      const d = [-Math.cos(ph) * st, ct, Math.sin(ph) * st]; // wie in THREE.SphereGeometry
      let maxDot = -1;
      for (const a of axes) maxDot = Math.max(maxDot, d[0] * a[0] + d[1] * a[1] + d[2] * a[2]);
      const ang = Math.acos(Math.min(1, maxDot));
      const k = Math.min(1, Math.max(0, (rad + edge - ang) / (2 * edge)));
      const o = (j * W + i) * 4;
      for (let ch = 0; ch < 3; ch++) img.data[o + ch] = base[ch] + (dot[ch] - base[ch]) * k;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.75)');
  grd.addColorStop(0.7, 'rgba(255,255,255,0.22)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const CLOTH_COLOR = 0x23963f;
const OBJ_LINE_COLOR = 0x26853d; // Laufweg getroffener Kugeln: etwas dunkler als das Tuch

// Wo Lederkappen und Holzrahmen aneinanderstoßen (aus Lochposition und -radius abgeleitet)
const CP = POCKETS.find(p => p.corner), MP = POCKETS.find(p => !p.corner);
const LEATHER_LIP = 0.012; // so weit reicht das Leder an seinen Enden über den Lochrand hinaus (bis zum Holz)
const MIDDLE_HOLE_EDGE = Math.sqrt((MP.hr + 0.004) ** 2 - (HW + CUSHION_W - Math.abs(MP.hx)) ** 2);
const MIDDLE_LEATHER_CUT = MIDDLE_HOLE_EDGE + LEATHER_LIP;
// Mitteltasche: Das Leder sitzt nur als Schale an der Rückseite der Tasche; davor (zum Tisch hin)
// folgt das Holz dem Lochrand. MIDDLE_LEATHER_FRONT = Vorderkante des Leders (Abstand zur Nasenlinie).
const MIDDLE_LEATHER_FRONT = Math.abs(MP.hx) - HW + 0.015;

// Ecke (kanonisch für +x/+z, Koordinaten relativ zum Taschenloch): Das Leder beginnt dort, wo das Loch
// die Rahmen-Innenkanten trifft (E bzw. S). Seine Enden laufen rechtwinklig über die volle Rahmenbreite,
// außen ist die Tischecke rund (Kreis um das Loch, der die Rahmen-Außenkanten berührt).
// Der Holzrahmen endet rechtwinklig genau an diesen Lederenden.
const CORNER = (() => {
  const ow = CUSHION_W + RAIL_W;
  const off = Math.abs(CP.hx) - HW;          // Lochmitte liegt so weit außerhalb der Nasenlinie
  const ri = CP.hr + 0.004;                   // Innenkante des Leders
  const ro = ow - off;                        // Außenkante: berührt die Rahmen-Außenkanten
  const ez = CUSHION_W - off, ex = -Math.sqrt(ri * ri - ez * ez); // E auf der Innenkante der Kopf-/Fußbande
  return { off, ri, ro, ow, E: [ex, ez], aE: Math.atan2(ez, ex), woodOuterX: ex - LEATHER_LIP, woodInnerX: ex - LEATHER_LIP };
})();

// Umriss der Spielfläche (Rechteck mit Rand e um die Nasenlinie), an den Taschen entlang
// des Lochrands eingebuchtet. Umlauf: links -> Baulk -> rechts -> Kopfbande.
function bedOutline(e) {
  const pts = [];
  const pocketAt = (sx, sz) => POCKETS.find(p => Math.sign(p.hx) === sx && (Math.sign(p.hz) || 0) === sz);
  // Kreisbogen von p1 nach p2 um die Tasche, über die dem Tisch zugewandte Seite
  const arc = (p, p1, p2) => {
    const a1 = Math.atan2(p1[1] - p.hz, p1[0] - p.hx);
    let a2 = Math.atan2(p2[1] - p.hz, p2[0] - p.hx);
    const via = Math.atan2(-p.hz, -p.hx);
    const norm = a => ((a - a1) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    const ccw = norm(via) < norm(a2); // gegen den Uhrzeigersinn erreicht man die Tischseite vor p2
    let span = norm(a2);
    if (!ccw) span -= 2 * Math.PI;
    for (let i = 0; i <= 24; i++) {
      const a = a1 + span * i / 24;
      pts.push([p.hx + p.hr * Math.cos(a), p.hz + p.hr * Math.sin(a)]);
    }
  };
  const X = HW + e, Z = HL + e;
  const onX = (p, sx) => { const d = Math.sqrt(p.hr ** 2 - (sx * X - p.hx) ** 2); return [[sx * X, p.hz - d], [sx * X, p.hz + d]]; };
  const onZ = (p, sz) => { const d = Math.sqrt(p.hr ** 2 - (sz * Z - p.hz) ** 2); return [[p.hx - d, sz * Z], [p.hx + d, sz * Z]]; };
  // Ecke (sx, sz): von der Seitenkante (x = sx*X) auf die Stirnkante (z = sz*Z) oder umgekehrt
  const corner = (sx, sz, fromSide) => {
    const p = pocketAt(sx, sz);
    const side = onX(p, sx).find(([, z]) => Math.abs(z) < Z);
    const end = onZ(p, sz).find(([x]) => Math.abs(x) < X);
    fromSide ? arc(p, side, end) : arc(p, end, side);
  };
  const middle = (sx, up) => {
    const p = pocketAt(sx, 0);
    const [a, b] = onX(p, sx);
    up ? arc(p, a, b) : arc(p, b, a);
  };
  corner(-1, -1, false); middle(-1, true); corner(-1, 1, true);
  corner(1, 1, false); middle(1, false); corner(1, -1, true);
  return pts;
}

// Querschnitt der Bande: [Abstand hinter der Nase, Höhe]; Nase auf 1,27 R, Unterschnitt zum Tuch
// Die Oberseite steigt leicht an und endet bündig mit dem Holzrahmen (etwas darunter geschoben).
// Die hintere Oberkante ist doppelt angelegt, damit Oberseite und Rückwand getrennt schattiert werden.
const CUSHION_TOP = RAIL_H - 0.0006;
const CUSHION_PROFILE = [
  [0.02, 0], [0.008, 0.019], [0.0018, 0.0285], [0, 0.0333], [0.0015, 0.0375],
  [0.006, 0.0408], [0.014, 0.0428], [CUSHION_W, CUSHION_TOP], [CUSHION_W, CUSHION_TOP], [CUSHION_W, 0],
];
const PROFILE_FACE = 7; // ab diesem Profilpunkt (Oberseite hinten) wird nicht mehr der Rundung gefolgt
const CUSHION_UNDER_RAIL = 0.01; // so weit reicht das Bandentuch unter den Holzrahmen

// Profil entlang der Nasenlinie extrudieren. Vorderer Teil folgt jeder Rundung,
// die Rückseite bleibt an Bande bzw. Backe ausgerichtet (keine Selbstüberschneidung in engen Radien).
// Polylinie fein unterteilen (für weiche Übergänge in die Taschen)
function resample(pts, maxLen) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / maxLen));
    for (let j = 1; j <= k; j++) out.push([ax + (bx - ax) * j / k, az + (bz - az) * j / k]);
  }
  return out;
}

const DROP_ZONE = 0.03; // in diesem Abstand vor dem Lochrand beginnt das Bandentuch abzusinken

// Abstand eines Punktes zum nächsten Taschenloch (negativ = über dem Loch)
function holeGap(x, z) {
  let g = Infinity;
  for (const p of POCKETS) g = Math.min(g, Math.hypot(x - p.hx, z - p.hz) - p.hr);
  return g;
}

// Darstellung der Bande endet am Lochrand (die Physik behält ihre Backen bis in die Tasche)
function clipToHoles(pts) {
  const out = [...pts];
  for (const fromEnd of [false, true]) {
    const seq = fromEnd ? out.reverse() : out;
    while (seq.length > 2 && holeGap(...seq[0]) < 0 && holeGap(...seq[1]) < 0) seq.shift();
    if (holeGap(...seq[0]) < 0) {
      // Schnittpunkt mit dem Lochrand auf dem ersten Segment (Bisektion)
      let a = seq[1], b = seq[0];
      for (let i = 0; i < 30; i++) {
        const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        if (holeGap(...m) < 0) b = m; else a = m;
      }
      seq[0] = a;
    }
    if (fromEnd) out.reverse();
  }
  return out;
}

function sweepCushion(path) {
  const pts = resample(clipToHoles(path), 0.006);
  const n = pts.length, P = CUSHION_PROFILE.length;
  let li = 0, best = 0;
  for (let i = 0; i < n - 1; i++) {
    const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    if (l > best) { best = l; li = i; }
  }
  const segNormal = (i) => {
    const tx = pts[i + 1][0] - pts[i][0], tz = pts[i + 1][1] - pts[i][1], l = Math.hypot(tx, tz);
    return [-tz / l, tx / l];
  };
  const mx = (pts[li][0] + pts[li + 1][0]) / 2, mz = (pts[li][1] + pts[li + 1][1]) / 2;
  let [rnx, rnz] = segNormal(li);
  const sign = rnx * -mx + rnz * -mz > 0 ? 1 : -1; // Normale zeigt zum Tisch
  rnx *= sign; rnz *= sign;
  const railEdge = mx * -rnx + mz * -rnz + CUSHION_W + CUSHION_UNDER_RAIL;
  const pos = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1];
    const l = Math.hypot(tx, tz); tx /= l; tz /= l;
    const onx = sign * tz, onz = -sign * tx; // nach außen (weg vom Tisch)
    // Rückseite liegt immer an der Rahmen-Innenkante (Bandenoberseite wird zur Tasche hin breiter)
    const back = Math.max(0.004, railEdge - (pts[i][0] * -rnx + pts[i][1] * -rnz));
    for (let j = 0; j < P; j++) {
      const [dd, y] = CUSHION_PROFILE[j];
      if (j < PROFILE_FACE) pos.push(pts[i][0] + onx * dd, y, pts[i][1] + onz * dd);
      else pos.push(pts[i][0] - rnx * back, y, pts[i][1] - rnz * back);
    }
  }
  // Zur Tasche hin sinkt das Bandentuch stufenlos ab und läuft über den Lochrand in die Tasche hinein
  // (wie am echten Tisch, wo das Tuch um die Backe herum in den Fall gezogen ist)
  for (let k = 0; k < pos.length; k += 3) {
    const ring = Math.floor(k / 3 / P), j = (k / 3) % P;
    let g;
    if (j >= PROFILE_FACE) {
      // Rückseite am Holz bleibt voll hoch, solange die Bandennase noch deutlich vor dem Loch liegt;
      // je weiter die Nase ins Loch läuft, desto stufenloser sinkt die ganze Backe mit in die Tasche
      const gn = holeGap(pts[ring][0], pts[ring][1]);
      const top = DROP_ZONE * 0.6, bottom = 0;
      if (gn >= top) continue;
      const u = Math.min(1, Math.max(0, (gn - bottom) / (top - bottom)));
      const keep = u * u * (3 - 2 * u);
      pos[k + 1] = pos[k + 1] * keep + Math.max(-0.04, Math.min(0, gn * 1.2)) * (1 - keep);
      continue;
    } else {
      g = holeGap(pos[k], pos[k + 2]);
    }
    if (g >= DROP_ZONE) continue;
    if (g > 0) {
      const t = g / DROP_ZONE;
      pos[k + 1] *= 1 - (1 - t) * (1 - t);          // weich auf Tuchhöhe abfallen
    } else {
      pos[k + 1] = Math.max(-0.04, g * 1.2);       // im Loch weiter nach unten in den Fall
    }
  }
  const idx = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < P; j++) {
      const a = i * P + j, b = i * P + (j + 1) % P, c = (i + 1) * P + j, d = (i + 1) * P + (j + 1) % P;
      idx.push(a, c, b, b, c, d);
    }
  }
  for (const i of [0, n - 1]) for (let j = 0; j < P - 2; j++) idx.push(i * P + P - 1, i * P + j, i * P + j + 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// Lederkappe: U-förmiger Streifen um das Taschenloch, Enden rechtwinklig an den Holzrahmen
// gestoßen, außen um die Tischecke gerundet. Punkte kanonisch für sx = sz = +1, danach gespiegelt.
function leatherCap(p) {
  const o = CUSHION_W, ow = CUSHION_W + RAIL_W;
  const pts = [];
  const sx = Math.sign(p.hx) || 1, sz = Math.sign(p.hz) || 1;
  if (p.corner) {
    const { ri, ro, aE, E } = CORNER;
    const hx = HW + CORNER.off, hz = HL + CORNER.off;
    const arc = (r, a0, a1, n) => {
      for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push([hx + r * Math.cos(a), hz + r * Math.sin(a)]); }
    };
    // Spiegelung an der Taschenachse: Winkel a -> 90° - a
    const lip = E[0] - LEATHER_LIP;
    pts.push([hx + lip, hz + E[1]]);              // Lederende innen, etwas vor dem Lochrand
    arc(ri, aE, Math.PI / 2 - aE, 48);            // innen ums Loch, von E über die Außenseite bis S
    pts.push([hx + E[1], hz + lip]);
    pts.push([hx + ro, hz + lip]);                // Lederende an der Seite: rechtwinklig zur Außenkante
    arc(ro, 0, Math.PI / 2, 36);                  // runde Tischecke
    pts.push([hx + lip, hz + ro]);                // Lederende an der Kopf-/Fußbande
  } else {
    const hx = Math.abs(p.hx), ri = p.hr + 0.004;
    const dz = MIDDLE_LEATHER_CUT, xf = HW + MIDDLE_LEATHER_FRONT;
    const a = Math.atan2(Math.sqrt(ri * ri - (xf - hx) ** 2), xf - hx);
    // Lederschale an der Rückseite: vorne gerade Kante, innen der hintere Lochrand, außen bündig mit dem Rahmen
    pts.push([xf, -dz]);
    for (let i = 0; i <= 32; i++) { const t = -a + 2 * a * i / 32; pts.push([hx + ri * Math.cos(t), ri * Math.sin(t)]); }
    pts.push([xf, dz]);
    const rc = 0.01, x2 = HW + ow + 0.002;
    for (let i = 0; i <= 6; i++) { const t = Math.PI / 2 - Math.PI / 2 * i / 6; pts.push([x2 - rc + rc * Math.cos(t), dz - rc + rc * Math.sin(t)]); }
    for (let i = 0; i <= 6; i++) { const t = -Math.PI / 2 * i / 6; pts.push([x2 - rc + rc * Math.cos(t), -dz + rc + rc * Math.sin(t)]); }
  }
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(sx * x, -sz * z)));
  // Flach wie am echten Tisch: nur knapp über dem Holz, mit schmaler Rundung
  // Das Leder reicht 6 mm unter die Tuchoberfläche: Die untere Rundung liegt verdeckt, und das Tuch
  // schneidet sauber an der Lederwand ab (kein Flackern am Übergang).
  const b = 0.004, sink = 0.006;
  // Oberkante 4 mm über dem Holz: Die Rundung beginnt erst oberhalb von Holz und Bandenoberseite
  const geo = new THREE.ExtrudeGeometry(shape, { depth: RAIL_H + 0.004 + sink - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: 0.003, bevelSegments: 5, curveSegments: 4 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, b - sink, 0);
  return geo;
}

function netTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.strokeStyle = '#fff'; g.lineWidth = 4; g.lineCap = 'round';
  for (let i = -128; i <= 256; i += 32) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 128, 128); g.stroke();
    g.beginPath(); g.moveTo(i, 128); g.lineTo(i + 128, 0); g.stroke();
  }
  g.fillStyle = '#fff'; // Knoten an den Kreuzungen
  for (let x = 0; x <= 128; x += 16) for (let y = (x / 16) % 2 ? 0 : 16; y <= 128; y += 32) {
    g.beginPath(); g.arc(x, y, 4.5, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 2);
  return t;
}

function woodTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#5e1c12'; g.fillRect(0, 0, 512, 64);
  for (let i = 0; i < 90; i++) {
    g.strokeStyle = `rgba(${20 + Math.random() * 40},${8 + Math.random() * 14},0,${0.15 + Math.random() * 0.3})`;
    g.lineWidth = 0.5 + Math.random() * 2;
    g.beginPath();
    const y = Math.random() * 64;
    g.moveTo(0, y);
    for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 3);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Bauteil des Tisches kennzeichnen (das Intro zeichnet die Teile nacheinander nach)
function part(mesh, name) {
  mesh.userData.part = name;
  return mesh;
}

export class View {
  constructor(container) {
    // Logarithmischer Tiefenpuffer: dünne Schichten (Tuch, Markierungen, Schatten) flackern auch aus der Draufsicht nicht
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.setSize(innerWidth, innerHeight);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    // Schatten werfen nur Tisch (statisch) und Queue: Schattenkarte nur neu berechnen, wenn sich das Queue bewegt
    r.shadowMap.autoUpdate = false;
    r.shadowMap.needsUpdate = true;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    container.appendChild(r.domElement);
    this.canvas = r.domElement;

    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0b0e);
    scene.fog = new THREE.Fog(0x0a0b0e, 6, 14);
    const pmrem = new THREE.PMREMGenerator(r);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.02, 40);
    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      r.setSize(innerWidth, innerHeight);
      for (const l of Object.values(this.guides)) l.material.resolution.set(innerWidth, innerHeight);
      this.invalidate();
    });

    this.buildLights();
    this.buildRoom();
    this.buildTable();
    this.buildCue();
    this.buildGuides();
    this.ballMeshes = new Map();
    this.tmpQ = new THREE.Quaternion();
    this.tmpV = new THREE.Vector3();
    this.raycaster = new THREE.Raycaster();
    this.sig = [];
    this.lastSig = [];
    this.dirty = true;
  }

  buildLights() {
    const s = this.scene;
    const hemi = new THREE.HemisphereLight(0xb8c4d8, 0x201810, 0.35);
    s.add(hemi);
    const key = new THREE.DirectionalLight(0xfff4e0, 1.8);
    key.position.set(0.4, 5, 0.8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera;
    sc.left = -2.3; sc.right = 2.3; sc.top = 2.3; sc.bottom = -2.3; sc.near = 1; sc.far = 9;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.01;
    key.shadow.radius = 4;
    s.add(key);
    this.lights = [hemi, key];
    // Drei Tischlampen (sichtbare Schirme + Punktlichter für Glanzlichter)
    const shadeMat = new THREE.MeshStandardMaterial({ color: 0x1b2a22, roughness: 0.6, metalness: 0.3 });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
    this.lamps = new THREE.Group();
    s.add(this.lamps);
    this.lampZ = [-1.1, 0, 1.1];
    this.lampY = 1.05;
    for (const z of this.lampZ) {
      const p = new THREE.PointLight(0xfff0d8, 2.2, 4, 1.6);
      p.position.set(0, 1.05, z);
      s.add(p);
      this.lights.push(p);
      const shade = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.12, 0.55), shadeMat);
      shade.position.set(0, 1.18, z);
      this.lamps.add(shade);
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.5), glowMat);
      glow.rotation.x = Math.PI / 2;
      glow.position.set(0, 1.119, z);
      this.lamps.add(glow);
    }
  }

  buildRoom() {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30),
      new THREE.MeshStandardMaterial({ color: 0x2a1d17, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.86;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.floor = floor;
  }

  buildTable() {
    const s = this.scene;
    const env = this.envMap;

    // Spielfläche: Tuch auf Schieferplatte. Umriss reicht 1 cm unter den Holzrahmen und folgt an den
    // Taschen dem Lochrand (ein Polygon ohne Löcher – keine Überlappung mit Zarge, saubere Triangulierung).
    const bedShape = () => {
      const pts = bedOutline(CUSHION_W + 0.01);
      return new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
    };
    const tex = clothTexture();
    const clothMat = new THREE.MeshStandardMaterial({ color: CLOTH_COLOR, roughness: 0.92, roughnessMap: tex, bumpMap: tex, bumpScale: 0.3 });
    const cloth = new THREE.Mesh(new THREE.ShapeGeometry(bedShape()), clothMat);
    cloth.rotation.x = -Math.PI / 2;
    cloth.receiveShadow = true;
    s.add(part(cloth, 'cloth'));
    // Schiefer mit tuchbezogenen Lochkanten (Taschenschlund)
    const slate = new THREE.Mesh(new THREE.ExtrudeGeometry(bedShape(), { depth: 0.042, bevelEnabled: false }),
      new THREE.MeshStandardMaterial({ color: 0x0f3a1c, roughness: 0.95 }));
    slate.rotation.x = -Math.PI / 2;
    slate.position.y = -0.045; // Oberseite 3 mm unter dem Tuch
    slate.castShadow = true; // füllt den Schatten unter der Spielfläche (sonst werfen nur Rahmen und Banden einen)
    s.add(part(slate, 'slate'));

    // Markierungen: Baulk-Linie, D, Spots
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xe8f0e8, transparent: true, opacity: 0.75 });
    const baulk = new THREE.Mesh(new THREE.PlaneGeometry(TABLE_W, 0.002), lineMat);
    baulk.rotation.x = -Math.PI / 2; baulk.position.set(0, 0.0004, BAULK_Z);
    s.add(part(baulk, 'marking'));
    const d = new THREE.Mesh(new THREE.RingGeometry(D_RADIUS - 0.001, D_RADIUS + 0.001, 96, 1, Math.PI, Math.PI), lineMat);
    d.rotation.x = -Math.PI / 2; d.position.set(0, 0.0004, BAULK_Z);
    s.add(part(d, 'marking'));
    for (const c of COLOURS) {
      const sp = new THREE.Mesh(new THREE.CircleGeometry(0.003, 12), lineMat);
      sp.rotation.x = -Math.PI / 2; sp.position.set(c.spot[0], 0.0004, c.spot[1]);
      s.add(part(sp, 'marking'));
    }

    // Banden: Gummiprofil mit überhängender Nase, entlang der Nasenlinie inkl. Rundungen extrudiert
    const cushMat = new THREE.MeshStandardMaterial({ color: CLOTH_COLOR, roughness: 0.9, roughnessMap: tex, side: THREE.DoubleSide });
    for (const path of CUSHION_PATHS) {
      const m = new THREE.Mesh(sweepCushion(path), cushMat);
      m.castShadow = true; m.receiveShadow = true;
      s.add(part(m, 'cushion'));
    }

    // Mahagoni-Rahmen mit gerundeten Kanten
    const wtex = woodTexture();
    const woodMat = new THREE.MeshPhysicalMaterial({ map: wtex, color: 0xb05040, roughness: 0.32, clearcoat: 0.9, clearcoatRoughness: 0.15, envMap: env, envMapIntensity: 0.7 });
    const o = CUSHION_W;
    const bevel = 0.007;
    // Konvexes Viereck [x, z] kantenweise nach innen versetzen (die Fase wächst wieder nach außen).
    // Kanten am Leder werden nicht versetzt, damit Holz und Leder ohne Fuge aneinanderstoßen.
    const insetPoly = (pts, ds) => {
      const n = pts.length;
      const area = pts.reduce((a, p, i) => a + p[0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * p[1], 0);
      const lines = pts.map((p, i) => {
        const q = pts[(i + 1) % n];
        let nx = -(q[1] - p[1]), nz = q[0] - p[0];
        const l = Math.hypot(nx, nz); nx /= l; nz /= l;
        if (area < 0) { nx = -nx; nz = -nz; }
        return [p[0] + nx * ds[i], p[1] + nz * ds[i], q[0] - p[0], q[1] - p[1]];
      });
      return lines.map((L, i) => {
        const M = lines[(i + n - 1) % n];
        const den = M[2] * L[3] - M[3] * L[2];
        const t = ((L[0] - M[0]) * L[3] - (L[1] - M[1]) * L[2]) / den;
        return [M[0] + M[2] * t, M[1] + M[3] * t];
      });
    };
    const addWood = (poly, ds) => {
      const shape = new THREE.Shape(insetPoly(poly, ds).map(([x, z]) => new THREE.Vector2(x, -z)));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: RAIL_H - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4 });
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, bevel, 0);
      const m = new THREE.Mesh(geo, woodMat);
      m.castShadow = true; m.receiveShadow = true;
      s.add(part(m, 'wood'));
    };
    const ow = o + RAIL_W;
    // Holzenden an den Ecken: Innenkante endet am Lochrand (E), Außenkante am Lederende
    const { off, woodInnerX, woodOuterX } = CORNER;
    const cutIn = HW + off + woodInnerX, cutOut = HW + off + woodOuterX;
    const cutInZ = HL + off + woodInnerX, cutOutZ = HL + off + woodOuterX;
    const midCut = MIDDLE_LEATHER_CUT;
    for (const sz of [-1, 1]) {
      addWood([[-cutIn, sz * (HL + o)], [cutIn, sz * (HL + o)], [cutOut, sz * (HL + ow)], [-cutOut, sz * (HL + ow)]], [bevel, 0, bevel, 0]);
    }
    for (const sx of [-1, 1]) for (const h of [-1, 1]) {
      addWood([[sx * (HW + o), h * midCut], [sx * (HW + ow), h * midCut], [sx * (HW + ow), h * cutOutZ], [sx * (HW + o), h * cutInZ]], [0, bevel, 0, bevel]);
    }
    // Mitteltaschen: Holz vor dem Leder, das bis an den Lochrand reicht (eben mit der Rahmenoberkante)
    {
      const ri = MP.hr + 0.004, hxm = Math.abs(MP.hx), xf = HW + MIDDLE_LEATHER_FRONT;
      const zAt = x => Math.sqrt(Math.max(0, ri * ri - (x - hxm) ** 2));
      const fill = [[HW + o, midCut]];
      for (let i = 0; i <= 16; i++) { const x = HW + o + (xf - HW - o) * i / 16; fill.push([x, zAt(x)]); }
      fill.push([xf, midCut]);
      for (const sx of [-1, 1]) for (const h of [-1, 1]) {
        const shape = new THREE.Shape(fill.map(([x, z]) => new THREE.Vector2(sx * x, -h * z)));
        const geo = new THREE.ExtrudeGeometry(shape, { depth: RAIL_H, bevelEnabled: false, curveSegments: 4 });
        geo.rotateX(-Math.PI / 2);
        const m = new THREE.Mesh(geo, woodMat);
        m.castShadow = true; m.receiveShadow = true;
        s.add(part(m, 'wood'));
      }
    }
    // Zarge (Seitenblende) unter dem Rahmen: umlaufender Ring, an den Ecken mit derselben
    // Rundung wie die Lederkappen (Tischecke endet rund, nichts ragt darüber hinaus)
    const skirtMat = new THREE.MeshPhysicalMaterial({ map: wtex, color: 0x8a3a2c, roughness: 0.4, clearcoat: 0.6, envMap: env, envMapIntensity: 0.5 });
    const skirtH = SKIRT_H, sw = 0.05, inset = 0.01;
    const cornerR = CORNER.ro; // Radius der Leder-Außenkante (Mittelpunkt = Ecktaschenloch)
    const rounded = (path, hw, hl, r) => {
      path.moveTo(-hw + r, -hl);
      path.lineTo(hw - r, -hl); path.absarc(hw - r, -hl + r, r, -Math.PI / 2, 0, false);
      path.lineTo(hw, hl - r); path.absarc(hw - r, hl - r, r, 0, Math.PI / 2, false);
      path.lineTo(-hw + r, hl); path.absarc(-hw + r, hl - r, r, Math.PI / 2, Math.PI, false);
      path.lineTo(-hw, -hl + r); path.absarc(-hw + r, -hl + r, r, Math.PI, Math.PI * 1.5, false);
      return path;
    };
    const ro = cornerR - inset;
    const skirtShape = rounded(new THREE.Shape(), HW + ow - inset, HL + ow - inset, ro);
    skirtShape.holes.push(rounded(new THREE.Path(), HW + ow - inset - sw, HL + ow - inset - sw, ro - sw));
    const skirtGeo = new THREE.ExtrudeGeometry(skirtShape, { depth: skirtH, bevelEnabled: false, curveSegments: 24 });
    skirtGeo.rotateX(Math.PI / 2); // nach unten extrudieren: Oberkante y = 0
    const skirt = new THREE.Mesh(skirtGeo, skirtMat);
    skirt.position.y = -0.002;
    skirt.castShadow = true; skirt.receiveShadow = true;
    s.add(part(skirt, 'skirt'));

    // Taschen: cremefarbene Lederkappen und Netze
    const leatherMat = new THREE.MeshPhysicalMaterial({ color: 0xc98a4c, roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.25, sheen: 0.4, sheenColor: 0xffd9a8, envMap: env, envMapIntensity: 0.6 });
    const netMat = new THREE.MeshStandardMaterial({ map: netTexture(), color: 0xf4f1e8, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9 });
    const throatMat = new THREE.MeshStandardMaterial({ color: CLOTH_COLOR, roughness: 0.95, roughnessMap: tex, side: THREE.DoubleSide });
    for (const p of POCKETS) {
      const leather = new THREE.Mesh(leatherCap(p), leatherMat);
      leather.castShadow = true; leather.receiveShadow = true;
      s.add(part(leather, 'leather'));
      // Lochwand unterhalb des Tuchs, darunter das Netz
      const lip = [[p.hr + 0.009, 0.0003], [p.hr + 0.005, -0.0012], [p.hr + 0.002, -0.004], [p.hr + 0.0005, -0.009], [p.hr, -0.016], [p.hr, -0.045]]
        .map(([r, y]) => new THREE.Vector2(r, y));
      const throat = new THREE.Mesh(new THREE.LatheGeometry(lip, 48), throatMat);
      throat.position.set(p.hx, 0, p.hz);
      throat.receiveShadow = true;
      s.add(part(throat, 'throat'));
      const netLen = -0.02 - RING_Y;
      const net = new THREE.Mesh(new THREE.CylinderGeometry(p.hr * 0.97, RING_R * 0.96, netLen, 24, 6, true), netMat);
      net.position.set(p.hx, -0.02 - netLen / 2, p.hz);
      s.add(part(net, 'net'));
      this.buildRail(p);
    }

    // Nach innen versetzter Unterrahmen unter der Zarge, an dem die Beine sitzen (die Ballrinnen
    // laufen außen daran vorbei)
    const frameX = HW, frameZ = HL - 0.03, frameT = 0.12;
    const frameShape = rounded(new THREE.Shape(), frameX, frameZ, 0.05);
    frameShape.holes.push(rounded(new THREE.Path(), frameX - frameT, frameZ - frameT, 0.02));
    const frameGeo = new THREE.ExtrudeGeometry(frameShape, { depth: FRAME_H, bevelEnabled: false, curveSegments: 12 });
    frameGeo.rotateX(Math.PI / 2);
    const underFrame = new THREE.Mesh(frameGeo, skirtMat);
    underFrame.position.y = -SKIRT_H;
    underFrame.castShadow = true; underFrame.receiveShadow = true;
    s.add(part(underFrame, 'skirt'));

    // Gedrechselte Beine
    const legPts = [[0, 0], [0.07, 0], [0.075, 0.03], [0.06, 0.06], [0.085, 0.16], [0.095, 0.3], [0.08, 0.42], [0.06, 0.47], [0.07, 0.5], [0.066, 0.55], [0.058, 0.58], [0.058, 0.62], [0, 0.62]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    // Beine reichen vom Boden bis unter den Unterrahmen
    const legGeo = new THREE.LatheGeometry(legPts, 24).scale(1, (-SKIRT_H - FRAME_H - FLOOR_Y) / 0.62, 1);
    const legMat = new THREE.MeshPhysicalMaterial({ color: 0x3a1410, roughness: 0.35, clearcoat: 0.8, envMap: env, envMapIntensity: 0.5 });
    // Acht Beine unter dem Unterrahmen: vier je Längsseite, von den Ecken nach innen gerückt
    // Verteilung wie am Original: äußere Beine bei etwa 11 %, innere bei etwa 37 % der Tischlänge;
    // seitlich so, dass die Ballrinnen außen frei vorbeilaufen
    const legX = frameX - 0.07;
    for (const x of [-legX, legX]) for (const z of [-1.515, -0.49, 0.49, 1.515]) {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(x, FLOOR_Y, z);
      leg.castShadow = true;
      s.add(part(leg, 'leg'));
    }
  }

  // Ballrinne einer Tasche: Messingring unter dem Netz, drei schwarze Stangen (zwei oben, eine unten)
  // mit Messingbeschlägen, am Ende ein Bügel mit Lederriemen zum Rahmen. Alle Rinnen laufen entlang der
  // langen Seite: von den Ecktaschen zur Tischmitte hin, von den Mitteltaschen Richtung Baulk.
  buildRail(p) {
    const s = this.scene;
    if (!this.railMats) {
      this.railMats = {
        brass: new THREE.MeshStandardMaterial({ color: 0xc9a13b, metalness: 1, roughness: 0.28, envMap: this.envMap }),
        rod: new THREE.MeshStandardMaterial({ color: 0x141414, metalness: 0.6, roughness: 0.35, envMap: this.envMap, envMapIntensity: 0.6 }),
        strap: new THREE.MeshStandardMaterial({ color: 0x8a5532, roughness: 0.65 }),
      };
      this.rails = new Map();
    }
    const m = this.railMats;
    const dx = 0, dz = p.corner ? -Math.sign(p.hz) : 1;
    const lx = -dz, lz = dx; // quer zur Rinne
    // Rinne hängt unter dem Ring: die Kugel fällt senkrecht durch den Ring und rollt darunter heraus
    const at = (d, l, dy) => new THREE.Vector3(p.hx + dx * d + lx * l, RAIL_Y - RAIL_DROP * Math.max(0, d) / RAIL_LEN + dy, p.hz + dz * d + lz * l);
    const add = (mesh, castShadow = true) => { mesh.castShadow = castShadow; s.add(part(mesh, 'rail')); return mesh; };
    const orient = (mesh, a, b) => {
      const v = new THREE.Vector3().subVectors(b, a);
      mesh.position.copy(a).addScaledVector(v, 0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize());
      return add(mesh);
    };
    const rod = (a, b, r = ROD_R, mat = m.rod) => orient(new THREE.Mesh(new THREE.CylinderGeometry(r, r, a.distanceTo(b), 10), mat), a, b);
    const ring = add(new THREE.Mesh(new THREE.TorusGeometry(RING_R, 0.0045, 10, 40), m.brass));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(p.hx, RING_Y, p.hz);
    const lowY = -0.022, back = -0.035;
    for (const side of [-1, 1]) {
      // Obere Stangen von hinter dem Ring bis zum Ende, mit Messingkappen an beiden Enden
      rod(at(back, side * RAIL_HALF, 0), at(RAIL_LEN, side * RAIL_HALF, 0));
      rod(at(back - 0.008, side * RAIL_HALF, 0), at(back + 0.004, side * RAIL_HALF, 0), 0.0045, m.brass);
      rod(at(RAIL_LEN - 0.004, side * RAIL_HALF, 0), at(RAIL_LEN + 0.008, side * RAIL_HALF, 0), 0.0045, m.brass);
      // Messingbogen: hält die Rinne seitlich am Ring
      const ringPt = new THREE.Vector3(p.hx + lx * side * RING_R, RING_Y, p.hz + lz * side * RING_R);
      const railPt = at(0, side * RAIL_HALF, 0);
      const c1 = new THREE.Vector3(p.hx + lx * side * RING_R * 1.3, RING_Y - 0.02, p.hz + lz * side * RING_R * 1.3);
      const c2 = at(0, side * RAIL_HALF * 1.35, 0.022);
      add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CubicBezierCurve3(ringPt, c1, c2, railPt), 16, 0.0035, 8), m.brass));
    }
    // Untere Stange in der Mitte, Bügel an beiden Enden
    rod(at(back, 0, lowY), at(RAIL_LEN, 0, lowY));
    for (const d of [back, RAIL_LEN]) {
      rod(at(d, -RAIL_HALF, 0), at(d, RAIL_HALF, 0));
      rod(at(d, -RAIL_HALF, 0), at(d, 0, lowY));
      rod(at(d, RAIL_HALF, 0), at(d, 0, lowY));
    }
    // Lederriemen senkrecht hinter dem Endbügel (außerhalb der Kugelbahn) hinauf unter den Tisch
    const strapD = RAIL_LEN + 0.016;
    rod(at(RAIL_LEN, 0, -0.012), at(strapD, 0, -0.012), 0.003, m.brass);
    const bottom = at(strapD, 0, -0.02), top = bottom.clone();
    top.y = -0.06;
    orient(new THREE.Mesh(new THREE.BoxGeometry(0.018, top.y - bottom.y, 0.003), m.strap), bottom, top);
    this.rails.set(p, { dx, dz, at });
  }

  // Liegeplatz einer gelochten Kugel in der Rinne: Abstand d vom Ringmittelpunkt entlang der Rinne
  railPoint(p, d) {
    const r = this.rails.get(p), q = r.at(d, 0, RAIL_BALL_UP);
    return q;
  }

  ballMaterial(color) {
    return new THREE.MeshPhysicalMaterial({
      color, roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04,
      envMap: this.envMap, envMapIntensity: 0.9,
    });
  }

  setBalls(balls) {
    for (const m of this.ballMeshes.values()) this.scene.remove(m);
    this.ballMeshes.clear();
    for (const sh of this.ballShadows?.values() ?? []) for (const p of sh) this.scene.remove(p);
    this.ballShadows = new Map();
    if (!this.shadowTex) this.shadowTex = shadowTexture();
    const core = new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, opacity: 0.85, depthWrite: false, color: 0x000000 });
    const soft = new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, opacity: 0.28, depthWrite: false, color: 0x000000 });
    const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const geo = new THREE.SphereGeometry(R, 40, 28);
    for (const b of balls) {
      const color = b.kind === 'red' ? RED_COLOR : COLOUR_OF[b.name];
      let mat;
      if (b.kind === 'cue') {
        // Punkte als Textur der Weißen: sie werden wie die Kugel selbst beleuchtet und schattiert
        if (!this.cueTex) this.cueTex = cueBallTexture();
        mat = this.ballMaterial(0xffffff);
        mat.map = this.cueTex;
      } else {
        mat = this.ballMaterial(color);
      }
      const m = new THREE.Mesh(geo, mat);
      m.userData.ball = b;
      m.quaternion.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, 0));
      this.scene.add(m);
      this.ballMeshes.set(b.id, m);
      // Kontaktschatten direkt unter der Kugel + je ein weicher Schatten pro Tischlampe
      const shadows = [];
      const cs = new THREE.Mesh(plane, core);
      cs.scale.setScalar(R * 2.3);
      shadows.push(cs);
      for (let i = 0; i < this.lampZ.length; i++) {
        const ss = new THREE.Mesh(plane, soft.clone()); // eigene Deckkraft je Lampe
        ss.scale.setScalar(R * 3.4);
        shadows.push(ss);
      }
      shadows.forEach((p, i) => { p.position.y = 0.0006 + i * 0.00005; p.renderOrder = 1; this.scene.add(p); });
      this.ballShadows.set(b.id, shadows);
    }
  }

  // Positionen übernehmen und Rotation mit Winkelgeschwindigkeit integrieren
  syncBalls(balls, dt) {
    // Gelochte Kugeln je Tasche in der Reihenfolge, in der sie gefallen sind: die erste rollt bis ans
    // Ende der Rinne, jede weitere legt sich dahinter
    const slots = new Map();
    for (const b of balls) {
      const m = this.ballMeshes.get(b.id);
      if (!m || b.onTable || !b.pocket || !this.rails?.has(b.pocket)) continue;
      if (m.userData.potOrder == null) {
        m.userData.potOrder = this.potCounter = (this.potCounter || 0) + 1;
        m.userData.potT = b.restInRail ? 99 : 0; // restInRail: liegt von Anfang an in der Rinne (Vorspann)
        m.userData.railD = 0;
      }
      if (!slots.has(b.pocket)) slots.set(b.pocket, []);
      slots.get(b.pocket).push(m);
    }
    for (const list of slots.values()) list.sort((a, b) => a.userData.potOrder - b.userData.potOrder).forEach((m, k) => { m.userData.slot = k; });
    for (const b of balls) {
      const m = this.ballMeshes.get(b.id);
      if (!m) continue;
      const sh = this.ballShadows.get(b.id);
      for (const p of sh) p.visible = b.onTable;
      if (b.onTable) {
        // Schattenmitte: Projektion der Kugel von der Lampe aus auf das Tuch
        sh[0].position.x = b.x; sh[0].position.z = b.z;
        const k = R / (this.lampY - R);
        for (let i = 0; i < this.lampZ.length; i++) {
          const dz = b.z - this.lampZ[i];
          const p = sh[i + 1];
          p.position.x = b.x + b.x * k;
          p.position.z = b.z + dz * k;
          // Stufenlos ausblenden, je weiter die Kugel von der Lampe weg ist (kein Springen)
          const fall = Math.exp(-(dz * dz + b.x * b.x) / 1.2);
          p.scale.set(R * 3.2 * (1 + Math.abs(dz) * 0.15), 1, R * 3.2 * (1 + Math.abs(dz) * 0.35));
          p.material.opacity = 0.28 * fall;
          p.visible = fall > 0.01;
        }
        m.visible = true;
        m.position.set(b.x, R, b.z);
        m.userData.potT = 0;
        m.userData.potOrder = null;
        const w = Math.hypot(b.wx, b.wy, b.wz);
        if (w > 0 && dt > 0) {
          this.tmpV.set(b.wx / w, b.wy / w, b.wz / w);
          this.tmpQ.setFromAxisAngle(this.tmpV, w * dt);
          m.quaternion.premultiply(this.tmpQ);
        }
      } else if (b.pocket && this.rails?.has(b.pocket)) {
        // Durchs Netz in den Ring fallen, dann die Rinne hinunter bis zum Liegeplatz rollen
        const t = m.userData.potT + dt;
        m.userData.potT = t;
        const p = b.pocket, entry = this.railPoint(p, 0), FALL = 0.27;
        const target = RAIL_LEN - 0.012 - R - m.userData.slot * 2 * R * 1.005;
        if (target < 0) { m.visible = t < FALL; } // Rinne voll: Kugel verschwindet im Netz
        if (t < FALL || target < 0) {
          const f = Math.min(1, t / FALL);
          m.position.x += (p.hx - m.position.x) * Math.min(1, dt * 14);
          m.position.z += (p.hz - m.position.z) * Math.min(1, dt * 14);
          m.position.y = R + (entry.y - R) * f * f;
        } else {
          // Langsam anrollen und auf der leicht schrägen Rinne nur sacht beschleunigen
          const t2 = t - FALL, d = Math.min(target, 0.1 * t2 + 0.22 * t2 * t2);
          const step = d - m.userData.railD;
          m.userData.railD = d;
          m.position.copy(this.railPoint(p, d));
          if (step > 0) {
            const r = this.rails.get(p);
            this.tmpV.set(r.dz, 0, -r.dx);
            this.tmpQ.setFromAxisAngle(this.tmpV, step / R);
            m.quaternion.premultiply(this.tmpQ);
          }
          m.visible = true;
        }
      } else if (b.pocket && m.visible) {
        // Fallanimation in die Tasche (ohne Rinne)
        const t = (m.userData.potT || 0) + dt;
        m.userData.potT = t;
        const p = b.pocket;
        m.position.x += (p.hx - m.position.x) * Math.min(1, dt * 12);
        m.position.z += (p.hz - m.position.z) * Math.min(1, dt * 12);
        m.position.y = Math.max(-0.2, R - 4.9 * t * t);
        if (t > 1.2) m.visible = false;
      } else if (!b.pocket) {
        m.visible = false;
      }
    }
  }

  buildCue() {
    const g = this.cue = new THREE.Group();
    const parts = [
      // [Länge, Radius vorne, Radius hinten, Farbe, Rauheit]
      [0.006, 0.0047, 0.0047, 0x2a6fd6, 0.9],   // Leder mit Kreide
      [0.016, 0.0048, 0.0049, 0xf2eee0, 0.3],   // Ferrule
      [0.98, 0.0049, 0.0105, 0xd9b77a, 0.45],   // Esche-Schaft
      [0.04, 0.0105, 0.011, 0x1a1a1a, 0.3],     // Spleiß-Ring
      [0.42, 0.011, 0.0145, 0x2b120a, 0.35],    // Ebenholz-Griff
      [0.012, 0.0145, 0.0145, 0x111111, 0.5],   // Endkappe
    ];
    let z = 0;
    for (const [len, r0, r1, col, rough] of parts) {
      const geo = new THREE.CylinderGeometry(r0, r1, len, 20);
      geo.translate(0, -len / 2 - z, 0);
      geo.rotateX(Math.PI / 2);
      const m = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color: col, roughness: rough, clearcoat: 0.5, envMap: this.envMap, envMapIntensity: 0.6 }));
      m.castShadow = true;
      g.add(m);
      z += len;
    }
    g.visible = false;
    this.scene.add(g);
  }

  // Queue hinter die Weiße legen. pull: Abstand Spitze -> Kugeloberfläche
  // lift 0..1: Queue angehoben (eine Kugel rollt nach dem Stoß darauf zu)
  setCue(visible, cue, aim, tipX, tipY, pull, elev = 0.07, lift = 0) {
    const g = this.cue;
    g.visible = visible;
    if (!visible) return;
    elev += lift * 0.14;
    const dx = Math.sin(aim), dz = -Math.cos(aim);
    const rx = -dz, rz = dx;
    const a = tipX * R, b = tipY * R;
    const depth = Math.sqrt(Math.max(0, R * R - a * a - b * b));
    const px = cue.x - dx * depth + rx * a, py = R + b, pz = cue.z - dz * depth + rz * a;
    const ex = -dx * Math.cos(elev), ey = Math.sin(elev), ez = -dz * Math.cos(elev);
    g.position.set(px + ex * pull, py + ey * pull + lift * 0.08, pz + ez * pull);
    g.lookAt(g.position.x - ex, g.position.y - ey, g.position.z - ez);
  }

  buildGuides() {
    const mk = (color, dashed, dashSize = 0.03, gapSize = 0.02, linewidth = dashed ? 2 : 2.5) => {
      const mat = new LineMaterial({
        color, linewidth, dashed, dashSize, gapSize,
        transparent: true, opacity: 0.92, depthWrite: false,
      });
      mat.resolution.set(innerWidth, innerHeight);
      const l = new Line2(new LineGeometry(), mat);
      l.frustumCulled = false;
      l.renderOrder = 2;
      l.visible = false;
      this.scene.add(l);
      return l;
    };
    this.guides = {
      cue: mk(0xffffff, false),
      cueAfter: mk(0xffffff, true),
      obj: mk(OBJ_LINE_COLOR, true, 0.03, 0.018, 2.5),   // getroffene Kugel: gestrichelt
      obj2: mk(OBJ_LINE_COLOR, true, 0.01, 0.014, 2),    // weitere Kugel: gepunktet
    };
    // Geisterbälle (Kontaktpunkt und Endposition der Weißen): halbtransparente Weiße, 50 % Deckkraft
    const ghostMat = new THREE.MeshPhysicalMaterial({
      color: 0xf4f1e6, roughness: 0.15, clearcoat: 1, transparent: true, opacity: 0.5, depthWrite: false, envMap: this.envMap,
    });
    this.ghost = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 20), ghostMat);
    this.ghost.renderOrder = 3;
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(R * 0.97, R * 1.05, 40), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -R + 0.0006;
    this.ghost.add(ring);
    this.ghost.visible = false;
    this.scene.add(this.ghost);
    this.endGhost = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 20), ghostMat);
    const endRing = new THREE.Mesh(new THREE.RingGeometry(R * 1.05, R * 1.25, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
    endRing.rotation.x = -Math.PI / 2;
    endRing.position.y = -R + 0.0007;
    this.endGhost.add(endRing);
    this.endGhost.renderOrder = 3;
    this.endGhost.visible = false;
    this.scene.add(this.endGhost);
    // Markierung für Platzieren im D
    const dMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false });
    this.dArea = new THREE.Mesh(new THREE.CircleGeometry(D_RADIUS, 64, Math.PI, Math.PI), dMat);
    this.dArea.rotation.x = -Math.PI / 2;
    this.dArea.position.set(0, 0.0006, BAULK_Z);
    this.dArea.visible = false;
    this.scene.add(this.dArea);
  }

  setLine(line, pts) {
    if (pts.length < 2) { line.visible = false; return; }
    const flat = new Float32Array(pts.length * 3);
    for (let i = 0; i < pts.length; i++) {
      flat[i * 3] = pts[i][0]; flat[i * 3 + 1] = R * 0.25; flat[i * 3 + 2] = pts[i][1];
    }
    const geo = new LineGeometry();
    geo.setPositions(flat);
    line.geometry.dispose();
    line.geometry = geo;
    if (line.material.dashed) line.computeLineDistances();
    line.visible = true;
  }

  setPrediction(pred) {
    const G = this.guides;
    if (!pred) {
      for (const l of Object.values(G)) l.visible = false;
      this.ghost.visible = false;
      this.endGhost.visible = false;
      return;
    }
    this.setLine(G.cue, pred.cueBefore);
    this.setLine(G.cueAfter, pred.cueAfter);
    this.setLine(G.obj, pred.obj);
    this.setLine(G.obj2, pred.obj2);
    this.ghost.visible = !!pred.ghost;
    this.endGhost.visible = !!pred.end;
    if (pred.end) this.endGhost.position.set(pred.end[0], R, pred.end[1]);
    if (pred.ghost) this.ghost.position.set(pred.ghost[0], R, pred.ghost[1]);
  }

  // Raycast auf Tuchebene (y = R) bzw. auf Kugeln
  pickTable(ndcX, ndcY) {
    this.raycaster.setFromCamera({ x: ndcX, y: ndcY }, this.camera);
    const r = this.raycaster.ray;
    if (Math.abs(r.direction.y) < 1e-6) return null;
    const t = (R - r.origin.y) / r.direction.y;
    if (t < 0) return null;
    return [r.origin.x + r.direction.x * t, r.origin.z + r.direction.z * t];
  }

  pickBall(ndcX, ndcY) {
    this.raycaster.setFromCamera({ x: ndcX, y: ndcY }, this.camera);
    const hits = this.raycaster.intersectObjects([...this.ballMeshes.values()].filter(m => m.visible), false);
    return hits.length ? hits[0].object.userData.ball : null;
  }

  // Nächstes render() zeichnet auf jeden Fall (z. B. nach Größenänderung)
  invalidate() { this.dirty = true; }

  // Alles, was sich zwischen zwei Bildern sichtbar ändern kann, als Zahlenliste
  signature() {
    const s = this.sig;
    s.length = 0;
    const obj = o => {
      s.push(o.visible ? 1 : 0);
      if (o.visible) s.push(o.position.x, o.position.y, o.position.z, o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w);
    };
    const c = this.camera;
    s.push(c.position.x, c.position.y, c.position.z, c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w,
      c.projectionMatrix.elements[0], c.projectionMatrix.elements[5]);
    obj(this.cue);
    const cueEnd = s.length;
    for (const m of this.ballMeshes.values()) obj(m);
    obj(this.ghost); obj(this.endGhost);
    s.push(this.dArea.visible ? 1 : 0, this.lamps.visible ? 1 : 0);
    for (const l of Object.values(this.guides)) s.push(l.visible ? l.geometry.id : -1);
    return cueEnd;
  }

  // Zeichnet nur, wenn sich seit dem letzten Bild etwas geändert hat; ein ruhender Tisch kostet so fast nichts
  render() {
    const cueEnd = this.signature();
    const s = this.sig, last = this.lastSig;
    let changed = this.dirty || s.length !== last.length, cueChanged = changed;
    for (let i = 0; i < s.length && !changed; i++) changed = Math.abs(s[i] - last[i]) > 1e-6;
    if (!changed) return false;
    for (let i = 9; i < cueEnd && !cueChanged; i++) cueChanged = Math.abs(s[i] - last[i]) > 1e-6;
    if (cueChanged) this.renderer.shadowMap.needsUpdate = true;
    this.sig = last;
    this.lastSig = s;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
    return true;
  }
}

export { MAX_TIP };
