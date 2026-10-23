// Abmessungen nach WPBSA-Norm (12-ft-Tisch), alle Werte in Metern / SI-Einheiten.
export const BALL_R = 0.02625;
export const TABLE_L = 3.569;   // Spielfläche Länge (z-Achse, -z = Kopfbande / Schwarz)
export const TABLE_W = 1.778;   // Spielfläche Breite (x-Achse)
export const BAULK_Z = TABLE_L / 2 - 0.737;
export const D_RADIUS = 0.292;
export const PINK_SPOT_Z = -TABLE_L / 4;
export const BLACK_SPOT_Z = -TABLE_L / 2 + 0.324;

// Banden und Holzrahmen (Höhe über dem Tuch, Breite ab Bandennase)
export const CUSHION_HEIGHT = 0.042;
export const CUSHION_WIDTH = 0.05;
export const RAIL_HEIGHT = 0.046;
export const RAIL_WIDTH = 0.108;

export const CORNER_MOUTH = 0.092;   // Öffnung Ecktasche zwischen den Bandennasen
export const MIDDLE_MOUTH = 0.112;   // Öffnung Mitteltasche

// Vom Baulk-Ende aus gesehen: Grün links, Braun Mitte, Gelb rechts ("God Bless You").
export const COLOURS = [
  { name: 'yellow', label: 'Gelb', value: 2, color: 0xf2c91a, spot: [D_RADIUS, BAULK_Z] },
  { name: 'green', label: 'Grün', value: 3, color: 0x0a5a2a, spot: [-D_RADIUS, BAULK_Z] },
  { name: 'brown', label: 'Braun', value: 4, color: 0x6a3418, spot: [0, BAULK_Z] },
  { name: 'blue', label: 'Blau', value: 5, color: 0x1240b0, spot: [0, 0] },
  { name: 'pink', label: 'Pink', value: 6, color: 0xf27aa6, spot: [0, PINK_SPOT_Z] },
  { name: 'black', label: 'Schwarz', value: 7, color: 0x0c0c0c, spot: [0, BLACK_SPOT_Z] },
];
export const COLOUR_ORDER = COLOURS.map(c => c.name);
export const RED_COLOR = 0xb00d18;

export const PHYS = {
  g: 9.81,
  muSlide: 0.2875,   // Gleitreibung Kugel/Tuch (Übergang Gleiten -> Rollen)
  muRoll: 0.016,     // Rollwiderstand
  rollSoft: 0.04,    // unterhalb etwa dieses Tempos (m/s) lässt der Rollwiderstand nach: weiches Auslaufen
  rollDrag: 0.018,   // geschwindigkeitsabhängiger Anteil des Rollwiderstands (1/s)
  spinDecel: 12.65,  // Abbau Seiteneffet durch Bohrreibung (rad/s²)
  eBall: 0.95,       // Stoßzahl Kugel/Kugel
  muBall: 0.06,      // Reibung Kugel/Kugel (Throw, Effetübertragung)
  muCushion: 0.12,   // Reibung Kugel/Bande (wie stark der Effet an der Bande greift)
  cushionSideGrip: 0.075, // zusätzlicher Griff der Bande nur für Seiteneffet (stärkere Winkeländerung)
  cushionNose: 1.27, // Höhe der Bandennase in Kugelradien
  squirt: 0.022,     // Ablenkung durch Seiteneffet (rad pro Radius Versatz)
  swerve: 1.5e-4,    // Kurve der Weißen durch Seiteneffet (m/s² pro rad/s)
  maxSpeed: 6.2,     // m/s bei 100 % Stoßstärke
  maxSpin: 1.1,      // max. Spin am äußersten Treffpunkt (Umfangs- / Kugelgeschwindigkeit), gilt für Zug, Nachlauf und Effet
  dt: 0.0005,
};
export const MAX_TIP = 0.62; // max. Versatz des Treffpunkts (in Kugelradien) vor Kicks
