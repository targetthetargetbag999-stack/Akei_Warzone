const { PLAYER, WEAPONS, ZONE, TICK_MS, MAP_HALF, LOBBY } = require('./constants');
const SafeZone = require('./zone');
const { spawnLoot } = require('./loot');
const { v4: uuidv4 } = require('uuid');

const STATES = { LOBBY: 'lobby', COUNTDOWN: 'countdown', ACTIVE: 'active', ENDED: 'ended' };

class Match {
  constructor(io, matchId, supabase) {
    this.io = io;
    this.id = matchId;
    this.supabase = supabase;
    this.state = STATES.LOBBY;
    this.players = {};   // socketId -> player
    this.loot = {};
    this.zone = new SafeZone();
    this.tickInterval = null;
    this.startAt = null;
    this.kills = {};     // socketId -> count
    this.aliveCount = 0;
  }

  // ── Lobby ──────────────────────────────────────────────────────────────────

  addPlayer(socket, username) {
    const spawnX = (Math.random() - 0.5) * 800;
    const spawnZ = (Math.random() - 0.5) * 800;

    this.players[socket.id] = {
      id: socket.id,
      username,
      x: spawnX, y: 2, z: spawnZ,
      rotY: 0, pitch: 0,
      hp: PLAYER.MAX_HP,
      shield: 0,
      alive: true,
      weapon: null,
      ammo: 0,
      kills: 0,
      lastShot: 0,
      reloading: false,
      reloadEnd: 0,
    };
    this.kills[socket.id] = 0;

    socket.join(this.id);
    socket.emit('matchJoined', {
      matchId: this.id,
      playerId: socket.id,
      state: this.state,
      players: this._publicPlayers(),
      loot: this.loot,
      zone: this.zone.getState(),
    });

    this.io.to(this.id).emit('playerJoined', { id: socket.id, username });
    this._checkCountdown();
  }

  removePlayer(socketId) {
    if (this.players[socketId]) {
      this.players[socketId].alive = false;
      delete this.players[socketId];
      this.io.to(this.id).emit('playerLeft', { id: socketId });
      this._checkAlive();
    }
  }

  _checkCountdown() {
    const count = Object.keys(this.players).length;
    if (count >= LOBBY.MIN_PLAYERS && this.state === STATES.LOBBY) {
      this.state = STATES.COUNTDOWN;
      this.startAt = Date.now() + LOBBY.COUNTDOWN_SECS * 1000;
      this.io.to(this.id).emit('countdown', { seconds: LOBBY.COUNTDOWN_SECS, startAt: this.startAt });
      this._countdownTimer = setTimeout(() => this._startMatch(), LOBBY.COUNTDOWN_SECS * 1000);
    }
  }

  // ── Match start ────────────────────────────────────────────────────────────

  _startMatch() {
    this.state = STATES.ACTIVE;
    this.loot = spawnLoot();
    this.zone.start();
    this.aliveCount = Object.keys(this.players).length;

    this.io.to(this.id).emit('matchStart', {
      loot: this.loot,
      zone: this.zone.getState(),
      players: this._publicPlayers(),
    });

    this.tickInterval = setInterval(() => this._tick(), TICK_MS);
  }

  // ── Game tick ──────────────────────────────────────────────────────────────

  _tick() {
    if (this.state !== STATES.ACTIVE) return;

    this.zone.tick();

    const now = Date.now();
    const updates = {};

    for (const [id, p] of Object.entries(this.players)) {
      if (!p.alive) continue;

      // Zone damage
      if (!this.zone.isInsideZone(p.x, p.z)) {
        p.hp -= ZONE.DAMAGE_PER_TICK;
        if (p.hp <= 0) this._killPlayer(id, null, 'zone');
      }

      // Reload finish
      if (p.reloading && now >= p.reloadEnd) {
        p.reloading = false;
        if (p.weapon) p.ammo = WEAPONS[p.weapon].ammo;
      }

      updates[id] = { x: p.x, y: p.y, z: p.z, rotY: p.rotY, pitch: p.pitch, hp: p.hp, shield: p.shield, alive: p.alive };
    }

    this.io.to(this.id).emit('tick', { updates, zone: this.zone.getState() });
  }

  // ── Player actions ─────────────────────────────────────────────────────────

  handleMove(socketId, data) {
    const p = this.players[socketId];
    if (!p || !p.alive) return;
    p.x = clamp(data.x, -MAP_HALF, MAP_HALF);
    p.y = Math.max(0, data.y);
    p.z = clamp(data.z, -MAP_HALF, MAP_HALF);
    p.rotY = data.rotY;
    p.pitch = data.pitch;
  }

  handleShoot(socketId, data) {
    const shooter = this.players[socketId];
    if (!shooter || !shooter.alive || !shooter.weapon) return;

    const now = Date.now();
    const wDef = WEAPONS[shooter.weapon];
    if (now - shooter.lastShot < wDef.fireRate) return;
    if (shooter.ammo <= 0 || shooter.reloading) return;

    shooter.lastShot = now;

    if (shooter.weapon === 'SHOTGUN') {
      for (let i = 0; i < wDef.pellets; i++) {
        this._raycast(socketId, data, wDef, wDef.damage);
      }
    } else {
      this._raycast(socketId, data, wDef, wDef.damage);
    }

    shooter.ammo--;
    if (shooter.ammo <= 0) this._startReload(socketId);

    this.io.to(this.id).emit('shotFired', {
      id: socketId,
      ox: data.ox, oy: data.oy, oz: data.oz,
      dx: data.dx, dy: data.dy, dz: data.dz,
      weapon: shooter.weapon,
    });
  }

  _raycast(shooterId, data, wDef, damage) {
    const { ox, oy, oz, dx, dy, dz } = data;
    const spread = wDef.spread;
    const rdx = dx + (Math.random() - 0.5) * spread;
    const rdy = dy + (Math.random() - 0.5) * spread;
    const rdz = dz + (Math.random() - 0.5) * spread;
    const len = Math.sqrt(rdx * rdx + rdy * rdy + rdz * rdz);
    const nx = rdx / len, ny = rdy / len, nz = rdz / len;

    let closest = null, closestDist = wDef.range;

    for (const [id, p] of Object.entries(this.players)) {
      if (id === shooterId || !p.alive) continue;
      const dist = rayBoxIntersect(ox, oy, oz, nx, ny, nz,
        p.x, p.y + PLAYER.HEIGHT / 2, p.z, PLAYER.RADIUS, PLAYER.HEIGHT);
      if (dist !== null && dist < closestDist) {
        closest = id; closestDist = dist;
      }
    }

    if (closest) {
      const victim = this.players[closest];
      let dmg = damage;
      if (victim.shield > 0) {
        const absorbed = Math.min(victim.shield, dmg * 0.5);
        victim.shield -= absorbed;
        dmg -= absorbed;
      }
      victim.hp -= dmg;
      this.io.to(this.id).emit('playerHit', { id: closest, hp: victim.hp, shield: victim.shield, by: shooterId });
      if (victim.hp <= 0) this._killPlayer(closest, shooterId, 'combat');
    }
  }

  handleReload(socketId) {
    const p = this.players[socketId];
    if (!p || !p.weapon || p.reloading) return;
    this._startReload(socketId);
  }

  _startReload(socketId) {
    const p = this.players[socketId];
    if (!p || !p.weapon) return;
    p.reloading = true;
    p.reloadEnd = Date.now() + WEAPONS[p.weapon].reloadTime;
    this.io.to(socketId).emit('reloading', { duration: WEAPONS[p.weapon].reloadTime });
  }

  handlePickup(socketId, itemId) {
    const p = this.players[socketId];
    const item = this.loot[itemId];
    if (!p || !p.alive || !item) return;

    const dx = p.x - item.x, dz = p.z - item.z;
    if (Math.sqrt(dx * dx + dz * dz) > 5) return; // too far

    if (item.type === 'weapon') {
      p.weapon = item.weapon;
      p.ammo = item.ammo;
    } else if (item.type === 'ammo') {
      p.ammo = Math.min(p.ammo + item.amount, WEAPONS[p.weapon]?.ammo * 3 || 90);
    } else if (item.type === 'heal') {
      p.hp = Math.min(PLAYER.MAX_HP, p.hp + item.amount);
    } else if (item.type === 'shield') {
      p.shield = Math.min(100, p.shield + item.amount);
    }

    delete this.loot[itemId];
    this.io.to(this.id).emit('itemPickedUp', { itemId, playerId: socketId, player: { hp: p.hp, shield: p.shield, weapon: p.weapon, ammo: p.ammo } });
  }

  // ── Kill / end ─────────────────────────────────────────────────────────────

  _killPlayer(victimId, killerId, cause) {
    const victim = this.players[victimId];
    if (!victim || !victim.alive) return;
    victim.alive = false;
    victim.hp = 0;
    this.aliveCount--;

    if (killerId && this.players[killerId]) {
      this.players[killerId].kills++;
      this.kills[killerId] = (this.kills[killerId] || 0) + 1;
    }

    this.io.to(this.id).emit('playerDied', {
      id: victimId,
      username: victim.username,
      killerId,
      cause,
      aliveCount: this.aliveCount,
    });

    this._checkAlive();
  }

  _checkAlive() {
    const alive = Object.values(this.players).filter(p => p.alive);
    if (alive.length <= 1 && this.state === STATES.ACTIVE) {
      const winner = alive[0] || null;
      this._endMatch(winner);
    }
  }

  async _endMatch(winner) {
    this.state = STATES.ENDED;
    clearInterval(this.tickInterval);

    const results = Object.values(this.players).map(p => ({
      id: p.id,
      username: p.username,
      kills: p.kills,
      alive: p.alive,
    }));

    this.io.to(this.id).emit('matchEnd', { winner: winner ? { id: winner.id, username: winner.username } : null, results });

    // Save to Supabase
    if (this.supabase) {
      try {
        await this.supabase.from('matches').insert({
          match_id: this.id,
          winner: winner?.username || null,
          player_count: results.length,
          results: results,
          ended_at: new Date().toISOString(),
        });
        // Upsert per-player stats
        for (const r of results) {
          await this.supabase.rpc('upsert_player_stats', {
            p_username: r.username,
            p_kills: r.kills,
            p_won: r.username === winner?.username,
          });
        }
      } catch (e) {
        console.error('Supabase save error:', e.message);
      }
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  _publicPlayers() {
    return Object.fromEntries(
      Object.entries(this.players).map(([id, p]) => [id, {
        id: p.id, username: p.username,
        x: p.x, y: p.y, z: p.z, rotY: p.rotY,
        hp: p.hp, shield: p.shield, alive: p.alive, weapon: p.weapon,
      }])
    );
  }

  get playerCount() { return Object.keys(this.players).length; }
}

// Simple AABB ray intersection
function rayBoxIntersect(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, h) {
  const minX = cx - r, maxX = cx + r;
  const minY = cy - h / 2, maxY = cy + h / 2;
  const minZ = cz - r, maxZ = cz + r;
  let tMin = -Infinity, tMax = Infinity;

  for (const [o, d, mn, mx] of [[ox, dx, minX, maxX], [oy, dy, minY, maxY], [oz, dz, minZ, maxZ]]) {
    if (Math.abs(d) < 1e-8) {
      if (o < mn || o > mx) return null;
    } else {
      const t1 = (mn - o) / d, t2 = (mx - o) / d;
      tMin = Math.max(tMin, Math.min(t1, t2));
      tMax = Math.min(tMax, Math.max(t1, t2));
    }
  }
  return tMax >= tMin && tMax >= 0 ? Math.max(0, tMin) : null;
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

module.exports = { Match, STATES };
