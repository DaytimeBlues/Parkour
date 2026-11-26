// Classroom candidate tuning. Only the historical Fox claim duration has a source baseline.
const defaults = Object.freeze({
  captureSeconds: 3, roundSeconds: 180, pointsPerCapture: 1,
  contestMode: 'reset', allowRecapture: true, holdScoreSeconds: null, pointsPerHold: 1
});

export function loadRules(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Expected match rules object');
  for (const key of Object.keys(raw)) {
    if (!Object.hasOwn(defaults, key)) throw new TypeError('Unknown match rule: ' + key);
  }
  const rules = { ...defaults, ...raw };
  for (const key of ['captureSeconds', 'roundSeconds', 'holdScoreSeconds']) {
    const value = rules[key];
    if (key === 'holdScoreSeconds' && value === null) continue;
    if (!Number.isFinite(value) || value < 0.1 || value > 3600) {
      throw new RangeError('Expected seconds from 0.1 through 3600: ' + key);
    }
  }
  for (const key of ['pointsPerCapture', 'pointsPerHold']) {
    const value = rules[key];
    if (!Number.isSafeInteger(value) || value < 0 || value > 1000) {
      throw new RangeError('Expected points from 0 through 1000: ' + key);
    }
  }
  if (!['reset', 'pause'].includes(rules.contestMode) || typeof rules.allowRecapture !== 'boolean') {
    throw new RangeError('Invalid contestMode or allowRecapture rule');
  }
  return Object.freeze(rules);
}

function validId(value) {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

function vector(value) {
  return Array.isArray(value) && value.length === 3 && [0, 1, 2].every(i => Number.isFinite(value[i]));
}

function sortedById(a, b) {
  return a.id < b.id ? -1 : Number(a.id > b.id);
}

function clearClaim(base) {
  base.claimant = null;
  base.holdSeconds = 0;
}

export class Match {
  constructor(bases, rules) {
    this.rules = loadRules(rules);
    if (!Array.isArray(bases) || !bases.length) throw new Error('Map requires authored bases');
    const ids = new Set();
    this.bases = Array.from(bases, base => {
      if (!base || !validId(base.id) || ids.has(base.id)) throw new Error('Invalid or duplicate base ID');
      if (!vector(base.min) || !vector(base.max) || base.min.some((v, i) => v >= base.max[i])) {
        throw new Error('Invalid capture bounds for ' + base.id);
      }
      ids.add(base.id);
      return { id: base.id, min: [...base.min], max: [...base.max] };
    }).sort(sortedById);
    this.reset();
  }

  reset() {
    this.elapsedSeconds = 0;
    this.scores = new Map();
    this.finished = false;
    for (const base of this.bases) {
      base.owner = null;
      base.contested = false;
      base.ownedTime = 0;
      clearClaim(base);
    }
  }

  disconnect(id) {
    if (this.finished) return;
    for (const base of this.bases) {
      if (base.claimant === id) clearClaim(base);
    }
  }

  tick(delta, players) {
    if (this.finished) return;
    if (!Number.isFinite(delta) || delta <= 0) throw new RangeError('Expected positive physics delta');
    if (!Array.isArray(players)) throw new TypeError('Expected an authoritative seat list');
    const seen = new Set();
    for (const p of players) {
      if (!p || !validId(p.id) || seen.has(p.id) || !vector(p.position) || typeof p.grounded !== 'boolean') {
        throw new Error('Invalid or duplicate authoritative seat sample');
      }
      seen.add(p.id);
    }
    for (const id of seen) if (!this.scores.has(id)) this.scores.set(id, 0);
    const step = Math.min(delta, this.rules.roundSeconds - this.elapsedSeconds);
    const epsilon = Math.min(1e-9, step * 1e-6);
    for (const base of this.bases) {
      const occupants = players.filter(p => p.grounded && p.position.every((v, i) => v >= base.min[i] && v <= base.max[i]));
      base.contested = occupants.length > 1;
      if (base.owner && !base.contested && this.rules.holdScoreSeconds !== null) {
        base.ownedTime += step;
        const intervals = Math.floor((base.ownedTime + epsilon) / this.rules.holdScoreSeconds);
        if (intervals) {
          base.ownedTime = Math.max(0, base.ownedTime - intervals * this.rules.holdScoreSeconds);
          this.scores.set(base.owner, this.scores.get(base.owner) + this.rules.pointsPerHold * intervals);
        }
      }
      if (base.contested && this.rules.contestMode === 'pause') continue;
      if (occupants.length !== 1 || occupants[0].id === base.owner ||
          (base.owner && !this.rules.allowRecapture)) {
        clearClaim(base);
        continue;
      }
      const id = occupants[0].id;
      if (base.claimant !== id) {
        clearClaim(base);
        base.claimant = id;
      }
      base.holdSeconds += step;
      if (base.holdSeconds + epsilon >= this.rules.captureSeconds) {
        base.owner = id;
        base.ownedTime = 0;
        this.scores.set(id, this.scores.get(id) + this.rules.pointsPerCapture);
        clearClaim(base);
      }
    }
    this.elapsedSeconds += step;
    if (this.elapsedSeconds + epsilon >= this.rules.roundSeconds) {
      this.elapsedSeconds = this.rules.roundSeconds;
      this.finished = true;
    }
  }

  snapshot() {
    const scores = Object.fromEntries([...this.scores].sort(([a], [b]) => a < b ? -1 : Number(a > b)));
    const highScore = Math.max(...this.scores.values());
    const leaders = this.finished ? Object.keys(scores).filter(id => scores[id] === highScore) : [];
    return {
      elapsedSeconds: this.elapsedSeconds,
      remainingSeconds: Math.max(0, this.rules.roundSeconds - this.elapsedSeconds),
      scores,
      bases: this.bases.map(base => ({
        id: base.id, owner: base.owner, claimant: base.claimant,
        progress: Math.min(1, base.holdSeconds / this.rules.captureSeconds), contested: base.contested
      })),
      finished: this.finished,
      winner: leaders.length === 1 ? leaders[0] : null,
      leaders
    };
  }
}
