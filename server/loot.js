const { LOOT_ITEMS, MAP_HALF, WEAPONS } = require('./constants');
const { v4: uuidv4 } = require('uuid');

const LOOT_COUNT = 120;

function weightedRandom(items) {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

function spawnLoot() {
  const items = {};
  for (let i = 0; i < LOOT_COUNT; i++) {
    const id = uuidv4().slice(0, 8);
    const template = weightedRandom(LOOT_ITEMS);
    const x = (Math.random() - 0.5) * (MAP_HALF * 2 - 40);
    const z = (Math.random() - 0.5) * (MAP_HALF * 2 - 40);
    const item = { id, x, z, y: 0.5, ...template, weight: undefined };
    if (template.type === 'weapon') {
      item.weaponData = WEAPONS[template.weapon];
      item.ammo = WEAPONS[template.weapon].ammo;
    }
    items[id] = item;
  }
  return items;
}

module.exports = { spawnLoot };
