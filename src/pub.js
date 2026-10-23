// Hintergrund: ein dunkler Pub rund um den Tisch – Dielenboden, Holzvertäfelung, Tapete, Balkendecke,
// Theke mit Flaschenregal und Spiegel, Wandleuchten, Bilder, Fenster und ein Queue-Ständer.
// Bewusst gedämpft, damit nichts vom Spiel ablenkt. Ohne zusätzliche Lichtquellen (die würden jede
// Oberfläche im Bild teurer machen): Leuchten glühen selbst und werfen gemalte Lichtkegel an die Wand.
import * as THREE from 'three';

const FLOOR = -0.86, CEIL = 2.6;   // Höhe von Boden und Decke
const RX = 4.0, RZ = 5.0;          // halbe Raumgröße (Wände)
const WAINSCOT = 1.0;              // Höhe der Holzvertäfelung über dem Boden

function canvasTexture(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  return t;
}

// Holzvertäfelung: senkrechte Bretter mit Fugen, oben eine Abschlussleiste
const panelTexture = () => canvasTexture(256, 256, (g, w, h) => {
  g.fillStyle = '#2a170e'; g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 32) {
    g.fillStyle = `rgba(${40 + Math.random() * 20},${22 + Math.random() * 10},${10 + Math.random() * 6},0.6)`;
    g.fillRect(x + 1, 0, 30, h);
    for (let i = 0; i < 6; i++) {
      g.strokeStyle = `rgba(15,7,3,${0.15 + Math.random() * 0.2})`;
      g.beginPath(); const xx = x + 3 + Math.random() * 26; g.moveTo(xx, 0); g.lineTo(xx + (Math.random() - 0.5) * 6, h); g.stroke();
    }
    g.fillStyle = '#110804'; g.fillRect(x, 0, 2, h);
  }
  g.fillStyle = '#1a0d07'; g.fillRect(0, 0, w, 10);
}, [8, 1]);

// Tapete: dunkles Grün mit feinen Streifen und einem gedämpften Muster
const wallpaperTexture = () => canvasTexture(128, 128, (g, w, h) => {
  g.fillStyle = '#13211a'; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(40,60,45,0.35)';
  for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 3, h);
  g.fillStyle = 'rgba(70,80,50,0.18)';
  for (const [x, y] of [[8, 16], [40, 48], [72, 16], [104, 48], [8, 80], [40, 112], [72, 80], [104, 112]]) {
    g.beginPath(); g.ellipse(x, y, 5, 9, 0, 0, Math.PI * 2); g.fill();
  }
}, [12, 2]);

// Dielenboden
const floorTexture = () => canvasTexture(512, 512, (g, w, h) => {
  g.fillStyle = '#241409'; g.fillRect(0, 0, w, h);
  const row = 64;
  for (let y = 0; y < h; y += row) {
    let x = -Math.random() * 200;
    while (x < w) {
      const len = 180 + Math.random() * 220;
      g.fillStyle = `rgb(${34 + Math.random() * 16},${20 + Math.random() * 9},${10 + Math.random() * 6})`;
      g.fillRect(x + 1, y + 1, len - 2, row - 2);
      for (let i = 0; i < 5; i++) {
        g.strokeStyle = `rgba(12,6,2,${0.2 + Math.random() * 0.2})`;
        g.beginPath(); const yy = y + 4 + Math.random() * (row - 8); g.moveTo(x, yy); g.lineTo(x + len, yy + (Math.random() - 0.5) * 4); g.stroke();
      }
      x += len;
    }
  }
}, [6, 6]);

// Warmer Lichtkegel einer Wandleuchte (wird auf die Wand gelegt)
const glowTexture = () => canvasTexture(128, 256, (g, w, h) => {
  // Elliptischer Verlauf, der zu allen Rändern hin vollständig ausläuft (keine sichtbaren Kanten)
  g.setTransform(1, 0, 0, 2, 0, 0);
  const r = g.createRadialGradient(w / 2, h * 0.2, 2, w / 2, h * 0.22, w * 0.48);
  r.addColorStop(0, 'rgba(255,190,120,0.55)');
  r.addColorStop(0.35, 'rgba(255,160,90,0.18)');
  r.addColorStop(1, 'rgba(255,140,70,0)');
  g.fillStyle = r; g.fillRect(0, 0, w, h / 2);
});

// Bild im Rahmen: dunkle, unscharfe Landschaft bzw. ein altes Snooker-Motiv
const paintingTexture = (seed) => canvasTexture(128, 96, (g, w, h) => {
  const hue = [28, 140, 210][seed % 3];
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, `hsl(${hue},25%,14%)`); bg.addColorStop(1, `hsl(${hue + 20},30%,7%)`);
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = `hsla(${hue + 40},30%,22%,0.6)`;
  if (seed % 2) { g.fillRect(20, 50, 88, 26); g.fillStyle = 'rgba(200,190,160,0.5)'; g.beginPath(); g.arc(60, 58, 4, 0, 7); g.fill(); }
  else { g.beginPath(); g.moveTo(0, 70); g.quadraticCurveTo(50, 40, 128, 62); g.lineTo(128, 96); g.lineTo(0, 96); g.fill(); }
});

export function buildPub(scene, envMap) {
  const group = new THREE.Group();
  group.name = 'pub';
  scene.add(group);
  // Alle Materialien merken, damit das Intro den Raum aus dem Schwarz einblenden kann
  const mats = [];
  const mat = (params, Type = THREE.MeshStandardMaterial) => {
    const m = new Type(params);
    mats.push({ m, color: m.color.clone(), emissive: m.emissive ? m.emissive.clone() : null });
    return m;
  };
  // Decke, Balken und Deckenleiste in eigener Gruppe: werden ausgeblendet, sobald die Kamera darüber
  // steht (TV-Hauptkamera, Draufsicht), sonst lägen sie quer im Bild
  const ceilingGroup = new THREE.Group();
  group.add(ceilingGroup);
  const add = (geo, m, x, y, z, ry = 0, parent = group) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    parent.add(mesh);
    return mesh;
  };
  const H = CEIL - FLOOR;

  // Wände: unten Vertäfelung, darüber Tapete, dazwischen eine Leiste (Normalen zeigen nach innen)
  const panel = mat({ map: panelTexture(), roughness: 0.75 });
  const paper = mat({ map: wallpaperTexture(), roughness: 0.95 });
  const trim = mat({ color: 0x1c0e07, roughness: 0.5 });
  const walls = [
    [2 * RX, 0, -RZ, 0], [2 * RX, 0, RZ, Math.PI], [2 * RZ, -RX, 0, Math.PI / 2], [2 * RZ, RX, 0, -Math.PI / 2],
  ];
  for (const [len, x, z, ry] of walls) {
    add(new THREE.PlaneGeometry(len, WAINSCOT), panel, x, FLOOR + WAINSCOT / 2, z, ry);
    add(new THREE.PlaneGeometry(len, H - WAINSCOT), paper, x, FLOOR + WAINSCOT + (H - WAINSCOT) / 2, z, ry);
    const rail = add(new THREE.BoxGeometry(len, 0.05, 0.04), trim, x, FLOOR + WAINSCOT, z, ry);
    rail.translateZ(0.02);
    const crown = add(new THREE.BoxGeometry(len, 0.08, 0.06), trim, x, CEIL - 0.04, z, ry, ceilingGroup);
    crown.translateZ(0.03);
  }
  // Decke mit Balken
  const ceiling = add(new THREE.PlaneGeometry(2 * RX, 2 * RZ), mat({ color: 0x120a06, roughness: 1 }), 0, CEIL, 0, 0, ceilingGroup);
  ceiling.rotation.x = Math.PI / 2;
  const beamMat = mat({ color: 0x1e1009, roughness: 0.8 });
  for (let z = -RZ + 1; z < RZ; z += 2) add(new THREE.BoxGeometry(2 * RX, 0.18, 0.16), beamMat, 0, CEIL - 0.09, z, 0, ceilingGroup);

  // Theke an der linken Längswand mit Flaschenregal und Spiegel
  const barX = -RX + 0.75, barLen = 4.2;
  const barWood = mat({ color: 0x3a1c10, roughness: 0.45 });
  const barTop = mat({ color: 0x24110a, roughness: 0.25, metalness: 0.1 });
  add(new THREE.BoxGeometry(0.6, 1.05, barLen), barWood, barX, FLOOR + 0.525, 0);
  add(new THREE.BoxGeometry(0.72, 0.05, barLen + 0.1), barTop, barX, FLOOR + 1.075, 0);
  const brass = mat({ color: 0x8a6a2a, metalness: 1, roughness: 0.35, envMap });
  const footRail = add(new THREE.CylinderGeometry(0.02, 0.02, barLen, 10), brass, barX + 0.38, FLOOR + 0.22, 0);
  footRail.rotation.x = Math.PI / 2;
  // Hocker
  const stoolSeat = mat({ color: 0x2a0f0b, roughness: 0.6 });
  for (const z of [-1.5, -0.5, 0.5, 1.5]) {
    add(new THREE.CylinderGeometry(0.19, 0.19, 0.06, 20), stoolSeat, barX + 0.65, FLOOR + 0.74, z);
    add(new THREE.CylinderGeometry(0.025, 0.04, 0.72, 8), brass, barX + 0.65, FLOOR + 0.36, z);
  }
  // Spiegel und Regale hinter der Theke
  const mirror = add(new THREE.PlaneGeometry(barLen - 0.4, 0.9), mat({ color: 0x23272b, metalness: 1, roughness: 0.15, envMap, envMapIntensity: 0.35 }), -RX + 0.01, FLOOR + 1.75, 0, Math.PI / 2);
  mirror.renderOrder = -1;
  const shelfMat = mat({ color: 0x2b150c, roughness: 0.6 });
  const bottleGeo = new THREE.CylinderGeometry(0.035, 0.04, 0.26, 10).translate(0, 0.13, 0);
  const bottleMat = mat({ color: 0xffffff, roughness: 0.15, metalness: 0.1, envMap, envMapIntensity: 0.6 });
  const shelves = [FLOOR + 1.35, FLOOR + 1.7, FLOOR + 2.05];
  const bottles = new THREE.InstancedMesh(bottleGeo, bottleMat, shelves.length * 18);
  const glass = [0x2e4a1c, 0x5a2a10, 0x1d2f3f, 0x6a5418, 0x3b1420, 0x24331f];
  let n = 0;
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  for (const y of shelves) {
    add(new THREE.BoxGeometry(0.22, 0.03, barLen - 0.3), shelfMat, -RX + 0.12, y, 0);
    for (let i = 0; i < 18; i++) {
      const z = -barLen / 2 + 0.35 + i * (barLen - 0.7) / 17 + (Math.random() - 0.5) * 0.05;
      const s = 0.8 + Math.random() * 0.45;
      m4.makeScale(1, s, 1).setPosition(-RX + 0.12, y + 0.015, z);
      bottles.setMatrixAt(n, m4);
      bottles.setColorAt(n++, col.setHex(glass[Math.floor(Math.random() * glass.length)]).multiplyScalar(0.8));
    }
  }
  group.add(bottles);

  // Wandleuchten mit warmem Schein (ohne echtes Licht)
  const glowTex = glowTexture();
  const shadeMat = mat({ color: 0x000000, emissive: 0xffb060, emissiveIntensity: 0.9 });
  const glowMat = mat({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }, THREE.MeshBasicMaterial);
  const sconce = (x, z, ry) => {
    const ux = Math.sin(ry), uz = Math.cos(ry); // Richtung von der Wand in den Raum
    const y = FLOOR + 1.85;
    add(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 10), brass, x + ux * 0.04, y - 0.06, z + uz * 0.04);
    add(new THREE.CylinderGeometry(0.05, 0.08, 0.11, 16, 1, true), shadeMat, x + ux * 0.1, y, z + uz * 0.1);
    add(new THREE.PlaneGeometry(1.1, 2.2), glowMat, x + ux * 0.012, y - 0.15, z + uz * 0.012, ry);
  };
  for (const z of [-3, -1, 1, 3]) sconce(RX, z, -Math.PI / 2);   // rechte Längswand
  for (const x of [-2.4, 2.4]) { sconce(x, -RZ, 0); sconce(x, RZ, Math.PI); }

  // Bilder in Goldrahmen
  const frameMat = mat({ color: 0x5a4419, metalness: 0.8, roughness: 0.45, envMap });
  const picture = (x, z, ry, w, h, seed) => {
    const f = add(new THREE.BoxGeometry(w + 0.08, h + 0.08, 0.03), frameMat, x, FLOOR + 1.75, z, ry);
    f.translateZ(0.015);
    const p = add(new THREE.PlaneGeometry(w, h), mat({ map: paintingTexture(seed), roughness: 0.9 }), x, FLOOR + 1.75, z, ry);
    p.translateZ(0.032);
  };
  picture(RX, -2, -Math.PI / 2, 0.7, 0.5, 0);
  picture(RX, 2, -Math.PI / 2, 0.7, 0.5, 1);
  picture(0, -RZ, 0, 1.1, 0.75, 2);
  picture(-1.2, RZ, Math.PI, 0.6, 0.45, 3);

  // Fenster mit nächtlichem Licht an der rechten Wand
  const win = add(new THREE.PlaneGeometry(1.0, 1.1), mat({ color: 0x000000, emissive: 0x16243a, emissiveIntensity: 0.9 }), RX - 0.01, FLOOR + 1.7, 0, -Math.PI / 2);
  win.renderOrder = -1;
  for (const [w, h, dy, dz] of [[1.08, 0.05, 0.55, 0], [1.08, 0.05, -0.55, 0], [0.05, 1.12, 0, 0.52], [0.05, 1.12, 0, -0.52], [0.04, 1.1, 0, 0], [1.0, 0.04, 0.05, 0]]) {
    add(new THREE.BoxGeometry(0.03, h, w), trim, RX - 0.02, FLOOR + 1.7 + dy, dz);
  }

  // Queue-Ständer an der Baulk-Wand
  const rackMat = mat({ color: 0x2b140b, roughness: 0.5 });
  add(new THREE.BoxGeometry(1.0, 0.06, 0.08), rackMat, 1.3, FLOOR + 0.25, RZ - 0.04);
  add(new THREE.BoxGeometry(1.0, 0.06, 0.08), rackMat, 1.3, FLOOR + 1.35, RZ - 0.04);
  const cueMat = mat({ color: 0x6b4a26, roughness: 0.5 });
  for (let i = 0; i < 6; i++) {
    const cue = add(new THREE.CylinderGeometry(0.006, 0.014, 1.45, 8), cueMat, 0.9 + i * 0.16, FLOOR + 0.75, RZ - 0.07);
    cue.rotation.z = 0.02;
  }

  // Einblenden aus dem Schwarz (Intro): Farben und Leuchten skalieren, ohne Shader neu zu bauen
  const setFade = (e) => {
    group.visible = e > 0;
    for (const { m, color, emissive } of mats) {
      m.color.copy(color).multiplyScalar(e);
      if (emissive) m.emissive.copy(emissive).multiplyScalar(e);
    }
  };
  // Pro Bild: Decke nur zeigen, solange die Kamera darunter ist
  const update = camera => { ceilingGroup.visible = camera.position.y < CEIL - 0.25; };
  return { group, setFade, update, floorMap: floorTexture() };
}
