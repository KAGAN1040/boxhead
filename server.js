const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// index.html "public" klasöründe de olabilir, proje kökünde de.
const pubDir = path.join(__dirname, 'public');
if (fs.existsSync(path.join(pubDir, 'index.html'))) app.use(express.static(pubDir));
else app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ---------- AYARLAR ----------
const W = 1800, H = 1200;          // harita (artık kamera takip ediyor)
const BASE = { x: 900, y: 600 };   // korunacak bölgenin merkezi
const ZONE_R = 150;                // korunan bölge yarıçapı
const MAX_PLAYERS = 5;
const TICK = 40;                   // saniyede 40 simülasyon
const NET_EVERY = 2;               // 20 Hz ağ güncellemesi
const DT = 1 / TICK;
const PLAYER_SPEED = 190;
const DASH_SPEED = 640, DASH_CD = 1.6;
const BASE_HP = 500;
const SHOP_TIME = 25;
const MAX_ZOMBIES = 90;

const WEAPONS = {
  pistol:  { name: 'Tabanca',  delay: 260, dmg: 18, pellets: 1, spread: 0.03, speed: 850,  life: 0.9,  pierce: 0, cost: 0,   col: 0 },
  smg:     { name: 'SMG',      delay: 95,  dmg: 9,  pellets: 1, spread: 0.14, speed: 850,  life: 0.8,  pierce: 0, cost: 250, col: 1 },
  shotgun: { name: 'Pompalı',  delay: 650, dmg: 10, pellets: 6, spread: 0.55, speed: 720,  life: 0.42, pierce: 0, cost: 350, col: 2 },
  rifle:   { name: 'Tüfek',    delay: 380, dmg: 40, pellets: 1, spread: 0.01, speed: 1150, life: 1.1,  pierce: 2, cost: 450, col: 3 }
};

const ZT_LIST = ['walker', 'runner', 'brute', 'bomber', 'boss'];
const ZT = {
  walker: { r: 11, hp: w => 24 + w * 6,   spd: w => 55 + Math.min(w * 4, 60) + Math.random() * 15,  dmg: 22, coin: 5,   score: 10 },
  runner: { r: 10, hp: w => 14 + w * 3,   spd: w => 125 + Math.min(w * 3, 50) + Math.random() * 20, dmg: 16, coin: 6,   score: 15 },
  brute:  { r: 18, hp: w => 90 + w * 18,  spd: w => 38 + Math.random() * 10,                        dmg: 45, coin: 18,  score: 40 },
  bomber: { r: 12, hp: w => 28 + w * 4,   spd: w => 85 + Math.random() * 15,                        dmg: 0,  coin: 10,  score: 25 },
  boss:   { r: 32, hp: w => 700 + w * 110, spd: () => 48,                                            dmg: 70, coin: 150, score: 300 }
};

// ---------- ODALAR ----------
const rooms = {};
for (let i = 1; i <= 3; i++) rooms[i] = newRoom(i);

function newRoom(id) {
  return {
    id, state: 'lobby', phase: 'wave', counter: 0,
    players: {}, zombies: [], bullets: [], pickups: [], obstacles: [], fx: [],
    baseHp: BASE_HP, baseMax: BASE_HP, baseUp: 0, armor: 0,
    turretN: 0, turretCd: [], turretA: [], turretOwner: null,
    wave: 0, toSpawn: 0, spawnTimer: 0, shopT: 0, bossPending: false,
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
  id: r.id, count: Object.keys(r.players).length, max: MAX_PLAYERS, state: r.state, wave: r.wave
}));
const lobbyData = (r) => ({
  roomId: r.id,
  players: Object.entries(r.players).map(([id, p]) => ({ id, name: p.name, ready: p.ready }))
});
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fx = (room, ...a) => room.fx.push(a);
const say = (room, txt) => io.to(roomName(room)).emit('msg', txt);

// ---------- BAGLANTI ----------
io.on('connection', (socket) => {
  socket.emit('roomList', summary());

  socket.on('join', (roomId, name) => {
    if (socket.roomId) return;
    const room = rooms[roomId];
    if (!room) return;
    if (room.state !== 'lobby') return socket.emit('err', 'Bu odada oyun başladı.');
    if (Object.keys(room.players).length >= MAX_PLAYERS) return socket.emit('err', 'Oda dolu.');

    room.counter++;
    socket.join(roomName(room));
    socket.roomId = room.id;
    const clean = String(name || '').replace(/[<>&"']/g, '').trim().slice(0, 14);
    room.players[socket.id] = {
      name: clean || 'Oyuncu ' + room.counter, ready: false, skip: false, alive: true,
      x: BASE.x + (Math.random() - 0.5) * 80, y: BASE.y + (Math.random() - 0.5) * 80,
      hp: 100, maxHp: 100, angle: 0, score: 0, gold: 60, kills: 0, lastShot: 0,
      weapon: 'pistol', weapons: { pistol: true },
      up: { dmg: 0, rate: 0, speed: 0, hp: 0 },
      rage: 0, haste: 0, dashT: 0, dashCd: 0, dvx: 0, dvy: 0, hurtT: 0,
      input: { up: false, down: false, left: false, right: false, shoot: false, dash: false, angle: 0 }
    };
    io.to(roomName(room)).emit('lobby', lobbyData(room));
    io.emit('roomList', summary());
  });

  socket.on('ready', () => {
    const room = rooms[socket.roomId];
    if (!room || room.state !== 'lobby') return;
    const p = room.players[socket.id];
    if (!p) return;
    p.ready = !p.ready;
    io.to(roomName(room)).emit('lobby', lobbyData(room));
    const all = Object.values(room.players);
    if (all.length > 0 && all.every(pl => pl.ready)) startGame(room);
  });

  socket.on('input', (inp) => {
    const room = rooms[socket.roomId];
    if (!room || room.state !== 'playing') return;
    const p = room.players[socket.id];
    if (!p || !inp) return;
    p.input = {
      up: !!inp.up, down: !!inp.down, left: !!inp.left, right: !!inp.right,
      shoot: !!inp.shoot, dash: !!inp.dash, angle: Number(inp.angle) || 0
    };
    if (inp.w && p.weapons[inp.w]) p.weapon = inp.w;
  });

  socket.on('buy', (id) => {
    const room = rooms[socket.roomId];
    if (!room || room.state !== 'playing' || room.phase !== 'shop') return;
    const p = room.players[socket.id];
    if (!p) return;
    const it = catalog(room, p).find(x => x.id === id);
    if (!it || it.off || it.lvl >= it.max) return;
    if (p.gold < it.cost) return socket.emit('err', 'Yeterli altının yok.');
    p.gold -= it.cost;
    it.buy();
    socket.emit('bought');
    if (it.g === 'Takım') say(room, p.name + ' satın aldı: ' + it.name);
    sendShop(room);
  });

  socket.on('skip', () => {
    const room = rooms[socket.roomId];
    if (!room || room.state !== 'playing' || room.phase !== 'shop') return;
    const p = room.players[socket.id];
    if (p) p.skip = !p.skip;
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
  mk({ id: 'dmg', g: 'Kişisel', name: 'Hasar', ic: '💥', desc: 'Mermi hasarı +%15', lvl: p.up.dmg, max: 8, cost: 80 + 60 * p.up.dmg, buy: () => p.up.dmg++ });
  mk({ id: 'rate', g: 'Kişisel', name: 'Atış hızı', ic: '⚡', desc: 'Ateş hızı +%10', lvl: p.up.rate, max: 8, cost: 80 + 60 * p.up.rate, buy: () => p.up.rate++ });
  mk({ id: 'speed', g: 'Kişisel', name: 'Çeviklik', ic: '👟', desc: 'Hareket hızı +%6', lvl: p.up.speed, max: 5, cost: 70 + 50 * p.up.speed, buy: () => p.up.speed++ });
  mk({ id: 'hp', g: 'Kişisel', name: 'Zırh yeleği', ic: '🦺', desc: 'Maks. can +20 ve iyileştirir', lvl: p.up.hp, max: 6, cost: 60 + 50 * p.up.hp, buy: () => { p.up.hp++; p.maxHp += 20; p.hp = Math.min(p.maxHp, p.hp + 20); } });
  mk({ id: 'heal', g: 'Kişisel', name: 'Sağlık çantası', ic: '💊', desc: 'Canını doldurur', lvl: 0, max: 99, cost: 40, off: p.hp >= p.maxHp - 0.5, buy: () => { p.hp = p.maxHp; } });
  for (const k of Object.keys(WEAPONS)) {
    if (k === 'pistol') continue;
    const w = WEAPONS[k];
    mk({ id: 'w_' + k, g: 'Silahlar', name: w.name, ic: { smg: '🔫', shotgun: '💣', rifle: '🎯' }[k],
      desc: { smg: 'Çok hızlı, düşük hasar', shotgun: 'Yakın mesafede yıkıcı', rifle: 'Delip geçer, ağır hasar' }[k],
      lvl: p.weapons[k] ? 1 : 0, max: 1, cost: w.cost, buy: () => { p.weapons[k] = true; p.weapon = k; } });
  }
  mk({ id: 'turret', g: 'Takım', name: 'Otomatik taret', ic: '🗼', desc: 'Bölgeyi kendiliğinden korur', lvl: room.turretN, max: 8, cost: 150 + 100 * room.turretN, buy: () => { room.turretN++; room.turretCd.push(0); room.turretA.push(0); room.turretOwner = Object.keys(room.players).find(id => room.players[id] === p); } });
  mk({ id: 'armor', g: 'Takım', name: 'Çelik duvar', ic: '🧱', desc: 'Bölgenin aldığı hasar -%10', lvl: room.armor, max: 5, cost: 200 + 150 * room.armor, buy: () => room.armor++ });
  mk({ id: 'repair', g: 'Takım', name: 'Bölgeyi onar', ic: '🔧', desc: 'Bölge canı +150', lvl: 0, max: 99, cost: 100, off: room.baseHp >= room.baseMax - 0.5, buy: () => { room.baseHp = Math.min(room.baseMax, room.baseHp + 150); } });
  mk({ id: 'basehp', g: 'Takım', name: 'Güçlendirilmiş üs', ic: '🏰', desc: 'Maks. bölge canı +150', lvl: room.baseUp, max: 4, cost: 250 + 150 * room.baseUp, buy: () => { room.baseUp++; room.baseMax += 150; room.baseHp += 150; } });
  return L;
}

function sendShop(room) {
  for (const [id, p] of Object.entries(room.players)) {
    const s = io.sockets.sockets.get(id);
    if (s) s.emit('shop', { items: catalog(room, p).map(({ buy, ...i }) => i) });
  }
}

// ---------- OYUN ----------
function genObstacles() {
  const out = [];
  let tries = 0;
  while (out.length < 16 && tries++ < 500) {
    const r = 22 + Math.random() * 22;
    const x = 90 + Math.random() * (W - 180), y = 90 + Math.random() * (H - 180);
    if (Math.hypot(x - BASE.x, y - BASE.y) < ZONE_R + r + 80) continue;
    if (out.some(o => Math.hypot(o.x - x, o.y - y) < o.r + r + 70)) continue;
    out.push({ x: Math.round(x), y: Math.round(y), r: Math.round(r), k: Math.random() < 0.5 ? 0 : 1 });
  }
  return out;
}

function startGame(room) {
  room.state = 'playing';
  room.wave = 0;
  room.obstacles = genObstacles();
  room.seed = Math.floor(Math.random() * 1e9);
  startNextWave(room);
  io.to(roomName(room)).emit('start', { W, H, BASE, ZONE_R, obstacles: room.obstacles, seed: room.seed });
  io.emit('roomList', summary());
  room.loop = setInterval(() => tick(room), 1000 / TICK);
}

function startNextWave(room) {
  room.wave++;
  room.phase = 'wave';
  const n = Object.keys(room.players).length;
  const boss = room.wave % 5 === 0;
  room.toSpawn = 6 + room.wave * 4 + n * 3 + (boss ? 1 : 0);
  room.bossPending = boss;
  room.spawnTimer = 1.5;
  for (const p of Object.values(room.players)) p.skip = false;
  fx(room, 'wave', room.wave, boss ? 1 : 0);
}

function startShop(room) {
  room.phase = 'shop';
  room.shopT = SHOP_TIME;
  room.bullets = [];
  const bonus = 25 + room.wave * 5;
  for (const p of Object.values(room.players)) {
    if (!p.alive) {
      p.alive = true; p.hp = p.maxHp * 0.6;
      p.x = BASE.x + (Math.random() - 0.5) * 80; p.y = BASE.y + (Math.random() - 0.5) * 80;
      fx(room, 'revive', p.x, p.y);
    } else p.hp = Math.min(p.maxHp, p.hp + 25);
    p.gold += bonus; p.skip = false;
  }
  room.baseHp = Math.min(room.baseMax, room.baseHp + 40);
  fx(room, 'shop', room.wave, bonus);
  sendShop(room);
}

function pickType(w) {
  const o = [['walker', 10]];
  if (w >= 2) o.push(['runner', 3 + w]);
  if (w >= 3) o.push(['bomber', 2 + w * 0.5]);
  if (w >= 4) o.push(['brute', 1 + w * 0.6]);
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
  const t = ZT[type];
  const hp = t.hp(room.wave);
  room.zombies.push({ id: room.nextId++, type, x, y, hp, maxHp: hp, speed: t.spd(room.wave), r: t.r, dmg: t.dmg, sumT: 4 });
  if (type === 'boss') fx(room, 'roar', x, y);
}

function pushOut(e, r, obs) {
  for (const o of obs) {
    const dx = e.x - o.x, dy = e.y - o.y, d = Math.hypot(dx, dy) || 0.01, m = o.r + r;
    if (d < m) { e.x = o.x + dx / d * m; e.y = o.y + dy / d * m; }
  }
}

const armorMult = (room) => 1 - 0.1 * room.armor;

function hurtPlayer(room, p, amount) {
  p.hp -= amount;
  if (p.hurtT <= 0) { fx(room, 'hurt', idOf(room, p)); p.hurtT = 0.3; }
  if (p.hp <= 0) {
    p.hp = 0; p.alive = false;
    fx(room, 'pdead', p.x, p.y);
    say(room, p.name + ' düştü!');
  }
}
const idOf = (room, p) => Object.keys(room.players).find(id => room.players[id] === p);

function damageBase(room, a) {
  room.baseHp -= a * armorMult(room);
  if (room.baseFxT <= 0) { fx(room, 'basehit'); room.baseFxT = 0.4; }
}

function dropPickup(room, x, y, t) {
  room.pickups.push({ id: room.nextId++, x, y, t, life: 15 });
}

function explosion(room, x, y, killer) {
  fx(room, 'boom', x, y, 85);
  for (const p of Object.values(room.players)) {
    if (p.alive && Math.hypot(p.x - x, p.y - y) < 85) hurtPlayer(room, p, 35);
  }
  if (Math.hypot(BASE.x - x, BASE.y - y) < 110) damageBase(room, 30);
  for (const o of room.zombies) {
    if (o.dead || Math.hypot(o.x - x, o.y - y) > 85) continue;
    o.hp -= 45;
    if (o.hp <= 0) killZombie(room, o, killer);
  }
}

function killZombie(room, z, killerId) {
  if (z.dead) return;
  z.dead = true; z.hp = 0;
  const t = ZT[z.type];
  const p = killerId && room.players[killerId];
  let coin = 0;
  if (p) { p.score += t.score; p.gold += t.coin; p.kills++; coin = t.coin; }
  fx(room, 'kill', z.x, z.y, ZT_LIST.indexOf(z.type), killerId || '', coin);
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
  room.bullets.push({
    x, y, ang, vx: Math.cos(ang) * w.speed, vy: Math.sin(ang) * w.speed,
    spd: w.speed, life: w.life, owner, dmg, pierce: w.pierce, hit: new Set(), col: w.col
  });
}

function tick(room) {
  const now = Date.now();
  const ents = Object.entries(room.players);
  room.tickN++;
  room.baseFxT -= DT;

  // 1) oyuncular
  for (const [id, p] of ents) {
    p.hurtT -= DT;
    p.rage = Math.max(0, p.rage - DT);
    p.haste = Math.max(0, p.haste - DT);
    p.dashCd = Math.max(0, p.dashCd - DT);
    if (!p.alive) continue;
    const i = p.input;
    const dx = (i.right ? 1 : 0) - (i.left ? 1 : 0), dy = (i.down ? 1 : 0) - (i.up ? 1 : 0);
    const len = Math.hypot(dx, dy);
    p.angle = i.angle;
    if (i.dash && p.dashCd <= 0) {
      p.dashCd = DASH_CD; p.dashT = 0.15;
      if (len > 0) { p.dvx = dx / len; p.dvy = dy / len; }
      else { p.dvx = Math.cos(p.angle); p.dvy = Math.sin(p.angle); }
      fx(room, 'dash', p.x, p.y, Math.atan2(p.dvy, p.dvx));
    }
    if (p.dashT > 0) {
      p.dashT -= DT;
      p.x += p.dvx * DASH_SPEED * DT; p.y += p.dvy * DASH_SPEED * DT;
    } else if (len > 0) {
      const sp = PLAYER_SPEED * (1 + 0.06 * p.up.speed);
      p.x += dx / len * sp * DT; p.y += dy / len * sp * DT;
    }
    p.x = clamp(p.x, 12, W - 12); p.y = clamp(p.y, 12, H - 12);
    pushOut(p, 12, room.obstacles);
    p.x = clamp(p.x, 12, W - 12); p.y = clamp(p.y, 12, H - 12);

    if (p.hp < p.maxHp && Math.hypot(p.x - BASE.x, p.y - BASE.y) < ZONE_R) p.hp = Math.min(p.maxHp, p.hp + 6 * DT);

    const wp = WEAPONS[p.weapon];
    const delay = wp.delay / (1 + 0.1 * p.up.rate) / (p.haste > 0 ? 1.6 : 1);
    if (i.shoot && now - p.lastShot > delay) {
      p.lastShot = now;
      const dmg = wp.dmg * (1 + 0.15 * p.up.dmg) * (p.rage > 0 ? 2 : 1);
      for (let k = 0; k < wp.pellets; k++) {
        const a = p.angle + (Math.random() - 0.5) * wp.spread;
        addBullet(room, p.x + Math.cos(a) * 18, p.y + Math.sin(a) * 18, a, wp, dmg, id);
      }
      fx(room, 'shoot', p.x, p.y, +p.angle.toFixed(2), wp.col, id);
    }
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

  // 3) zombiler
  const zs = room.zombies;
  for (const z of zs) {
    if (z.dead) continue;
    let tx = BASE.x, ty = BASE.y, best = 240;
    for (const p of living) {
      const d = Math.hypot(p.x - z.x, p.y - z.y);
      if (d < best) { best = d; tx = p.x; ty = p.y; }
    }
    const dx = tx - z.x, dy = ty - z.y, d = Math.hypot(dx, dy) || 1;
    z.x += dx / d * z.speed * DT;
    z.y += dy / d * z.speed * DT;
    if (z.type === 'boss') {
      z.sumT -= DT;
      if (z.sumT <= 0) {
        z.sumT = 5;
        fx(room, 'roar', z.x, z.y);
        for (let k = 0; k < 3; k++) spawnZombie(room, 'walker', z.x + (Math.random() - 0.5) * 60, z.y + (Math.random() - 0.5) * 60);
      }
    }
  }
  // yumuşak ayrışma + engeller
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
  }
  // temas hasarı
  for (const z of zs) {
    if (z.dead) continue;
    for (const p of living) {
      if (!p.alive || Math.hypot(p.x - z.x, p.y - z.y) > z.r + 11) continue;
      if (z.type === 'bomber') { killZombie(room, z, null); break; }
      hurtPlayer(room, p, z.dmg * DT);
    }
    if (z.dead) continue;
    if (Math.hypot(BASE.x - z.x, BASE.y - z.y) < 30 + z.r) {
      if (z.type === 'bomber') killZombie(room, z, null);
      else damageBase(room, z.dmg * 0.55 * DT);
    }
  }

  // 4) tareter
  for (let t = 0; t < room.turretN; t++) {
    const ang0 = t / room.turretN * Math.PI * 2 + 0.4;
    const tx = BASE.x + Math.cos(ang0) * 88, ty = BASE.y + Math.sin(ang0) * 88;
    room.turretCd[t] -= DT;
    let tgt = null, bd = 320;
    for (const z of zs) {
      if (z.dead) continue;
      const d = Math.hypot(z.x - tx, z.y - ty);
      if (d < bd) { bd = d; tgt = z; }
    }
    if (tgt) {
      room.turretA[t] = Math.atan2(tgt.y - ty, tgt.x - tx);
      if (room.turretCd[t] <= 0) {
        room.turretCd[t] = 0.45;
        addBullet(room, tx, ty, room.turretA[t], { speed: 900, life: 0.5, pierce: 0, col: 4 }, 16, room.turretOwner);
        fx(room, 'tshoot', tx, ty, +room.turretA[t].toFixed(2));
      }
    }
  }

  // 5) mermiler (2 alt adım: ince hedeflerden geçmesin)
  for (const b of room.bullets) {
    for (let s = 0; s < 2 && b.life > 0; s++) {
      b.x += b.vx * DT / 2; b.y += b.vy * DT / 2; b.life -= DT / 2;
      for (const o of room.obstacles) { if (Math.hypot(o.x - b.x, o.y - b.y) < o.r) { b.life = 0; break; } }
      if (b.life <= 0) break;
      for (const z of zs) {
        if (z.dead || b.hit.has(z.id) || Math.hypot(z.x - b.x, z.y - b.y) > z.r + 4) continue;
        const crit = Math.random() < 0.1;
        const d = b.dmg * (crit ? 2 : 1);
        z.hp -= d; b.hit.add(z.id);
        const kb = z.type === 'boss' ? 0 : z.type === 'brute' ? 1 : 3;
        z.x += Math.cos(b.ang) * kb; z.y += Math.sin(b.ang) * kb;
        fx(room, 'hit', Math.round(z.x), Math.round(z.y), Math.round(d), crit ? 1 : 0, +b.ang.toFixed(2));
        if (z.hp <= 0) killZombie(room, z, b.owner);
        if (b.pierce > 0) b.pierce--; else { b.life = 0; break; }
      }
    }
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
      else p.haste = 10;
      fx(room, 'pick', pk.x, pk.y, pk.t, idOf(room, p));
      pk.life = 0;
      break;
    }
  }
  room.pickups = room.pickups.filter(pk => pk.life > 0);

  // 7) dalga akışı
  if (room.phase === 'wave') {
    if (room.toSpawn === 0 && room.zombies.length === 0) startShop(room);
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
  io.to(roomName(room)).emit('state', {
    ph: room.phase, shopT: Math.max(0, Math.ceil(room.shopT)),
    skips: ents.filter(([, p]) => p.skip).length, np: ents.length,
    players: ents.map(([id, p]) => ({
      id, name: p.name, x: Math.round(p.x), y: Math.round(p.y), hp: Math.round(p.hp), mhp: p.maxHp,
      alive: p.alive, a: +p.angle.toFixed(2), score: p.score, gold: p.gold, kills: p.kills,
      w: p.weapon, ws: Object.keys(p.weapons), rage: +p.rage.toFixed(1), haste: +p.haste.toFixed(1),
      dcd: +p.dashCd.toFixed(1)
    })),
    zombies: room.zombies.map(z => [z.id, Math.round(z.x), Math.round(z.y), +(z.hp / z.maxHp).toFixed(2), ZT_LIST.indexOf(z.type)]),
    bullets: room.bullets.map(b => [Math.round(b.x), Math.round(b.y), +b.ang.toFixed(2), b.col, Math.round(b.spd / 10)]),
    pickups: room.pickups.map(p => [p.id, Math.round(p.x), Math.round(p.y), p.t]),
    turrets: room.turretA.map((a, t) => {
      const a0 = t / room.turretN * Math.PI * 2 + 0.4;
      return [Math.round(BASE.x + Math.cos(a0) * 88), Math.round(BASE.y + Math.sin(a0) * 88), +a.toFixed(2)];
    }),
    baseHp: Math.max(0, Math.round(room.baseHp)), baseMax: room.baseMax, armor: room.armor,
    wave: room.wave, left: room.toSpawn + room.zombies.length,
    fx: room.fx
  });
  room.fx = [];
}

function endGame(room, reason) {
  clearInterval(room.loop);
  room.state = 'over';
  const scores = Object.values(room.players)
    .map(p => ({ name: p.name, score: p.score, kills: p.kills }))
    .sort((a, b) => b.score - a.score);
  io.to(roomName(room)).emit('gameover', { reason, wave: room.wave, scores });
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
