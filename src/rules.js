// Snooker-Regelwerk für ein Frame (zwei Spieler).
// "on": 'red' | 'colour' (nach gelochter Roter) | Name der Farbe in der Endsequenz.
import { COLOURS, COLOUR_ORDER } from './constants.js';

const LABEL = Object.fromEntries(COLOURS.map(c => [c.name, c.label]));
const VALUE = Object.fromEntries(COLOURS.map(c => [c.name, c.value]));

export function ballLabel(b) {
  return b.kind === 'red' ? 'Rot' : b.kind === 'cue' ? 'Weiß' : LABEL[b.name];
}

export class Frame {
  constructor(names, starter = 0) {
    this.names = names;
    this.scores = [0, 0];
    this.current = starter;
    this.on = 'red';
    this.breakPts = 0;
    this.highBreak = [0, 0];
    this.freeBall = false;
    this.ballInHand = true;
    this.over = false;
    this.winner = null;
    this.reBlack = false;
  }

  onLabel() {
    if (this.on === 'red') return 'Rot';
    if (this.on === 'colour') return 'Farbe';
    return LABEL[this.on];
  }

  isOn(b) {
    if (b.kind === 'cue') return false;
    if (this.on === 'red') return b.kind === 'red';
    if (this.on === 'colour') return b.kind === 'colour';
    return b.name === this.on;
  }

  pointsRemaining(balls) {
    const reds = balls.filter(b => b.kind === 'red' && b.onTable).length;
    if (reds > 0) return reds * 8 + 27 + (this.on === 'colour' ? 7 : 0);
    if (this.on === 'colour') return 7 + 27;
    let sum = 0;
    for (let i = COLOUR_ORDER.indexOf(this.on); i >= 0 && i < COLOUR_ORDER.length; i++) sum += VALUE[COLOUR_ORDER[i]];
    return sum;
  }

  // shot: { firstHit, potted: [Kugeln], cuePotted }
  evaluate(shot, balls) {
    const on = this.on, fh = shot.firstHit, potted = shot.potted;
    const redsLeft = balls.filter(b => b.kind === 'red' && b.onTable).length;
    const me = this.current, opp = 1 - me;
    const fouls = [], reasons = [];
    let freeBallBall = null, nominated = null;
    const onValue = on === 'red' ? 1 : on === 'colour' ? 4 : VALUE[on];

    if (!fh) {
      fouls.push(onValue);
      reasons.push('keine Kugel getroffen');
    } else if (on === 'red') {
      if (fh.kind === 'red') { /* ok */ }
      else if (this.freeBall) freeBallBall = fh;
      else { fouls.push(fh.value); reasons.push(`zuerst ${ballLabel(fh)} statt Rot getroffen`); }
    } else if (on === 'colour') {
      if (fh.kind === 'colour') nominated = fh; // erste getroffene Farbe gilt als angesagt
      else { fouls.push(1); reasons.push('Rot statt einer Farbe getroffen'); }
    } else {
      if (fh.name === on) { /* ok */ }
      else if (this.freeBall) freeBallBall = fh;
      else { fouls.push(fh.value, VALUE[on]); reasons.push(`zuerst ${ballLabel(fh)} statt ${LABEL[on]} getroffen`); }
    }

    let points = 0;
    for (const b of potted) {
      let legal;
      if (on === 'red') legal = b.kind === 'red' || b === freeBallBall;
      else if (on === 'colour') legal = !!nominated && b === nominated && potted.length === 1;
      else legal = b.name === on || b === freeBallBall;
      if (!legal) { fouls.push(b.value); reasons.push(`${ballLabel(b)} unerlaubt gelocht`); }
    }
    if (shot.cuePotted) { fouls.push(nominated ? nominated.value : onValue); reasons.push('Weiße gelocht'); }
    if (fouls.length && nominated) fouls.push(nominated.value);

    const foul = fouls.length > 0;
    const out = { foul, reasons, penalty: 0, points: 0, respot: [], potted, offender: me, messages: [] };

    if (!foul) {
      if (on === 'red') points = potted.filter(b => b.kind === 'red' || b === freeBallBall).length;
      else if (on === 'colour') points = potted.length ? nominated.value : 0;
      else if (potted.length) points = VALUE[on];
    }

    // Wiederaufsetzen
    const reBlackNeeded = () => this.scores[0] === this.scores[1];
    if (foul) {
      out.respot = potted.filter(b => b.kind === 'colour');
    } else if (on === 'red' || on === 'colour') {
      out.respot = potted.filter(b => b.kind === 'colour');
    } else {
      out.respot = potted.filter(b => b === freeBallBall && b.name !== on);
    }

    this.freeBall = false;
    this.ballInHand = !!shot.cuePotted;

    if (foul) {
      const pen = Math.max(4, ...fouls);
      out.penalty = pen;
      this.scores[opp] += pen;
      out.messages.push(`Foul (${reasons.join(', ')}): ${pen} Punkte für ${this.names[opp]}`);
      this.endBreak();
      const onlyBlack = on === 'black';
      if (onlyBlack) {
        out.respot = out.respot.filter(b => b.name !== 'black');
        if (!reBlackNeeded()) return this.finish(out);
        return this.respottedBlack(out);
      }
      this.on = redsLeft > 0 ? 'red' : (on === 'red' || on === 'colour') ? 'yellow' : on;
      this.current = opp;
      out.canPutBack = true;
      return out;
    }

    if (points > 0) {
      out.points = points;
      this.scores[me] += points;
      this.breakPts += points;
      this.highBreak[me] = Math.max(this.highBreak[me], this.breakPts);
      out.messages.push(`${this.names[me]}: +${points} (Break ${this.breakPts})`);
      if (on === 'red') this.on = 'colour';
      else if (on === 'colour') this.on = redsLeft > 0 ? 'red' : 'yellow';
      else if (potted.some(b => b.name === on)) {
        if (on === 'black') {
          if (!reBlackNeeded()) return this.finish(out);
          return this.respottedBlack(out);
        }
        this.on = COLOUR_ORDER[COLOUR_ORDER.indexOf(on) + 1];
      }
      return out;
    }

    // Kein Punkt: Aufnahme endet
    this.endBreak();
    this.on = redsLeft > 0 ? 'red' : (on === 'red' || on === 'colour') ? 'yellow' : on;
    this.current = opp;
    out.messages.push(`${this.names[opp]} ist am Tisch`);
    return out;
  }

  endBreak() { this.breakPts = 0; }

  finish(out) {
    this.over = true;
    this.winner = this.scores[0] > this.scores[1] ? 0 : 1;
    out.frameOver = true;
    out.messages.push(`Frame gewonnen von ${this.names[this.winner]} (${this.scores[0]}:${this.scores[1]})`);
    return out;
  }

  // Gleichstand nach letzter Schwarzer: Schwarz wird aufgesetzt, Los entscheidet, Ball in Hand
  respottedBlack(out) {
    this.reBlack = true;
    this.on = 'black';
    this.endBreak();
    this.current = Math.random() < 0.5 ? 0 : 1;
    this.ballInHand = true;
    out.reBlack = true;
    out.messages.push(`Gleichstand! Schwarz wird neu aufgesetzt – ${this.names[this.current]} beginnt mit Ball in Hand`);
    return out;
  }

  // Nach Foul: Gegner lässt den Verursacher erneut spielen
  putBack() {
    this.current = 1 - this.current;
  }
}
