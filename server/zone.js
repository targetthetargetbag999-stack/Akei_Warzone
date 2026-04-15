const { ZONE, MAP_SIZE } = require('./constants');

class SafeZone {
  constructor() {
    this.reset();
  }

  reset() {
    this.stage = 0;
    this.centerX = 0;
    this.centerZ = 0;
    this.currentRadius = ZONE.INITIAL_RADIUS;
    this.targetRadius = ZONE.INITIAL_RADIUS;
    this.nextCenterX = 0;
    this.nextCenterZ = 0;
    this.shrinking = false;
    this.shrinkStart = null;
    this.nextShrinkAt = null;
  }

  start() {
    this.nextShrinkAt = Date.now() + ZONE.SHRINK_INTERVAL_MS;
    this._planNextStage();
  }

  _planNextStage() {
    const factor = 1 - (this.stage + 1) / ZONE.STAGES;
    this.targetRadius = Math.max(ZONE.MIN_RADIUS, ZONE.INITIAL_RADIUS * factor * factor);
    const maxOffset = this.currentRadius * 0.4;
    this.nextCenterX = this.centerX + (Math.random() - 0.5) * 2 * maxOffset;
    this.nextCenterZ = this.centerZ + (Math.random() - 0.5) * 2 * maxOffset;
    const limit = (MAP_SIZE / 2) - this.targetRadius;
    this.nextCenterX = Math.max(-limit, Math.min(limit, this.nextCenterX));
    this.nextCenterZ = Math.max(-limit, Math.min(limit, this.nextCenterZ));
  }

  tick() {
    const now = Date.now();
    if (!this.shrinking && this.nextShrinkAt && now >= this.nextShrinkAt) {
      this.shrinking = true;
      this.shrinkStart = now;
      this.stage++;
    }
    if (this.shrinking) {
      const elapsed = now - this.shrinkStart;
      const t = Math.min(1, elapsed / ZONE.SHRINK_DURATION_MS);
      this.centerX = lerp(this.centerX, this.nextCenterX, t);
      this.centerZ = lerp(this.centerZ, this.nextCenterZ, t);
      this.currentRadius = lerp(this.currentRadius, this.targetRadius, t);
      if (t >= 1) {
        this.shrinking = false;
        if (this.stage < ZONE.STAGES) {
          this.nextShrinkAt = now + ZONE.SHRINK_INTERVAL_MS;
          this._planNextStage();
        } else {
          this.nextShrinkAt = null;
        }
      }
    }
  }

  isInsideZone(x, z) {
    const dx = x - this.centerX;
    const dz = z - this.centerZ;
    return Math.sqrt(dx * dx + dz * dz) <= this.currentRadius;
  }

  getState() {
    return {
      cx: Math.round(this.centerX * 10) / 10,
      cz: Math.round(this.centerZ * 10) / 10,
      radius: Math.round(this.currentRadius * 10) / 10,
      targetRadius: Math.round(this.targetRadius * 10) / 10,
      nextCx: Math.round(this.nextCenterX * 10) / 10,
      nextCz: Math.round(this.nextCenterZ * 10) / 10,
      shrinking: this.shrinking,
      stage: this.stage,
      nextShrinkIn: this.nextShrinkAt ? Math.max(0, this.nextShrinkAt - Date.now()) : null,
    };
  }
}

function lerp(a, b, t) { return a + (b - a) * t; }

module.exports = SafeZone;
