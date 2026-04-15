const TICK_RATE = 20;
const TICK_MS = 1000 / TICK_RATE;
const MAP_SIZE = 1000;
const MAP_HALF = MAP_SIZE / 2;

const ZONE = {
  INITIAL_RADIUS: 480,
  MIN_RADIUS: 20,
  SHRINK_INTERVAL_MS: 30000,
  SHRINK_DURATION_MS: 15000,
  DAMAGE_PER_TICK: 2,
  STAGES: 6,
};

const PLAYER = {
  MAX_HP: 100,
  SPEED: 12,
  SPRINT_MULT: 1.6,
  JUMP_FORCE: 18,
  GRAVITY: -1.2,
  HEIGHT: 1.8,
  RADIUS: 0.4,
};

const WEAPONS = {
  AR: { name: 'Assault Rifle', damage: 22, range: 300, fireRate: 120, spread: 0.03, ammo: 30, reloadTime: 2000 },
  SHOTGUN: { name: 'Shotgun', damage: 18, pellets: 8, range: 60, fireRate: 800, spread: 0.18, ammo: 6, reloadTime: 2500 },
  SNIPER: { name: 'Sniper Rifle', damage: 95, range: 800, fireRate: 1500, spread: 0.001, ammo: 5, reloadTime: 3000 },
  PISTOL: { name: 'Pistol', damage: 28, range: 120, fireRate: 400, spread: 0.06, ammo: 12, reloadTime: 1200 },
};

const LOOT_ITEMS = [
  { type: 'weapon', weapon: 'AR', weight: 30 },
  { type: 'weapon', weapon: 'SHOTGUN', weight: 20 },
  { type: 'weapon', weapon: 'SNIPER', weight: 10 },
  { type: 'weapon', weapon: 'PISTOL', weight: 40 },
  { type: 'ammo', amount: 30, weight: 50 },
  { type: 'heal', amount: 30, weight: 35 },
  { type: 'shield', amount: 50, weight: 25 },
];

const LOBBY = {
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 24,
  COUNTDOWN_SECS: 10,
};

module.exports = { TICK_RATE, TICK_MS, MAP_SIZE, MAP_HALF, ZONE, PLAYER, WEAPONS, LOOT_ITEMS, LOBBY };
