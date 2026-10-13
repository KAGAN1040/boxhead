const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static('public'));

// ---------- AYARLAR ----------
const W = 1000, H = 700;           // harita boyutu
const BASE = { x: 500, y: 350 };   // korunacak bolgenin merkezi
const ZONE_R = 130;                // korunan bolge yaricapi
const MAX_PLAYERS = 5;
const TICK = 30;                   // saniyede 30 guncelleme
const DT = 1 / TICK;
const PLAYER_SPEED = 190;
const BULLET_SPEED = 750;
const BULLET_DMG = 12;
const FIRE_DELAY = 180;            // ms
const BASE_HP = 500;

// ---------- ODALAR ----------
const rooms = {};
for (let i = 1; i <= 3; i++) {
  rooms[i] = newRoom(i);
}

function newRoom(id) {
  return {
    id, state: 'lobby', counter: 0,
    players: {}, zombies: [], bullets: [],
    baseHp: BASE_HP, wave: 0, toSpawn: 0, spawnTimer: 0, breakTimer: 0,
    loop: null
  };
}

function resetRoom(room) {
  clearInterval(room.loop);
  const fresh = newRoom(room.id);
  Object.keys(room).forEach(k => delete room[k]);
  Object.assign(room, fresh);
}

const roomName = (r) => 'room' + r.id;
const summary = () => Object.values(rooms).map(r => ({
  id: r.id, count: Object.keys(r.players).length, max: MAX_PLAYERS, state: r.state
}));
const lobbyData = (r) => ({
  roomId: r.id,
  players: Object.entries(r.players).map(([id, p]) => ({ id, name: p.name, ready: p.ready }))
});

// ---------- BAGLANTI ----------
io.on('connection', (socket) => {
  socket.emit('roomList', summary());

  socket.on('join', (roomId) => {
    if (socket.roomId) return;
    const room = rooms[roomId];
    if (!room) return;
    if (room.state !== 'lobby') return socket.emit('err', 'Bu odada oyun basladi.');
    if (Object.keys(room.players).length >= MAX_PLAYERS) return socket.emit('err', 'Oda dolu.');

    room.counter++;
    socket.join(roomName(room));
    socket.roomId = room.id;
    room.players[socket.id] = {
      name: 'Oyuncu ' + room.counter, ready: false, alive: true,
      x: BASE.x + (Math.random() - 0.5) * 80, y: BASE.y + (Math.random() - 0.5) * 80,
      hp: 100, angle: 0, score: 0, lastShot: 0,
      input: { up: false, down: false, left: false, right: false, shoot: false, angle: 0 }
    };
    io.to(roomName(room)).emit('lobby', lobbyData(room));
    io.emit('roomList', summary());
  });

  socket.on('ready', () => {
    const room = rooms[socket.roomId];
    if (!room || room.state !== 'lobby') return;
    const p = room.players[socket.id];
    if (!p) return;
    p.ready = !p.ready;   // tekrar basinca iptal
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
      shoot: !!inp.shoot, angle: Number(inp.angle) || 0
    };
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
    // kalanlar hepsi hazirsa baslat
    const all = Object.values(room.players);
    if (all.every(pl => pl.ready)) startGame(room);
  }
  io.emit('roomList', summary());
}

// ---------- OYUN ----------
function startGame(room) {
  room.state = 'playing';
  room.wave = 0;
  startNextWave(room);
  io.to(roomName(room)).emit('start', { W, H, BASE, ZONE_R });
  io.emit('roomList', summary());
  room.loop = setInterval(() => tick(room), 1000 / TICK);
}

function startNextWave(room) {
  room.wave++;
  const n = Object.keys(room.players).length;
  room.toSpawn = 6 + room.wave * 4 + n * 3;
  room.spawnTimer = 0;
  room.breakTimer = 0;
}

function spawnZombie(room) {
  const side = Math.floor(Math.random() * 4);
  let x, y;
  if (side === 0) { x = Math.random() * W; y = -20; }
  else if (side === 1) { x = W + 20; y = Math.random() * H; }
  else if (side === 2) { x = Math.random() * W; y = H + 20; }
  else { x = -20; y = Math.random() * H; }
  const hp = 24 + room.wave * 6;
  room.zombies.push({ x, y, hp, maxHp: hp, speed: 55 + Math.min(room.wave * 4, 60) + Math.random() * 15 });
}

function tick(room) {
  const now = Date.now();
  const players = Object.entries(room.players);

  // 1) oyuncular
  for (const [id, p] of players) {
    if (!p.alive) continue;
    const i = p.input;
    let dx = (i.right ? 1 : 0) - (i.left ? 1 : 0);
    let dy = (i.down ? 1 : 0) - (i.up ? 1 : 0);
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      p.x += (dx / len) * PLAYER_SPEED * DT;
      p.y += (dy / len) * PLAYER_SPEED * DT;
    }
    p.x = Math.max(12, Math.min(W - 12, p.x));
    p.y = Math.max(12, Math.min(H - 12, p.y));
    p.angle = i.angle;
    if (i.shoot && now - p.lastShot > FIRE_DELAY) {
      p.lastShot = now;
      room.bullets.push({
        x: p.x, y: p.y,
        vx: Math.cos(p.angle) * BULLET_SPEED, vy: Math.sin(p.angle) * BULLET_SPEED,
        life: 0.9, owner: id
      });
    }
  }

  // 2) zombi dogurma
  if (room.toSpawn > 0) {
    room.spawnTimer -= DT;
    if (room.spawnTimer <= 0) {
      spawnZombie(room);
      room.toSpawn--;
      room.spawnTimer = Math.max(0.25, 0.8 - room.wave * 0.04);
    }
  }

  // 3) zombiler
  for (const z of room.zombies) {
    let tx = BASE.x, ty = BASE.y;
    let best = 220;
    for (const [, p] of players) {
      if (!p.alive) continue;
      const d = Math.hypot(p.x - z.x, p.y - z.y);
      if (d < best) { best = d; tx = p.x; ty = p.y; }
    }
    const dx = tx - z.x, dy = ty - z.y;
    const d = Math.hypot(dx, dy) || 1;
    z.x += (dx / d) * z.speed * DT;
    z.y += (dy / d) * z.speed * DT;

    // oyuncuya hasar
    for (const [, p] of players) {
      if (!p.alive) continue;
      if (Math.hypot(p.x - z.x, p.y - z.y) < 20) {
        p.hp -= 22 * DT;
        if (p.hp <= 0) { p.hp = 0; p.alive = false; }
      }
    }
    // bolgeye hasar
    if (Math.hypot(BASE.x - z.x, BASE.y - z.y) < 32) {
      room.baseHp -= 12 * DT;
    }
  }

  // 4) mermiler
  for (const b of room.bullets) {
    b.x += b.vx * DT;
    b.y += b.vy * DT;
    b.life -= DT;
    for (const z of room.zombies) {
      if (z.hp > 0 && Math.hypot(z.x - b.x, z.y - b.y) < 15) {
        z.hp -= BULLET_DMG;
        b.life = 0;
        if (z.hp <= 0 && room.players[b.owner]) room.players[b.owner].score += 10;
        break;
      }
    }
  }
  room.bullets = room.bullets.filter(b => b.life > 0 && b.x > -50 && b.x < W + 50 && b.y > -50 && b.y < H + 50);
  room.zombies = room.zombies.filter(z => z.hp > 0);

  // 5) dalga gecisi
  if (room.toSpawn === 0 && room.zombies.length === 0) {
    room.breakTimer += DT;
    if (room.breakTimer > 4) startNextWave(room);
  }

  // 6) oyun sonu
  const anyAlive = players.some(([, p]) => p.alive);
  if (room.baseHp <= 0 || !anyAlive) {
    endGame(room, room.baseHp <= 0 ? 'Bolge dustu!' : 'Tum oyuncular oldu!');
    return;
  }

  // 7) durumu yolla
  io.to(roomName(room)).emit('state', {
    players: players.map(([id, p]) => ({
      id, name: p.name, x: Math.round(p.x), y: Math.round(p.y),
      hp: Math.round(p.hp), alive: p.alive, a: +p.angle.toFixed(2), score: p.score
    })),
    zombies: room.zombies.map(z => [Math.round(z.x), Math.round(z.y), z.hp / z.maxHp]),
    bullets: room.bullets.map(b => [Math.round(b.x), Math.round(b.y)]),
    baseHp: Math.max(0, Math.round(room.baseHp)),
    wave: room.wave,
    left: room.toSpawn + room.zombies.length,
    pause: room.toSpawn === 0 && room.zombies.length === 0
  });
}

function endGame(room, reason) {
  clearInterval(room.loop);
  room.state = 'over';
  const scores = Object.values(room.players)
    .map(p => ({ name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score);
  io.to(roomName(room)).emit('gameover', { reason, wave: room.wave, scores });
  io.emit('roomList', summary());

  // 8 saniye sonra herkesi lobiye at, odayi sifirla
  setTimeout(() => {
    for (const id of Object.keys(room.players)) {
      const s = io.sockets.sockets.get(id);
      if (s) { s.leave(roomName(room)); s.roomId = null; s.emit('toLobby'); }
    }
    resetRoom(room);
    io.emit('roomList', summary());
  }, 8000);
}

server.listen(process.env.PORT || 3000, () => {
  console.log('Sunucu calisiyor: http://localhost:' + (process.env.PORT || 3000));
});
