const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e4 });

// index.html "public" klasöründe de olabilir, proje kökünde de.
const pubDir = path.join(__dirname, 'public');
if (fs.existsSync(path.join(pubDir, 'index.html'))) app.use(express.static(pubDir));
else app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ---------- AYARLAR ----------
const W = 1800, H = 1200;
const BASE = { x: 900, y: 600 };
const ZONE_R = 150;
const MAX_PLAYERS = 5;
const TICK = 40;
const NET_EVERY = 2;
const DT = 1 / TICK;
const PLAYER_SPEED = 190;
const DASH_SPEED = 640, DASH_CD = 1.6;
const BASE_HP = 500;
const SHOP_TIME = 25;
const MAX_ZOMBIES = 90;
const BOARD_FILE = path.join(__dirname, 'scores.json');

// col: istemcide renk/ses indeksi. mag = şarjör, rl = doldurma süresi (sn), kb = geri tepme (zombiyi iter), bloom = seri atışta dağılma
const WEAPONS = {
  pistol:  { name: 'Tabanca', delay: 260,  dmg: 18, pellets: 1, spread: 0.03, speed: 850,  life: 0.9,  pierce: 0,  cost: 0,   col: 0, mag: 15, rl: 0.9, kb: 3,   bloom: 0.03 },
  smg:     { name: 'SMG',     delay: 95,   dmg: 9,  pellets: 1, spread: 0.14, speed: 850,  life: 0.8,  pierce: 0,  cost: 250, col: 1, mag: 35, rl: 1.3, kb: 2,   bloom: 0.018 },
  shotgun: { name: 'Pompalı', delay: 650,  dmg: 10, pellets: 6, spread: 0.55, speed: 720,  life: 0.42, pierce: 0,  cost: 350, col: 2, mag: 8,  rl: 1.6, kb: 4,   bloom: 0 },
  rifle:   { name: 'Tüfek',   delay: 380,  dmg: 40, pellets: 1, spread: 0.01, speed: 1150, life: 1.1,  pierce: 2,  cost: 450, col: 3, mag: 10, rl: 1.4, kb: 7,   bloom: 0.06 },
  flame:   { name: 'Alev',    delay: 45,   dmg: 3.5, pellets: 1, spread: 0.38, speed: 360, life: 0.34, pierce: 99, cost: 400, col: 5, mag: 90, rl: 1.8, kb: 0.4, bloom: 0, burn: true, hr: 11 },
  bazooka: { name: 'Bazuka',  delay: 1100, dmg: 85, pellets: 1, spread: 0.02, speed: 560,  life: 1.3,  pierce: 0,  cost: 650, col: 6, mag: 1,  rl: 1.5, kb: 0,   bloom: 0, boom: { r: 95 } },
  tesla:   { name: 'Tesla',   delay: 380,  dmg: 24, pellets: 1, spread: 0,    speed: 0,    life: 0,    pierce: 0,  cost: 550, col: 7, mag: 20, rl: 1.5, kb: 1,   bloom: 0, chain: { range: 330, jumps: 4, hop: 140 } }
};
const WCLIENT = {};
for (const [k, w] of Object.entries(WEAPONS)) {
  WCLIENT[k] = { delay: w.delay, pellets: w.pellets, spread: w.spread, speed: w.speed, life: w.life, pierce: w.pierce, col: w.col, mag: w.mag, rl: w.rl };
}

const ZT_LIST = ['walker', 'runner', 'brute', 'bomber', 'boss', 'spitter', 'revenant', 'armored', 'healer'];
const ZT = {
  walker:   { r: 11, hp: w => 24 + w * 6,    spd: w => 55 + Math.min(w * 4, 60) + Math.random() * 15,  dmg: 22, coin: 5,   score: 10 },
  runner:   { r: 10, hp: w => 14 + w * 3,    spd: w => 125 + Math.min(w * 3, 50) + Math.random() * 20, dmg: 16, coin: 6,   score: 15 },
  brute:    { r: 18, hp: w => 90 + w * 18,   spd: w => 38 + Math.random() * 10,                        dmg: 45, coin: 18,  score: 40 },
  bomber:   { r: 12, hp: w => 28 + w * 4,    spd: w => 85 + Math.random() * 15,                        dmg: 0,  coin: 10,  score: 25 },
  boss:     { r: 32, hp: w => 700 + w * 110, spd: () => 48,                                            dmg: 70, coin: 150, score: 300 },
  spitter:  { r: 11, hp: w => 20 + w * 4,    spd: w => 62 + Math.random() * 10,                        dmg: 12, coin: 12,  score: 30 },
  revenant: { r: 12, hp: w => 45 + w * 8,    spd: w => 72 + Math.random() * 10,                        dmg: 26, coin: 14,  score: 35 },
  armored:  { r: 14, hp: w => 70 + w * 12,   spd: w => 50 + Math.random() * 10,                        dmg: 30, coin: 16,  score: 38 },
  healer:   { r: 11, hp: w => 30 + w * 5,    spd: w => 62 + Math.random() * 10,                        dmg: 10, coin: 15,  score: 35 }
};

const DIFFS = {
  easy:   { hp: 0.8,  dmg: 0.7, spd: 0.95, cnt: 0.8, gold: 1,   score: 1 },
  normal: { hp: 1,    dmg: 1,   spd: 1,    cnt: 1,   gold: 1,   score: 1 },
  hard:   { hp: 1.35, dmg: 1.4, spd: 1.1,  cnt: 1.3, gold: 1.5, score: 1.5 }
};
const BIOMES = ['forest', 'city', 'desert'];
const CLS_KEYS = ['soldier', 'engineer', 'medic', 'sniper'];
const EVT = [null, 'blood', 'fog', 'dark', 'drop'];

const PERKS = {
  vampire:   { n: 'Vampir',          ic: '🧛', d: 'Zombi öldürünce +4 can' },
  ricochet:  { n: 'Sekme',           ic: '🎱', d: 'Mermiler engellerden bir kez seker' },
  explosive: { n: 'Patlayıcı mermi', ic: '💥', d: 'İsabette %30 ihtimalle küçük patlama' },
  undying:   { n: 'Ölümsüz',         ic: '👼', d: 'Dalgada bir kez ölümcül hasarda 3 sn dokunulmaz' },
  crit:      { n: 'Şanslı',          ic: '🍀', d: 'Kritik vuruş şansı +%15' },
  greedy:    { n: 'Açgözlü',         ic: '🤑', d: 'Kazanılan altın +%25' },
  quick:     { n: 'Hızlı eller',     ic: '🖐️', d: 'Silah doldurma %40 daha hızlı' },
  piercing:  { n: 'Delici uç',       ic: '📌', d: 'Mermiler +1 hedef deler' }
};

const ITEMS = {
  barricade: { n: 'Barikat',        ic: '🧱', d: 'Zombileri durdurur. +2 adet (Z)',               cost: 60, amt: 2 },
  wire:      { n: 'Dikenli tel',    ic: '🌀', d: 'Yavaşlatır ve hasar verir. +2 adet (X)',        cost: 70, amt: 2 },
  mine:      { n: 'Mayın',          ic: '🧨', d: 'Zombi basınca patlar. +2 adet (C)',             cost: 90, amt: 2 },
  crate:     { n: 'Cephane kutusu', ic: '📦', d: 'Yakındakilerin silahını anında doldurur (F)',   cost: 80, amt: 1 },
  nade:      { n: 'El bombası',     ic: '💣', d: 'Fırlat ve patlat. +3 adet (G)',                 cost: 60, amt: 3 }
};
const PLACE = { barricade: 0, wire: 1, mine: 2, crate: 3, nade: -1 };

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// ---------- LIDERLIK TABLOSU ----------
let board = [];
try { board = JSON.parse(fs.readFileSync(BOARD_FILE, 'utf8')); if (!Array.isArray(board)) board = []; } catch (e) { board = []; }
function addScore(entry) {
  board.push(entry);
  board.sort((a, b) => b.wave - a.wave || b.score - a.score);
  board = board.slice(0, 20);
  fs.writeFile(BOARD_FILE, JSON.stringify(board), () => {});
  io.emit('board', board.slice(0, 10));
}

// ---------- ODALAR ----------
const rooms = {};
for (let i = 1; i <= 3; i++) rooms[i] = newRoom(i);

function newRoom(id) {
  return {
    id, state: 'lobby', phase: 'wave', counter: 0, biome: 'forest', diff: 'normal',
    players: {}, zombies: [], bullets: [], pickups: [], obstacles: [], fx: [],
    structs: [], nades: [], spits: [], puddles: [], revives: [],
    baseHp: BASE_HP, baseMax: BASE_HP, baseUp: 0, armor: 0,
    turretN: 0, turretCd: [], turretA: [], turretOwner: null,
    wave: 0, toSpawn: 0, spawnTimer: 0, shopT: 0, bossPending: false, evt: 0,
    seed: 0, tickN: 0, nextId: 1, baseFxT: 0,
    loop: null, overTimer: null
  };
}

function resetRoom(room) {
  clearInterval(room.loop);
  clearTimeout(room.overTimer);
  const fresh = newRoom(room.id);
  Object.keys(room).forEach(k => delete room[k]);
  Object.assign(room, fresh);
}

const roomName = (r) => 'room' + r.id;
const summary = () => Object.values(rooms).map(r => ({
  id: r.id, count: Object.keys(r.players).length, max: MAX_PLAYERS, state: r.state, wave: r.wave, biome: r.biome, diff: r.diff
}));
const lobbyData = (r) => ({
  roomId: r.id, biome: r.biome, diff: r.diff,
  players: Object.entries(r.players).map(([id, p]) => ({ id, name: p.name, ready: p.ready, cls: p.cls, sk: p.sk }))
});
const fx = (room, ...a) => room.fx.push(a);
const say = (room, txt) => io.to(roomName(room)).emit('msg', txt);
const idOf = (room, p) => Object.keys(room.players).find(id => room.players[id] === p);

// basit hız sınırı (saniyede n olay)
function allow(socket, key, n) {
  const t = Date.now();
  socket._rl = socket._rl || {};
  const b = socket._rl[key] || (socket._rl[key] = { t, c: 0 });
  if (t - b.t > 1000) { b.t = t; b.c = 0; }
  return ++b.c <= n;
}

// ---------- BAGLANTI ----------
io.on('connection', (socket) => {
  socket.emit('roomList', summary());
  socket.emit('board', board.slice(0, 10));

  socket.on('join', (roomId, name, skin, cls) => {
    if (!allow(socket, 'join', 3)) return;
    if (socket.roomId) return;
    const room = Number.isInteger(roomId) ? rooms[roomId] : null;
    if (!room) return;
    if (room.state !== 'lobby') return socket.emit('err', 'Bu odada oyun başladı.');
    if (Object.keys(room.players).length >= MAX_PLAYERS) return socket.emit('err', 'Oda dolu.');

    room.counter++;
    socket.join(roomName(room));
    socket.roomId = room.id;
    const clean = String(name || '').replace(/[<>&"']/g, '').trim().slice(0, 14);
    room.players[socket.id] = {
      name: clean || 'Oyuncu ' + room.counter, ready: false, skip: false, alive: true,
      cls: CLS_KEYS.includes(cls) ? cls : 'soldier', sk: Number.isInteger(skin) && skin >= 0 && skin <= 5 ? skin : 0,
      x: BASE.x + (Math.random() - 0.5) * 80, y: BASE.y + (Math.random() - 0.5) * 80,
      hp: 100, maxHp: 100, angle: 0, score: 0, gold: 60, kills: 0, lastShot: 0,
      weapon: 'pistol', weapons: { pistol: true }, ammo: { pistol: WEAPONS.pistol.mag }, rl: 0, rlMax: 1, wantRl: false, bloom: 0,
      up: { dmg: 0, rate: 0, speed: 0, hp: 0 }, perks: {}, offer: [], picked: true,
      inv: { barricade: 0, wire: 0, mine: 0, crate: 0, nade: 0 }, placeCd: 0,
      dmgMul: 1, spdMul: 1, critBonus: 0, reviveTime: 3, reviveP: 0, god: 0, undUsed: false,
      rage: 0, haste: 0, dashT: 0, dashCd: 0, dvx: 0, dvy: 0, mvx: 0, mvy: 0, hurtT: 0, fxN: 0,
      input: { up: false, down: false, left: false, right: false, shoot: false, dash: false, use: false, angle: 0, ax: BASE.x, ay: BASE.y }
    };
    io.to(roomName(room)).emit('lobby', lobbyData(room));
    io.emit('roomList', summary());
  });

  const lobbyRoom = () => { const r = rooms[socket.roomId]; return r && r.state === 'lobby' ? r : null; };

  socket.on('ready', () => {
    if (!allow(socket, 'ui', 10)) return;
    const room = lobbyRoom();
    const p = room && room.players[socket.id];
    if (!p) return;
    p.ready = !p.ready;
    io.to(roomName(room)).emit('lobby', lobbyData(room));
    const all = Object.values(room.players);
    if (all.length > 0 && all.every(pl => pl.ready)) startGame(room);
  });

  socket.on('cls', (c) => {
    if (!allow(socket, 'ui', 10)) return;
    const room = lobbyRoom();
    const p = room && room.players[socket.id];
    if (!p || !CLS_KEYS.includes(c)) return;
    p.cls = c;
    io.to(roomName(room)).emit('lobby', lobbyData(room));
  });

  socket.on('cfg', (c) => {
    if (!allow(socket, 'ui', 10)) return;
    const room = lobbyRoom();
    if (!room || !c || typeof c !== 'object') return;
    if (BIOMES.includes(c.biome)) room.biome = c.biome;
    if (hasOwn(DIFFS, c.diff)) room.diff = c.diff;
    for (const p of Object.values(room.players)) p.ready = false;
    io.to(roomName(room)).emit('lobby', lobbyData(room));
    io.emit('roomList', summary());
  });

  socket.on('input', (inp) => {
    if (!allow(socket, 'input', 60)) return;
    const room = rooms[socket.roomId];
    if (!room || room.state !== 'playing') return;
    const p = room.players[socket.id];
    if (!p || !inp || typeof inp !== 'object') return;
    p.input = {
      up: !!inp.up, down: !!inp.down, left: !!inp.left, right: !!inp.right,
      shoot: !!inp.shoot, dash: !!inp.dash, use: !!inp.use,
      angle: num(inp.angle), ax: clamp(num(inp.ax, p.x), 0, W), ay: clamp(num(inp.ay, p.y), 0, H)
    };
    if (inp.rl) p.wantRl = true;
    if (typeof inp.w === 'string' && hasOwn(p.weapons, inp.w) && inp.w !== p.weapon) {
      p.weapon = inp.w; p.rl = 0; fx(room, 'swap', socket.id);
    }
  });

  socket.on('buy', (id) => {
    if (!allow(socket, 'buy', 10)) return;
    const room = rooms[socket.roomId];
    if (!room || room.state !== 'playing' || room.phase !== 'shop') return;
    const p = room.players[socket.id];
    if (!p || typeof id !== 'string') return;
    const it = catalog(room, p).find(x => x.id === id);
    if (!it || it.off || it.lvl >= it.max) return;
    if (p.gold < it.cost) return socket.emit('err', 'Yeterli altının yok.');
    p.gold -= it.cost;
    it.buy();
    socket.emit('bought');
    if (it.g === 'Takım') say(room, p.name + ' satın aldı: ' + it.name);
    sendShop(room);
  });

  socket.on('perk', (id) => {
    if (!allow(socket, 'buy', 10)) return;
    const room = rooms[socket.roomId];
    if (!room || room.state !== 'playing' || room.phase !== 'shop') return;
    const p = room.players[socket.id];
    if (!p || p.picked || typeof id !== 'string' || !p.offer.includes(id)) return;
    p.perks[id] = true; p.picked = true; p.offer = [];
    socket.emit('bought');
    sendShop(room);
  });

  socket.on('skip', () => {
    if (!allow(socket, 'ui', 10)) return;
    const room = rooms[socket.roomId];
    if (!room || room.state !== 'playing' || room.phase !== 'shop') return;
    const p = room.players[socket.id];
    if (p) p.skip = !p.skip;
  });

  socket.on('place', (type, x, y) => {
    if (!allow(socket, 'place', 8)) return;
    const room = rooms[socket.roomId];
    if (!room || room.state !== 'playing') return;
    const p = room.players[socket.id];
    if (!p || !p.alive || p.placeCd > 0 || typeof type !== 'string' || !hasOwn(PLACE, type)) return;
    if (p.inv[type] <= 0) return;
    const isNade = type === 'nade';
    if (!isNade && room.structs.length >= 40) return socket.emit('err', 'Çok fazla yapı var.');
    const maxD = isNade ? 420 : 240;
    let dx = num(x, p.x) - p.x, dy = num(y, p.y) - p.y;
    const d = Math.hypot(dx, dy);
    if (d > maxD) { dx = dx / d * maxD; dy = dy / d * maxD; }
    const tx = clamp(p.x + dx, 20, W - 20), ty = clamp(p.y + dy, 20, H - 20);
    p.inv[type]--; p.placeCd = 0.25;
    if (isNade) {
      room.nades.push({ x: p.x, y: p.y, tx, ty, t: 0, own: socket.id });
      fx(room, 'throw', Math.round(p.x), Math.round(p.y));
    } else {
      const k = PLACE[type];
      const hp = k === 0 ? 150 : k === 1 ? 120 : 1;
      room.structs.push({ id: room.nextId++, k, x: tx, y: ty, hp, max: hp, own: socket.id, arm: k === 2 ? 0.8 : 0, ch: k === 3 ? 10 : 0, life: k === 3 ? 90 : 0 });
      fx(room, 'place', Math.round(tx), Math.round(ty), k);
    }
  });

  socket.on('ping', (x, y, k) => {
    if (!allow(socket, 'ping', 3)) return;
    const room = rooms[socket.roomId];
    if (!room || room.state !== 'playing') return;
    const p = room.players[socket.id];
    if (!p) return;
    const kind = k === 1 ? 1 : 0;
    fx(room, 'ping', Math.round(clamp(num(x, p.x), 0, W)), Math.round(clamp(num(y, p.y), 0, H)), kind, socket.id);
    if (kind === 1) say(room, p.name + ': Yardım!');
  });

  socket.on('leave', () => leaveRoom(socket));
  socket.on('disconnect', () => leaveRoom(socket));
});

function leaveRoom(socket) {
  const room = rooms[socket.roomId];
  if (!room) return;
  delete room.players[socket.id];
  socket.leave(roomName(room));
  socket.roomId = null;
  if (Object.keys(room.players).length === 0) {
    resetRoom(room);
  } else if (room.state === 'lobby') {
    io.to(roomName(room)).emit('lobby', lobbyData(room));
    const all = Object.values(room.players);
    if (all.every(pl => pl.ready)) startGame(room);
  }
  io.emit('roomList', summary());
}

// ---------- MAGAZA ----------
function catalog(room, p) {
  const L = [];
  const mk = (o) => L.push(o);
  const eng = p.cls === 'engineer' ? 0.75 : 1;
  mk({ id: 'dmg', g: 'Kişisel', name: 'Hasar', ic: '💥', desc: 'Mermi hasarı +%15', lvl: p.up.dmg, max: 8, cost: 80 + 60 * p.up.dmg, buy: () => p.up.dmg++ });
  mk({ id: 'rate', g: 'Kişisel', name: 'Atış hızı', ic: '⚡', desc: 'Ateş hızı +%10, doldurma +%6', lvl: p.up.rate, max: 8, cost: 80 + 60 * p.up.rate, buy: () => p.up.rate++ });
  mk({ id: 'speed', g: 'Kişisel', name: 'Çeviklik', ic: '👟', desc: 'Hareket hızı +%6', lvl: p.up.speed, max: 5, cost: 70 + 50 * p.up.speed, buy: () => p.up.speed++ });
  mk({ id: 'hp', g: 'Kişisel', name: 'Zırh yeleği', ic: '🦺', desc: 'Maks. can +20 ve iyileştirir', lvl: p.up.hp, max: 6, cost: 60 + 50 * p.up.hp, buy: () => { p.up.hp++; p.maxHp += 20; p.hp = Math.min(p.maxHp, p.hp + 20); } });
  mk({ id: 'heal', g: 'Kişisel', name: 'Sağlık çantası', ic: '💊', desc: 'Canını doldurur', lvl: 0, max: 99, cost: 40, off: p.hp >= p.maxHp - 0.5, buy: () => { p.hp = p.maxHp; } });
  const ICON = { smg: '🔫', shotgun: '💣', rifle: '🎯', flame: '🔥', bazooka: '🚀', tesla: '⚡' };
  const DESC = {
    smg: 'Çok hızlı, düşük hasar', shotgun: 'Yakın mesafede yıkıcı', rifle: 'Delip geçer, ağır hasar',
    flame: 'Yakar, kalabalığı eritir', bazooka: 'Roket: geniş alan patlaması', tesla: 'Zincirleme yıldırım, 5 hedefe atlar'
  };
  for (const k of Object.keys(WEAPONS)) {
    if (k === 'pistol') continue;
    const w = WEAPONS[k];
    mk({ id: 'w_' + k, g: 'Silahlar', name: w.name, ic: ICON[k], desc: DESC[k],
      lvl: hasOwn(p.weapons, k) ? 1 : 0, max: 1, cost: w.cost,
      buy: () => { p.weapons[k] = true; p.ammo[k] = w.mag; p.weapon = k; p.rl = 0; } });
  }
  for (const [k, it] of Object.entries(ITEMS)) {
    mk({ id: 'i_' + k, g: 'Eşya', name: it.n + ' (' + p.inv[k] + ')', ic: it.ic, desc: it.d, lvl: 0, max: 99,
      cost: Math.round(it.cost * eng), off: p.inv[k] >= 8, buy: () => { p.inv[k] = Math.min(8, p.inv[k] + it.amt); } });
  }
  mk({ id: 'turret', g: 'Takım', name: 'Otomatik taret', ic: '🗼', desc: 'Bölgeyi kendiliğinden korur', lvl: room.turretN, max: 8, cost: Math.round((150 + 100 * room.turretN) * eng), buy: () => { room.turretN++; room.turretCd.push(0); room.turretA.push(0); room.turretOwner = idOf(room, p); } });
  mk({ id: 'armor', g: 'Takım', name: 'Çelik duvar', ic: '🧱', desc: 'Bölgenin aldığı hasar -%10', lvl: room.armor, max: 5, cost: 200 + 150 * room.armor, buy: () => room.armor++ });
  mk({ id: 'repair', g: 'Takım', name: 'Bölgeyi onar', ic: '🔧', desc: 'Bölge canı +150', lvl: 0, max: 99, cost: 100, off: room.baseHp >= room.baseMax - 0.5, buy: () => { room.baseHp = Math.min(room.baseMax, room.baseHp + 150); } });
  mk({ id: 'basehp', g: 'Takım', name: 'Güçlendirilmiş üs', ic: '🏰', desc: 'Maks. bölge canı +150', lvl: room.baseUp, max: 4, cost: 250 + 150 * room.baseUp, buy: () => { room.baseUp++; room.baseMax += 150; room.baseHp += 150; } });
  return L;
}

function sendShop(room) {
  for (const [id, p] of Object.entries(room.players)) {
    const s = io.sockets.sockets.get(id);
    if (!s) continue;
    s.emit('shop', {
      items: catalog(room, p).map(({ buy, ...i }) => i),
      perks: p.picked ? [] : p.offer.map(k => ({ id: k, ...PERKS[k] })),
      owned: Object.keys(p.perks)
    });
  }
}

function pickPerks(p) {
  const pool = Object.keys(PERKS).filter(k => !p.perks[k]);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, 3);
}

// ---------- OYUN ----------
function genObstacles(biome) {
  const out = [];
  const want = biome === 'city' ? 22 : biome === 'desert' ? 11 : 16;
  let tries = 0;
  while (out.length < want && tries++ < 600) {
    const r = 22 + Math.random() * 22;
    const x = 90 + Math.random() * (W - 180), y = 90 + Math.random() * (H - 180);
    if (Math.hypot(x - BASE.x, y - BASE.y) < ZONE_R + r + 80) continue;
    if (out.some(o => Math.hypot(o.x - x, o.y - y) < o.r + r + 70)) continue;
    const kinds = biome === 'city' ? [1, 2] : biome === 'desert' ? [0, 3] : [0, 1];
    out.push({ x: Math.round(x), y: Math.round(y), r: Math.round(r), k: kinds[Math.random() < 0.5 ? 0 : 1] });
  }
  return out;
}

function applyClass(p) {
  switch (p.cls) {
    case 'soldier': p.maxHp = 120; p.hp = 120; p.dmgMul = 1.1; break;
    case 'engineer': p.inv.barricade = 2; p.inv.mine = 1; break;
    case 'medic': p.reviveTime = 1.5; break;
    case 'sniper':
      p.weapons.rifle = true; p.ammo.rifle = WEAPONS.rifle.mag; p.weapon = 'rifle';
      p.spdMul = 0.95; p.critBonus = 0.1; break;
  }
}

function startGame(room) {
  room.state = 'playing';
  room.wave = 0;
  room.obstacles = genObstacles(room.biome);
  room.seed = Math.floor(Math.random() * 1e9);
  for (const p of Object.values(room.players)) applyClass(p);
  startNextWave(room);
  io.to(roomName(room)).emit('start', {
    W, H, BASE, ZONE_R, obstacles: room.obstacles, seed: room.seed, biome: room.biome, diff: room.diff, weapons: WCLIENT
  });
  io.emit('roomList', summary());
  room.loop = setInterval(() => {
    try { tick(room); } catch (e) { console.error('tick hatası (oda ' + room.id + '):', e); }
  }, 1000 / TICK);
}

function startNextWave(room) {
  room.wave++;
  room.phase = 'wave';
  const D = DIFFS[room.diff];
  const n = Object.keys(room.players).length;
  const boss = room.wave % 5 === 0;
  room.toSpawn = Math.round((6 + room.wave * 4 + n * 3) * D.cnt) + (boss ? 1 : 0);
  room.bossPending = boss;
  room.spawnTimer = 1.5;
  room.evt = (!boss && room.wave >= 2 && Math.random() < 0.45) ? 1 + Math.floor(Math.random() * 4) : 0;
  if (room.evt === 4) {
    for (let k = 0; k < 4; k++) {
      const a = Math.random() * Math.PI * 2, r = 190 + Math.random() * 160;
      dropPickup(room, clamp(BASE.x + Math.cos(a) * r, 40, W - 40), clamp(BASE.y + Math.sin(a) * r, 40, H - 40), k < 2 ? 3 : k === 2 ? 0 : 1, 45);
    }
  }
  for (const p of Object.values(room.players)) { p.skip = false; p.undUsed = false; }
  fx(room, 'wave', room.wave, boss ? 1 : 0, room.evt);
}

function startShop(room) {
  room.phase = 'shop';
  room.shopT = SHOP_TIME;
  room.bullets = [];
  room.spits = []; room.puddles = []; room.nades = [];
  room.evt = 0;
  const bonus = 25 + room.wave * 5;
  for (const p of Object.values(room.players)) {
    if (!p.alive) {
      p.alive = true; p.hp = p.maxHp * 0.6; p.reviveP = 0;
      p.x = BASE.x + (Math.random() - 0.5) * 80; p.y = BASE.y + (Math.random() - 0.5) * 80;
      fx(room, 'revive', p.x, p.y);
    } else p.hp = Math.min(p.maxHp, p.hp + 25);
    gain(p, bonus); p.skip = false; p.rl = 0; p.undUsed = false;
    p.ammo[p.weapon] = WEAPONS[p.weapon].mag;
    p.offer = pickPerks(p); p.picked = p.offer.length === 0;
  }
  room.baseHp = Math.min(room.baseMax, room.baseHp + 40);
  fx(room, 'shop', room.wave, bonus);
  sendShop(room);
}

function gain(p, n) { p.gold += Math.round(n * (p.perks.greedy ? 1.25 : 1)); }

function pickType(w) {
  const o = [['walker', 10]];
  if (w >= 2) o.push(['runner', 3 + w]);
  if (w >= 3) o.push(['bomber', 2 + w * 0.5]);
  if (w >= 4) o.push(['brute', 1 + w * 0.6]);
  if (w >= 4) o.push(['spitter', 2 + w * 0.3]);
  if (w >= 5) o.push(['armored', 1 + w * 0.4]);
  if (w >= 6) o.push(['healer', 1 + w * 0.2]);
  if (w >= 7) o.push(['revenant', 1 + w * 0.4]);
  let t = o.reduce((s, [, k]) => s + k, 0) * Math.random();
  for (const [n, k] of o) { if ((t -= k) <= 0) return n; }
  return 'walker';
}

function spawnZombie(room, type, x, y) {
  if (x === undefined) {
    const side = Math.floor(Math.random() * 4);
    if (side === 0) { x = Math.random() * W; y = -20; }
    else if (side === 1) { x = W + 20; y = Math.random() * H; }
    else if (side === 2) { x = Math.random() * W; y = H + 20; }
    else { x = -20; y = Math.random() * H; }
  }
  const t = ZT[type], D = DIFFS[room.diff];
  let hp = t.hp(room.wave) * D.hp;
  const bk = type === 'boss' ? ((Math.floor(room.wave / 5) - 1) % 3 + 3) % 3 : 0;
  if (type === 'boss') hp *= [1, 0.75, 0.9][bk];
  const z = {
    id: room.nextId++, type, x, y, hp, maxHp: hp, speed: t.spd(room.wave) * D.spd * (room.evt === 1 ? 1.3 : 1),
    r: t.r, dmg: t.dmg * D.dmg, sumT: bk === 1 ? 3 : 5, bt: 4, bs: 0, bk, dir: 0, ang: 0,
    st: 1.5 + Math.random(), ht: 2, stun: 0, burn: 0, burnBy: null, fxT: 0, rev: false
  };
  room.zombies.push(z);
  if (type === 'boss') fx(room, 'roar', x, y);
  return z;
}

function pushOut(e, r, obs) {
  for (const o of obs) {
    const dx = e.x - o.x, dy = e.y - o.y, d = Math.hypot(dx, dy) || 0.01, m = o.r + r;
    if (d < m) { e.x = o.x + dx / d * m; e.y = o.y + dy / d * m; }
  }
}

const armorMult = (room) => 1 - 0.1 * room.armor;

function hurtPlayer(room, p, amount) {
  if (p.god > 0 || !p.alive) return;
  p.hp -= amount;
  if (p.hurtT <= 0) { fx(room, 'hurt', idOf(room, p)); p.hurtT = 0.3; }
  if (p.hp <= 0) {
    if (p.perks.undying && !p.undUsed) {
      p.undUsed = true; p.hp = Math.max(1, p.maxHp * 0.3); p.god = 3;
      fx(room, 'god', idOf(room, p));
      return;
    }
    p.hp = 0; p.alive = false; p.reviveP = 0;
    fx(room, 'pdead', p.x, p.y);
    say(room, p.name + ' düştü!');
  }
}

function damageBase(room, a) {
  room.baseHp -= a * armorMult(room);
  if (room.baseFxT <= 0) { fx(room, 'basehit'); room.baseFxT = 0.4; }
}

function dropPickup(room, x, y, t, life = 15) {
  room.pickups.push({ id: room.nextId++, x, y, t, life });
}

// bombacı patlaması: oyunculara, üsse, barikatlara ve zombilere zarar verir
function explosion(room, x, y, killer) {
  fx(room, 'boom', Math.round(x), Math.round(y), 85);
  for (const p of Object.values(room.players)) {
    if (p.alive && Math.hypot(p.x - x, p.y - y) < 85) hurtPlayer(room, p, 35);
  }
  if (Math.hypot(BASE.x - x, BASE.y - y) < 110) damageBase(room, 30);
  for (const s of room.structs) if ((s.k === 0 || s.k === 1) && Math.hypot(s.x - x, s.y - y) < 85) s.hp -= 60;
  for (const o of room.zombies) {
    if (o.dead || Math.hypot(o.x - x, o.y - y) > 85) continue;
    o.hp -= 45;
    if (o.hp <= 0) killZombie(room, o, killer);
  }
}

// oyuncu patlayıcıları: sadece zombilere zarar verir (dost ateşi yok)
function blast(room, x, y, r, dmg, owner, o = {}) {
  fx(room, 'boom', Math.round(x), Math.round(y), r);
  for (const z of room.zombies) {
    if (z.dead) continue;
    const d = Math.hypot(z.x - x, z.y - y);
    if (d > r + z.r) continue;
    const f = 1 - Math.min(1, d / (r + z.r)) * 0.5;
    hitZombie(room, z, dmg * f, owner, Math.atan2(z.y - y, z.x - x), { noCrit: true, pierceArmor: true, kb: o.small ? 4 : 14 });
  }
}

function hitZombie(room, z, dmg, owner, ang, o = {}) {
  if (z.dead) return 0;
  const op = owner && room.players[owner];
  const cc = 0.1 + (op ? (op.perks.crit ? 0.15 : 0) + op.critBonus : 0);
  const crit = !o.noCrit && Math.random() < cc;
  let d = dmg * (crit ? 2 : 1), blocked = false;
  if (z.type === 'armored' && !o.pierceArmor && Math.cos(ang - z.ang) < -0.55) { d *= 0.2; blocked = true; }
  z.hp -= d;
  if (z.type !== 'boss') z.stun = 0.07;
  if (o.kb && z.type !== 'boss') {
    const m = z.type === 'brute' ? 0.35 : 1;
    z.x += Math.cos(ang) * o.kb * m; z.y += Math.sin(ang) * o.kb * m;
  }
  if (!o.throttle || z.fxT <= 0) {
    if (o.throttle) z.fxT = 0.15;
    fx(room, 'hit', Math.round(z.x), Math.round(z.y), Math.max(1, Math.round(d)), crit ? 1 : 0, +ang.toFixed(2), blocked ? 1 : 0, owner || '');
  }
  if (z.hp <= 0) killZombie(room, z, owner);
  return d;
}

function killZombie(room, z, killerId) {
  if (z.dead) return;
  z.dead = true; z.hp = 0;
  const t = ZT[z.type];
  const idx = ZT_LIST.indexOf(z.type);
  // hortlak: ilk ölümde ödül yok, 3 sn sonra yarı canla geri kalkar
  if (z.type === 'revenant' && !z.rev) {
    room.revives.push({ x: z.x, y: z.y, t: 3 });
    fx(room, 'kill', Math.round(z.x), Math.round(z.y), idx, '', 0);
    fx(room, 'ghoul', Math.round(z.x), Math.round(z.y), 0);
    return;
  }
  const D = DIFFS[room.diff];
  const p = killerId && room.players[killerId];
  let coin = 0;
  if (p) {
    coin = Math.round(t.coin * D.gold * (room.evt === 1 ? 1.25 : 1));
    p.score += Math.round(t.score * D.score); p.kills++;
    const before = p.gold; gain(p, coin); coin = p.gold - before;
    if (p.perks.vampire && p.alive) p.hp = Math.min(p.maxHp, p.hp + 4);
  }
  fx(room, 'kill', Math.round(z.x), Math.round(z.y), idx, killerId || '', coin);
  if (z.type === 'boss') {
    for (let k = 0; k < 4; k++) dropPickup(room, z.x + (Math.random() - 0.5) * 80, z.y + (Math.random() - 0.5) * 80, k % 3);
  } else {
    const r = Math.random();
    if (r < 0.06) dropPickup(room, z.x, z.y, 0);
    else if (r < 0.09) dropPickup(room, z.x, z.y, 1);
    else if (r < 0.12) dropPickup(room, z.x, z.y, 2);
  }
  if (z.type === 'bomber') explosion(room, z.x, z.y, killerId);
}

function addBullet(room, x, y, ang, w, dmg, owner) {
  const op = room.players[owner];
  const pk = op ? op.perks : {};
  room.bullets.push({
    x, y, ang, vx: Math.cos(ang) * w.speed, vy: Math.sin(ang) * w.speed,
    spd: w.speed, life: w.life, owner, dmg,
    pierce: w.pierce + (pk.piercing && w.pierce < 50 ? 1 : 0) + (op && op.cls === 'sniper' && w.col === 3 ? 1 : 0),
    hit: new Set(), col: w.col, kb: w.kb || 0, hr: w.hr || 4,
    bounce: pk.ricochet ? 1 : 0, exp: !!pk.explosive, burn: !!w.burn, boom: w.boom || null
  });
}

function startReload(room, id, p) {
  const w = WEAPONS[p.weapon];
  if (p.rl > 0 || p.ammo[p.weapon] >= w.mag) return;
  p.rlMax = w.rl / (1 + 0.06 * p.up.rate) / (p.perks.quick ? 1.4 : 1);
  p.rl = p.rlMax;
  fx(room, 'reload', id, +p.rlMax.toFixed(2));
}

const angDiff = (a, b) => ((a - b + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;

function zap(room, id, p, wp, dmg) {
  const c = wp.chain;
  const sx = p.x + Math.cos(p.angle) * 18, sy = p.y + Math.sin(p.angle) * 18;
  let best = null, bd = 1e9;
  for (const z of room.zombies) {
    if (z.dead) continue;
    const dx = z.x - p.x, dy = z.y - p.y, d = Math.hypot(dx, dy);
    if (d > c.range || d < 1) continue;
    if (Math.abs(angDiff(Math.atan2(dy, dx), p.angle)) > 0.3 + z.r / d) continue;
    if (d < bd) { bd = d; best = z; }
  }
  const pts = [Math.round(sx), Math.round(sy)];
  if (!best) {
    pts.push(Math.round(p.x + Math.cos(p.angle) * c.range * 0.6), Math.round(p.y + Math.sin(p.angle) * c.range * 0.6));
    fx(room, 'zap', id, pts);
    return;
  }
  const hit = new Set();
  let cur = best, d0 = dmg, px = sx, py = sy;
  for (let j = 0; j <= c.jumps && cur; j++) {
    hit.add(cur.id);
    pts.push(Math.round(cur.x), Math.round(cur.y));
    const ang = Math.atan2(cur.y - py, cur.x - px);
    px = cur.x; py = cur.y;
    const from = cur;
    hitZombie(room, cur, d0, id, ang, { kb: wp.kb, throttle: false });
    d0 *= 0.8;
    cur = null; let nd = c.hop;
    for (const z of room.zombies) {
      if (z.dead || hit.has(z.id)) continue;
      const d = Math.hypot(z.x - from.x, z.y - from.y);
      if (d < nd) { nd = d; cur = z; }
    }
  }
  fx(room, 'zap', id, pts);
}

function fire(room, id, p, wp, now) {
  p.lastShot = now;
  p.ammo[p.weapon]--;
  const dmg = wp.dmg * (1 + 0.15 * p.up.dmg) * (p.rage > 0 ? 2 : 1) * p.dmgMul * (p.cls === 'sniper' && p.weapon === 'rifle' ? 1.25 : 1);
  if (wp.chain) zap(room, id, p, wp, dmg);
  else {
    const spread = wp.spread + p.bloom;
    for (let k = 0; k < wp.pellets; k++) {
      const a = p.angle + (Math.random() - 0.5) * spread;
      addBullet(room, p.x + Math.cos(a) * 18, p.y + Math.sin(a) * 18, a, wp, dmg, id);
    }
  }
  p.bloom = Math.min(0.15, p.bloom + wp.bloom);
  // alev makinesi çok sık ateş eder; ağ trafiğini azaltmak için her 3 atışta bir efekt yolla
  if (wp.col !== 5 || (p.fxN++ % 3) === 0) fx(room, 'shoot', Math.round(p.x), Math.round(p.y), +p.angle.toFixed(2), wp.col, id);
}

function revivePlayer(room, helper, dead) {
  dead.alive = true; dead.hp = dead.maxHp * 0.5; dead.reviveP = 0; dead.god = 2;
  fx(room, 'revive', dead.x, dead.y);
  say(room, helper.name + ' ➜ ' + dead.name + ' ayağa kalktı!');
}

function spit(room, z, p) {
  const dx = p.x - z.x, dy = p.y - z.y, d = Math.hypot(dx, dy) || 1;
  room.spits.push({ x: z.x, y: z.y, tx: p.x, ty: p.y, vx: dx / d * 260, vy: dy / d * 260, left: d });
  fx(room, 'spit', Math.round(z.x), Math.round(z.y));
}

function summon(room, z, n) {
  fx(room, 'roar', Math.round(z.x), Math.round(z.y));
  for (let k = 0; k < n; k++) spawnZombie(room, k === 3 ? 'runner' : 'walker', z.x + (Math.random() - 0.5) * 60, z.y + (Math.random() - 0.5) * 60);
}

function stomp(room, z) {
  fx(room, 'stomp', Math.round(z.x), Math.round(z.y), 150);
  for (const p of Object.values(room.players)) {
    if (!p.alive) continue;
    const dx = p.x - z.x, dy = p.y - z.y, d = Math.hypot(dx, dy) || 1;
    if (d < 150) { hurtPlayer(room, p, 35 * DIFFS[room.diff].dmg); p.x = clamp(p.x + dx / d * 45, 12, W - 12); p.y = clamp(p.y + dy / d * 45, 12, H - 12); }
  }
  if (Math.hypot(BASE.x - z.x, BASE.y - z.y) < 180) damageBase(room, 25);
}

function tick(room) {
  const now = Date.now();
  const ents = Object.entries(room.players);
  const D = DIFFS[room.diff];
  room.tickN++;
  room.baseFxT -= DT;

  // 1) oyuncular
  for (const [id, p] of ents) {
    p.hurtT -= DT;
    p.rage = Math.max(0, p.rage - DT);
    p.haste = Math.max(0, p.haste - DT);
    p.dashCd = Math.max(0, p.dashCd - DT);
    p.god = Math.max(0, p.god - DT);
    p.placeCd -= DT;
    p.bloom -= p.bloom * Math.min(1, 4 * DT);
    if (!p.alive) continue;
    const i = p.input;
    const dx = (i.right ? 1 : 0) - (i.left ? 1 : 0), dy = (i.down ? 1 : 0) - (i.up ? 1 : 0);
    const len = Math.hypot(dx, dy);
    const sp = PLAYER_SPEED * (1 + 0.06 * p.up.speed) * p.spdMul;
    p.angle = i.angle;
    if (i.dash && p.dashCd <= 0) {
      p.dashCd = DASH_CD; p.dashT = 0.15;
      if (len > 0) { p.dvx = dx / len; p.dvy = dy / len; }
      else { p.dvx = Math.cos(p.angle); p.dvy = Math.sin(p.angle); }
      fx(room, 'dash', Math.round(p.x), Math.round(p.y), +Math.atan2(p.dvy, p.dvx).toFixed(2));
    }
    if (p.dashT > 0) {
      p.dashT -= DT;
      p.x += p.dvx * DASH_SPEED * DT; p.y += p.dvy * DASH_SPEED * DT;
      p.mvx = p.dvx * sp * 0.6; p.mvy = p.dvy * sp * 0.6;
    } else {
      // ivmeli hareket: kalkış ve duruşta hafif kayma hissi
      const k = 1 - Math.exp(-DT * 16);
      p.mvx += ((len ? dx / len * sp : 0) - p.mvx) * k;
      p.mvy += ((len ? dy / len * sp : 0) - p.mvy) * k;
      p.x += p.mvx * DT; p.y += p.mvy * DT;
    }
    p.x = clamp(p.x, 12, W - 12); p.y = clamp(p.y, 12, H - 12);
    pushOut(p, 12, room.obstacles);
    p.x = clamp(p.x, 12, W - 12); p.y = clamp(p.y, 12, H - 12);

    if (p.hp < p.maxHp && Math.hypot(p.x - BASE.x, p.y - BASE.y) < ZONE_R) p.hp = Math.min(p.maxHp, p.hp + 6 * DT);
    if (p.cls === 'medic') {
      for (const [, o] of ents) {
        if (o !== p && o.alive && o.hp < o.maxHp && Math.hypot(o.x - p.x, o.y - p.y) < 130) o.hp = Math.min(o.maxHp, o.hp + 5 * DT);
      }
    }

    // silah doldurma
    if (p.rl > 0) {
      p.rl -= DT;
      if (p.rl <= 0) { p.rl = 0; p.ammo[p.weapon] = WEAPONS[p.weapon].mag; fx(room, 'rdone', id); }
    }
    if (p.wantRl) { p.wantRl = false; startReload(room, id, p); }
    const wmax = WEAPONS[p.weapon].mag;
    for (const s of room.structs) {
      if (s.k !== 3 || s.ch <= 0 || Math.hypot(s.x - p.x, s.y - p.y) > 55) continue;
      if (p.ammo[p.weapon] < wmax * 0.5 || p.rl > 0) {
        p.ammo[p.weapon] = wmax; p.rl = 0; s.ch--; fx(room, 'rdone', id); break;
      }
    }

    // ateş
    const wp = WEAPONS[p.weapon];
    const delay = wp.delay / (1 + 0.1 * p.up.rate) / (p.haste > 0 ? 1.6 : 1);
    if (i.shoot) {
      if (p.ammo[p.weapon] <= 0) startReload(room, id, p);
      else if (p.rl <= 0 && now - p.lastShot > delay) fire(room, id, p, wp, now);
    }
  }

  // 1b) düşen arkadaşı canlandırma (E basılı tut)
  for (const [, d] of ents) {
    if (d.alive) continue;
    let helper = null;
    for (const [, h] of ents) {
      if (h.alive && h.input.use && Math.hypot(h.x - d.x, h.y - d.y) < 45) { helper = h; break; }
    }
    if (helper) { d.reviveP += DT / helper.reviveTime; if (d.reviveP >= 1) revivePlayer(room, helper, d); }
    else d.reviveP = Math.max(0, d.reviveP - DT * 0.5);
  }
  const living = ents.map(([, p]) => p).filter(p => p.alive);

  // 2) zombi doğurma
  if (room.phase === 'wave' && room.toSpawn > 0) {
    room.spawnTimer -= DT;
    if (room.spawnTimer <= 0 && room.zombies.length < MAX_ZOMBIES) {
      if (room.bossPending) { spawnZombie(room, 'boss'); room.bossPending = false; }
      else spawnZombie(room, pickType(room.wave));
      room.toSpawn--;
      room.spawnTimer = Math.max(0.2, 0.8 - room.wave * 0.04);
    }
  }
  // hortlakların geri dönüşü
  for (const r of room.revives) {
    r.t -= DT;
    if (r.t <= 0) {
      const z = spawnZombie(room, 'revenant', r.x, r.y);
      z.rev = true; z.hp = z.maxHp * 0.5;
      fx(room, 'ghoul', Math.round(r.x), Math.round(r.y), 1);
    }
  }
  room.revives = room.revives.filter(r => r.t > 0);

  // 3) zombiler
  const zs = room.zombies;
  const wires = room.structs.filter(s => s.k === 1);
  for (const z of zs) {
    if (z.dead) continue;
    z.fxT -= DT; z.stun -= DT;
    if (z.burn > 0) {
      z.burn -= DT; z.hp -= 7 * DT;
      if (z.hp <= 0) { killZombie(room, z, z.burnBy); continue; }
    }
    let tx = BASE.x, ty = BASE.y, best = 240, tp = null;
    for (const p of living) {
      const d = Math.hypot(p.x - z.x, p.y - z.y);
      if (d < best) { best = d; tx = p.x; ty = p.y; tp = p; }
    }
    let dx = tx - z.x, dy = ty - z.y, d = Math.hypot(dx, dy) || 1;
    z.ang = Math.atan2(dy, dx);
    let mx = dx / d, my = dy / d, sp = z.speed * (z.stun > 0 && z.type !== 'boss' ? 0.35 : 1), move = true;

    for (const s of wires) {
      if (s.hp > 0 && Math.hypot(s.x - z.x, s.y - z.y) < 34) {
        sp *= 0.45; s.hp -= 10 * DT; z.hp -= 8 * DT;
        if (z.hp <= 0) { killZombie(room, z, s.own); break; }
      }
    }
    if (z.dead) continue;

    if (z.type === 'spitter' && tp) {
      if (d < 170) { mx = -mx; my = -my; sp *= 0.7; }
      else if (d < 230) move = false;
      z.st -= DT;
      if (z.st <= 0 && d < 320) { z.st = 2.2; spit(room, z, tp); }
    } else if (z.type === 'healer') {
      z.ht -= DT;
      if (z.ht <= 0) {
        z.ht = 2;
        for (const o of zs) {
          if (o.dead || o === z || o.hp >= o.maxHp || Math.hypot(o.x - z.x, o.y - z.y) > 120) continue;
          o.hp = Math.min(o.maxHp, o.hp + o.maxHp * 0.12);
        }
        fx(room, 'heal', Math.round(z.x), Math.round(z.y));
      }
    } else if (z.type === 'boss') {
      z.bt -= DT;
      if (z.bk === 0) {
        if (z.bs === 0 && z.bt <= 0) { z.bs = 1; z.bt = 0.7; }
        else if (z.bs === 1) { move = false; if (z.bt <= 0) { stomp(room, z); z.bs = 0; z.bt = 6; } }
        z.sumT -= DT; if (z.sumT <= 0) { z.sumT = 8; summon(room, z, 3); }
      } else if (z.bk === 1) {
        sp *= 0.85;
        z.sumT -= DT; if (z.sumT <= 0) { z.sumT = 4; summon(room, z, 4); }
      } else {
        if (z.bs === 0 && z.bt <= 0) { z.bs = 1; z.bt = 0.9; }
        else if (z.bs === 1) { move = false; z.dir = z.ang; if (z.bt <= 0) { z.bs = 2; z.bt = 0.8; fx(room, 'roar', Math.round(z.x), Math.round(z.y)); } }
        else if (z.bs === 2) { mx = Math.cos(z.dir); my = Math.sin(z.dir); sp = 460; if (z.bt <= 0) { z.bs = 0; z.bt = 6; } }
        z.sumT -= DT; if (z.sumT <= 0) { z.sumT = 9; summon(room, z, 2); }
      }
    }
    if (move) { z.x += mx * sp * DT; z.y += my * sp * DT; }
  }
  // yumuşak ayrışma + engeller
  const bars = room.structs.filter(s => s.k === 0 && s.hp > 0).map(s => ({ x: s.x, y: s.y, r: 15 }));
  for (let a = 0; a < zs.length; a++) {
    const A = zs[a];
    if (A.dead) continue;
    for (let b = a + 1; b < zs.length; b++) {
      const B = zs[b];
      if (B.dead) continue;
      const dx = B.x - A.x, dy = B.y - A.y, m = (A.r + B.r) * 0.85;
      if (Math.abs(dx) > m || Math.abs(dy) > m) continue;
      const d = Math.hypot(dx, dy) || 0.01;
      if (d < m) {
        const push = (m - d) * 0.25;
        A.x -= dx / d * push; A.y -= dy / d * push;
        B.x += dx / d * push; B.y += dy / d * push;
      }
    }
    pushOut(A, A.r, room.obstacles);
    if (bars.length) pushOut(A, A.r, bars);
  }
  // temas hasarı
  for (const z of zs) {
    if (z.dead) continue;
    const mult = z.type === 'boss' && z.bs === 2 && z.bk === 2 ? 2 : 1;
    for (const p of living) {
      if (!p.alive || Math.hypot(p.x - z.x, p.y - z.y) > z.r + 11) continue;
      if (z.type === 'bomber') { killZombie(room, z, null); break; }
      hurtPlayer(room, p, z.dmg * mult * DT);
    }
    if (z.dead) continue;
    for (const s of room.structs) {
      if (s.k !== 0 || s.hp <= 0 || Math.hypot(s.x - z.x, s.y - z.y) > 15 + z.r + 3) continue;
      if (z.type === 'bomber') { killZombie(room, z, null); break; }
      s.hp -= z.dmg * 0.6 * DT;
    }
    if (z.dead) continue;
    if (Math.hypot(BASE.x - z.x, BASE.y - z.y) < 30 + z.r) {
      if (z.type === 'bomber') killZombie(room, z, null);
      else damageBase(room, z.dmg * 0.55 * DT);
    }
  }

  // 3b) mayın / cephane kutusu / yapılar
  for (const s of room.structs) {
    if (s.k === 2) {
      if (s.arm > 0) { s.arm -= DT; continue; }
      for (const z of zs) {
        if (!z.dead && Math.hypot(z.x - s.x, z.y - s.y) < 24 + z.r * 0.3) { blast(room, s.x, s.y, 80, 100, s.own); s.hp = 0; break; }
      }
    } else if (s.k === 3) {
      s.life -= DT;
      if (s.life <= 0 || s.ch <= 0) s.hp = 0;
    }
  }
  room.structs = room.structs.filter(s => {
    if (s.hp > 0) return true;
    if (s.k < 2) fx(room, 'sbreak', Math.round(s.x), Math.round(s.y), s.k);
    return false;
  });

  // 3c) tükürük, asit gölcükleri, el bombaları
  for (const s of room.spits) {
    const step = 260 * DT;
    s.x += s.vx * DT; s.y += s.vy * DT; s.left -= step;
    if (s.left <= 0) {
      s.done = true;
      room.puddles.push({ x: s.tx, y: s.ty, r: 34, t: 4 });
      fx(room, 'splash', Math.round(s.tx), Math.round(s.ty));
    }
  }
  room.spits = room.spits.filter(s => !s.done);
  for (const g of room.puddles) {
    g.t -= DT;
    for (const p of living) {
      if (p.alive && Math.hypot(p.x - g.x, p.y - g.y) < g.r + 8) hurtPlayer(room, p, 14 * D.dmg * DT);
    }
  }
  room.puddles = room.puddles.filter(g => g.t > 0);
  for (const g of room.nades) {
    g.t += DT;
    const dx = g.tx - g.x, dy = g.ty - g.y, d = Math.hypot(dx, dy);
    if (d > 6) { const st = Math.min(d, 420 * DT); g.x += dx / d * st; g.y += dy / d * st; }
    if (g.t >= 1.2) { g.done = true; blast(room, g.x, g.y, 95, 80, g.own); }
  }
  room.nades = room.nades.filter(g => !g.done);

  // 4) taretler
  const eng = living.some(p => p.cls === 'engineer');
  for (let t = 0; t < room.turretN; t++) {
    const ang0 = t / room.turretN * Math.PI * 2 + 0.4;
    const tx = BASE.x + Math.cos(ang0) * 88, ty = BASE.y + Math.sin(ang0) * 88;
    room.turretCd[t] -= DT;
    let tgt = null, bd = 150;
    for (const z of zs) {
      if (z.dead) continue;
      const d = Math.hypot(z.x - tx, z.y - ty);
      if (d < bd) { bd = d; tgt = z; }
    }
    if (tgt) {
      room.turretA[t] = Math.atan2(tgt.y - ty, tgt.x - tx);
      if (room.turretCd[t] <= 0) {
        room.turretCd[t] = 0.45 / (eng ? 1.3 : 1);
        addBullet(room, tx, ty, room.turretA[t], { speed: 900, life: 0.5, pierce: 0, col: 4, kb: 2 }, 5, room.turretOwner);
        fx(room, 'tshoot', Math.round(tx), Math.round(ty), +room.turretA[t].toFixed(2));
      }
    }
  }

  // 5) mermiler (2 alt adım: ince hedeflerden geçmesin)
  for (const b of room.bullets) {
    for (let s = 0; s < 2 && b.life > 0; s++) {
      b.x += b.vx * DT / 2; b.y += b.vy * DT / 2; b.life -= DT / 2;
      for (const o of room.obstacles) {
        if (Math.hypot(o.x - b.x, o.y - b.y) >= o.r) continue;
        if (b.bounce > 0 && !b.boom) {
          const dx = b.x - o.x, dy = b.y - o.y, d = Math.hypot(dx, dy) || 1, nx = dx / d, ny = dy / d;
          const dot = b.vx * nx + b.vy * ny;
          b.vx -= 2 * dot * nx; b.vy -= 2 * dot * ny;
          b.ang = Math.atan2(b.vy, b.vx);
          b.x = o.x + nx * (o.r + 1); b.y = o.y + ny * (o.r + 1);
          b.bounce--; b.hit.clear();
          fx(room, 'spark', Math.round(b.x), Math.round(b.y));
        } else b.life = 0;
        break;
      }
      if (b.life <= 0) break;
      for (const z of zs) {
        if (z.dead || b.hit.has(z.id) || Math.hypot(z.x - b.x, z.y - b.y) > z.r + b.hr) continue;
        if (b.boom) { b.life = 0; break; }
        b.hit.add(z.id);
        if (b.burn) { z.burn = 2.5; z.burnBy = b.owner; }
        hitZombie(room, z, b.dmg, b.owner, b.ang, { kb: b.kb, throttle: b.burn });
        if (b.exp && !b.burn && Math.random() < 0.3) blast(room, z.x, z.y, 48, b.dmg * 0.5, b.owner, { small: true });
        if (b.pierce > 0) b.pierce--; else { b.life = 0; break; }
      }
    }
    if (b.life <= 0 && b.boom && !b.boomed) { b.boomed = true; blast(room, b.x, b.y, b.boom.r, b.dmg, b.owner); }
  }
  room.bullets = room.bullets.filter(b => b.life > 0 && b.x > -50 && b.x < W + 50 && b.y > -50 && b.y < H + 50);
  room.zombies = room.zombies.filter(z => !z.dead);

  // 6) eşyalar
  for (const pk of room.pickups) {
    pk.life -= DT;
    for (const p of living) {
      if (!p.alive || Math.hypot(p.x - pk.x, p.y - pk.y) > 26) continue;
      if (pk.t === 0) p.hp = Math.min(p.maxHp, p.hp + 40);
      else if (pk.t === 1) p.rage = 10;
      else if (pk.t === 2) p.haste = 10;
      else gain(p, 40 + room.wave * 4);
      fx(room, 'pick', Math.round(pk.x), Math.round(pk.y), pk.t, idOf(room, p));
      pk.life = 0;
      break;
    }
  }
  room.pickups = room.pickups.filter(pk => pk.life > 0);

  // 7) dalga akışı
  if (room.phase === 'wave') {
    if (room.toSpawn === 0 && room.zombies.length === 0 && room.revives.length === 0) startShop(room);
  } else {
    room.shopT -= DT;
    const all = Object.values(room.players);
    if (room.shopT <= 0 || (all.length > 0 && all.every(p => p.skip))) startNextWave(room);
  }

  // 8) oyun sonu
  if (room.baseHp <= 0 || !ents.some(([, p]) => p.alive)) {
    endGame(room, room.baseHp <= 0 ? 'Bölge düştü!' : 'Tüm oyuncular öldü!');
    return;
  }

  // 9) durumu yolla
  if (room.tickN % NET_EVERY !== 0) return;
  const idxOf = {};
  ents.forEach(([id], i) => { idxOf[id] = i; });
  io.to(roomName(room)).emit('state', {
    ph: room.phase, shopT: Math.max(0, Math.ceil(room.shopT)), ev: room.evt,
    skips: ents.filter(([, p]) => p.skip).length, np: ents.length,
    players: ents.map(([id, p]) => ({
      id, name: p.name, x: Math.round(p.x), y: Math.round(p.y), hp: Math.round(p.hp), mhp: p.maxHp,
      alive: p.alive, a: +p.angle.toFixed(2), score: p.score, gold: p.gold, kills: p.kills,
      w: p.weapon, ws: Object.keys(p.weapons), rage: +p.rage.toFixed(1), haste: +p.haste.toFixed(1),
      dcd: +p.dashCd.toFixed(1), cls: p.cls, sk: p.sk, pk: Object.keys(p.perks),
      am: p.ammo[p.weapon], mg: WEAPONS[p.weapon].mag, rl: p.rl > 0 ? +(1 - p.rl / p.rlMax).toFixed(2) : -1,
      fr: +((1 + 0.1 * p.up.rate) * (p.haste > 0 ? 1.6 : 1)).toFixed(2), bl: +p.bloom.toFixed(3),
      rv: +p.reviveP.toFixed(2), god: +p.god.toFixed(1),
      inv: [p.inv.barricade, p.inv.wire, p.inv.mine, p.inv.crate, p.inv.nade]
    })),
    zombies: room.zombies.map(z => [
      z.id, Math.round(z.x), Math.round(z.y), +(z.hp / z.maxHp).toFixed(2), ZT_LIST.indexOf(z.type), z.bk,
      (z.burn > 0 ? 1 : 0) | (z.type === 'boss' && z.bs === 1 ? 2 : 0) | (z.type === 'boss' && z.bs === 2 ? 4 : 0)
    ]),
    bullets: room.bullets.map(b => [Math.round(b.x), Math.round(b.y), +b.ang.toFixed(2), b.col, Math.round(b.spd / 10), idxOf[b.owner] === undefined ? -1 : idxOf[b.owner]]),
    pickups: room.pickups.map(p => [p.id, Math.round(p.x), Math.round(p.y), p.t]),
    structs: room.structs.map(s => [s.id, s.k, Math.round(s.x), Math.round(s.y), +(s.hp / s.max).toFixed(2), s.k === 2 ? (s.arm > 0 ? 1 : 0) : s.ch]),
    spits: room.spits.map(s => [Math.round(s.x), Math.round(s.y)]),
    puds: room.puddles.map(g => [Math.round(g.x), Math.round(g.y), g.r, +(g.t / 4).toFixed(2)]),
    nades: room.nades.map(g => [Math.round(g.x), Math.round(g.y), +g.t.toFixed(2)]),
    turrets: room.turretA.map((a, t) => {
      const a0 = t / room.turretN * Math.PI * 2 + 0.4;
      return [Math.round(BASE.x + Math.cos(a0) * 88), Math.round(BASE.y + Math.sin(a0) * 88), +a.toFixed(2)];
    }),
    baseHp: Math.max(0, Math.round(room.baseHp)), baseMax: room.baseMax, armor: room.armor,
    wave: room.wave, left: room.toSpawn + room.zombies.length + room.revives.length,
    fx: room.fx
  });
  room.fx = [];
}

function endGame(room, reason) {
  clearInterval(room.loop);
  room.state = 'over';
  const list = Object.values(room.players);
  const scores = list
    .map(p => ({ name: p.name, score: p.score, kills: p.kills }))
    .sort((a, b) => b.score - a.score);
  io.to(roomName(room)).emit('gameover', { reason, wave: room.wave, scores });
  if (room.wave >= 2) {
    addScore({
      names: scores.map(s => s.name), wave: room.wave, score: scores.reduce((s, p) => s + p.score, 0),
      diff: room.diff, biome: room.biome, date: new Date().toISOString().slice(0, 10)
    });
  }
  io.emit('roomList', summary());

  room.overTimer = setTimeout(() => {
    for (const id of Object.keys(room.players)) {
      const s = io.sockets.sockets.get(id);
      if (s) { s.leave(roomName(room)); s.roomId = null; s.emit('toLobby'); }
    }
    resetRoom(room);
    io.emit('roomList', summary());
  }, 8000);
}

server.listen(process.env.PORT || 3000, () => {
  console.log('Sunucu çalışıyor: http://localhost:' + (process.env.PORT || 3000));
});
