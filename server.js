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
const TICK = 60;            // simülasyon hızı
const NET_EVERY = 2;        // her 2 tick'te bir ağ paketi => 30 Hz
const DT = 1 / TICK;
const PLAYER_SPEED = 190;
const DASH_SPEED = 640, DASH_CD = 1.6;
const BASE_HP = 500;
const PREP_TIME = 15;       // hazırlık süresi (sn): market kapanır, eşyalar yerleştirilir
const MAX_ZOMBIES = 110;
const BOARD_FILE = path.join(__dirname, 'scores.json');

// col: istemcide renk/ses indeksi. mag = şarjör, rl = doldurma (sn), kb = geri tepme, bloom = seri atışta dağılma
const WEAPONS = {
  pistol:   { name: 'Tabanca',   delay: 260,  dmg: 18,  pellets: 1, spread: 0.03, speed: 850,  life: 0.9,  pierce: 0,  cost: 0,   col: 0,  mag: 15,  rl: 0.9, kb: 3,   bloom: 0.03 },
  smg:      { name: 'SMG',       delay: 95,   dmg: 9,   pellets: 1, spread: 0.14, speed: 850,  life: 0.8,  pierce: 0,  cost: 250, col: 1,  mag: 35,  rl: 1.3, kb: 2,   bloom: 0.018 },
  shotgun:  { name: 'Pompalı',   delay: 650,  dmg: 10,  pellets: 6, spread: 0.55, speed: 720,  life: 0.42, pierce: 0,  cost: 350, col: 2,  mag: 8,   rl: 1.6, kb: 4,   bloom: 0 },
  rifle:    { name: 'Tüfek',     delay: 380,  dmg: 40,  pellets: 1, spread: 0.01, speed: 1150, life: 1.1,  pierce: 2,  cost: 450, col: 3,  mag: 10,  rl: 1.4, kb: 7,   bloom: 0.06 },
  flame:    { name: 'Alev',      delay: 45,   dmg: 3.5, pellets: 1, spread: 0.38, speed: 360,  life: 0.34, pierce: 99, cost: 400, col: 5,  mag: 90,  rl: 1.8, kb: 0.4, bloom: 0, burn: true, hr: 11 },
  bazooka:  { name: 'Bazuka',    delay: 1100, dmg: 85,  pellets: 1, spread: 0.02, speed: 560,  life: 1.3,  pierce: 0,  cost: 650, col: 6,  mag: 1,   rl: 1.5, kb: 0,   bloom: 0, boom: { r: 95 } },
  tesla:    { name: 'Tesla',     delay: 380,  dmg: 24,  pellets: 1, spread: 0,    speed: 0,    life: 0,    pierce: 0,  cost: 550, col: 7,  mag: 20,  rl: 1.5, kb: 1,   bloom: 0, chain: { range: 330, jumps: 4, hop: 140 } },
  freeze:   { name: 'Dondurma',  delay: 120,  dmg: 6,   pellets: 1, spread: 0.06, speed: 700,  life: 0.6,  pierce: 0,  cost: 500, col: 8,  mag: 40,  rl: 1.5, kb: 0,   bloom: 0.01, chill: true },
  net:      { name: 'Ağ Atar',   delay: 900,  dmg: 4,   pellets: 1, spread: 0.02, speed: 620,  life: 0.8,  pierce: 0,  cost: 520, col: 9,  mag: 5,   rl: 1.6, kb: 0,   bloom: 0, net: { r: 55, t: 2.6 }, hr: 8 },
  crossbow: { name: 'Zehir Ok',  delay: 700,  dmg: 20,  pellets: 1, spread: 0.01, speed: 1000, life: 0.9,  pierce: 1,  cost: 480, col: 10, mag: 6,   rl: 1.4, kb: 2,   bloom: 0, pois: 4.5 },
  saw:      { name: 'Testere',   delay: 800,  dmg: 30,  pellets: 1, spread: 0.02, speed: 420,  life: 2.2,  pierce: 99, cost: 650, col: 11, mag: 4,   rl: 1.5, kb: 3,   bloom: 0, bounce: 3, hr: 11 },
  minigun:  { name: 'Minigun',   delay: 55,   dmg: 6,   pellets: 1, spread: 0.12, speed: 900,  life: 0.7,  pierce: 0,  cost: 750, col: 12, mag: 150, rl: 3.0, kb: 1.2, bloom: 0.02, spinup: true },
  rail:     { name: 'Rayl',      delay: 1500, dmg: 140, pellets: 1, spread: 0,    speed: 0,    life: 0,    pierce: 99, cost: 900, col: 13, mag: 3,   rl: 2.2, kb: 10,  bloom: 0, rail: true },
  blood:    { name: 'Kan Silahı', delay: 220, dmg: 55,  pellets: 1, spread: 0.02, speed: 1000, life: 0.9,  pierce: 2,  cost: 750, col: 14, mag: 99,  rl: 0.6, kb: 4,   bloom: 0.02, hpCost: 4, leech: 6 }
};
const WKEYS = Object.keys(WEAPONS);
const WCLIENT = {};
for (const [k, w] of Object.entries(WEAPONS)) {
  WCLIENT[k] = { delay: w.delay, pellets: w.pellets, spread: w.spread, speed: w.speed, life: w.life, pierce: w.pierce, col: w.col, mag: w.mag, rl: w.rl, bounce: w.bounce || 0, rail: !!w.rail, spinup: !!w.spinup };
}

const ZT_LIST = ['walker', 'runner', 'brute', 'bomber', 'boss', 'spitter', 'revenant', 'armored', 'healer',
  'splitter', 'mini', 'screamer', 'gnawer', 'sapper', 'toxic', 'shadow', 'leaper', 'shielder', 'necro'];
const ZT = {
  walker:   { r: 11, hp: w => 24 + w * 6,    spd: w => 55 + Math.min(w * 4, 60) + Math.random() * 15,  dmg: 22, coin: 5,   score: 10 },
  runner:   { r: 10, hp: w => 14 + w * 3,    spd: w => 125 + Math.min(w * 3, 50) + Math.random() * 20, dmg: 16, coin: 6,   score: 15 },
  brute:    { r: 18, hp: w => 90 + w * 18,   spd: w => 38 + Math.random() * 10,                        dmg: 45, coin: 18,  score: 40 },
  bomber:   { r: 12, hp: w => 28 + w * 4,    spd: w => 85 + Math.random() * 15,                        dmg: 0,  coin: 10,  score: 25 },
  boss:     { r: 32, hp: w => 900 + w * 150, spd: () => 48,                                            dmg: 70, coin: 150, score: 300 },
  spitter:  { r: 11, hp: w => 20 + w * 4,    spd: w => 62 + Math.random() * 10,                        dmg: 12, coin: 12,  score: 30 },
  revenant: { r: 12, hp: w => 45 + w * 8,    spd: w => 72 + Math.random() * 10,                        dmg: 26, coin: 14,  score: 35 },
  armored:  { r: 14, hp: w => 70 + w * 12,   spd: w => 50 + Math.random() * 10,                        dmg: 30, coin: 16,  score: 38 },
  healer:   { r: 11, hp: w => 30 + w * 5,    spd: w => 62 + Math.random() * 10,                        dmg: 10, coin: 15,  score: 35 },
  splitter: { r: 15, hp: w => 60 + w * 10,   spd: w => 52 + Math.random() * 8,                         dmg: 24, coin: 12,  score: 30 },
  mini:     { r: 7,  hp: w => 10 + w * 1.5,  spd: w => 120 + Math.random() * 30,                       dmg: 10, coin: 2,   score: 5 },
  screamer: { r: 11, hp: w => 26 + w * 5,    spd: w => 58 + Math.random() * 8,                         dmg: 10, coin: 14,  score: 32 },
  gnawer:   { r: 9,  hp: w => 22 + w * 4,    spd: w => 118 + Math.random() * 20,                       dmg: 14, coin: 12,  score: 28 },
  sapper:   { r: 11, hp: w => 30 + w * 5,    spd: w => 80 + Math.random() * 12,                        dmg: 0,  coin: 16,  score: 34 },
  toxic:    { r: 13, hp: w => 55 + w * 9,    spd: w => 54 + Math.random() * 8,                         dmg: 20, coin: 14,  score: 36 },
  shadow:   { r: 11, hp: w => 32 + w * 5,    spd: w => 95 + Math.random() * 15,                        dmg: 24, coin: 16,  score: 36 },
  leaper:   { r: 11, hp: w => 34 + w * 6,    spd: w => 70 + Math.random() * 10,                        dmg: 22, coin: 15,  score: 36 },
  shielder: { r: 15, hp: w => 85 + w * 14,   spd: w => 44 + Math.random() * 6,                         dmg: 30, coin: 20,  score: 42 },
  necro:    { r: 12, hp: w => 70 + w * 10,   spd: w => 48 + Math.random() * 6,                         dmg: 14, coin: 25,  score: 55 }
};

const DIFFS = {
  easy:   { hp: 0.8,  dmg: 0.7, spd: 0.95, cnt: 0.8, gold: 1,   score: 1 },
  normal: { hp: 1,    dmg: 1,   spd: 1,    cnt: 1,   gold: 1,   score: 1 },
  hard:   { hp: 1.35, dmg: 1.4, spd: 1.1,  cnt: 1.3, gold: 1.5, score: 1.5 }
};
const BIOMES = ['forest', 'city', 'desert', 'snow', 'swamp', 'factory', 'graveyard'];
const CLS_KEYS = ['soldier', 'engineer', 'medic', 'sniper'];
const EVT = [null, 'blood', 'fog', 'dark', 'drop'];
const THEMES = ['normal', 'boss', 'swarm', 'siege', 'plague', 'undead'];

const PERKS = {
  vampire:    { n: 'Vampir',          ic: '🧛', d: 'Zombi öldürünce +4 can' },
  ricochet:   { n: 'Sekme',           ic: '🎱', d: 'Mermiler engellerden bir kez seker' },
  explosive:  { n: 'Patlayıcı mermi', ic: '💥', d: 'İsabette %30 ihtimalle küçük patlama' },
  undying:    { n: 'Ölümsüz',         ic: '👼', d: 'Dalgada bir kez ölümcül hasarda 3 sn dokunulmaz' },
  crit:       { n: 'Şanslı',          ic: '🍀', d: 'Kritik vuruş şansı +%15' },
  greedy:     { n: 'Açgözlü',         ic: '🤑', d: 'Kazanılan altın +%25' },
  quick:      { n: 'Hızlı eller',     ic: '🖐️', d: 'Silah doldurma %40 daha hızlı' },
  piercing:   { n: 'Delici uç',       ic: '📌', d: 'Mermiler +1 hedef deler' },
  adrenaline: { n: 'Adrenalin',       ic: '💉', d: 'Her öldürme 2.5 sn ateş hızı verir' },
  berserk:    { n: 'Çılgın',          ic: '😡', d: 'Canın %40 altındayken hasar +%40' },
  scavenger:  { n: 'Cephane avcısı',  ic: '🎒', d: 'Atışların %20’si cephane harcamaz' },
  sprinter:   { n: 'Koşucu',          ic: '👟', d: 'Hız +%12, atılma bekleme -%30' },
  tank:       { n: 'Tank',            ic: '🛡️', d: 'Maks. can +40' },
  frostbite:  { n: 'Buz ısırığı',     ic: '🧊', d: 'Vurulan zombiler yavaşlar' },
  toxin:      { n: 'Zehirli uç',      ic: '☠️', d: 'Mermiler zehirler (zamanla hasar)' },
  turretmaster: { n: 'Taret ustası',  ic: '🗼', d: 'Senin tareterin +%25 hasar, +%15 hız' }
};

const ITEMS = {
  barricade: { n: 'Barikat',        ic: '🧱', d: 'Zombileri durdurur. +2 adet (Z)',               cost: 60, amt: 2 },
  wire:      { n: 'Dikenli tel',    ic: '🌀', d: 'Yavaşlatır ve hasar verir. +2 adet (X)',        cost: 70, amt: 2 },
  mine:      { n: 'Mayın',          ic: '🧨', d: 'Zombi basınca patlar. +2 adet (C)',             cost: 90, amt: 2 },
  crate:     { n: 'Cephane kutusu', ic: '📦', d: 'Yakındakilerin silahını anında doldurur (F)',   cost: 80, amt: 1 },
  nade:      { n: 'El bombası',     ic: '💣', d: 'Fırlat ve patlat. +3 adet (G)',                 cost: 60, amt: 3 }
};
const PLACE = { barricade: 0, wire: 1, mine: 2, crate: 3, nade: -1 };

const TT = {
  gun:    { n: 'Makineli',    ic: '🔫', cost: 140, hp: 320, range: 300, delay: 0.36, dmg: 14, d: 'Tek hedefe sürekli ateş eder. Her durumda işe yarar.',          tags: ['Tek hedef', 'Dengeli'] },
  flame:  { n: 'Alev',        ic: '🔥', cost: 180, hp: 320, range: 175, delay: 0.12, dmg: 5,  d: 'Önündeki hepsini yakar. Kalabalığa çok iyi, menzili kısa.',     tags: ['Kalabalık', 'Yakıcı', 'Kısa menzil'] },
  tesla:  { n: 'Elektrik',    ic: '⚡', cost: 230, hp: 250, range: 270, delay: 1.0,  dmg: 24, d: 'Yıldırım zombiler arasında zıplar ve zırhı deler.',             tags: ['Zincir', 'Zırh deler'] },
  poison: { n: 'Zehir',       ic: '☣️', cost: 200, hp: 260, range: 320, delay: 2.4,  dmg: 10, d: 'Geniş zehir bulutu bırakır: içindekiler erir ve yavaşlar.',     tags: ['Geniş alan', 'Zamanla hasar', 'Yavaşlatır'] },
  freeze: { n: 'Dondurma',    ic: '❄️', cost: 210, hp: 280, range: 230, delay: 1.6,  dmg: 6,  d: 'Geniş alanda yavaşlatır, 2. seviyeden sonra dondurur.',         tags: ['Kontrol', 'Geniş alan'] },
  pin:    { n: 'Sabitleyici', ic: '📍', cost: 190, hp: 300, range: 290, delay: 2.4,  dmg: 18, d: 'Yakındaki zombileri yere çiviler (seviye kadar hedef).',        tags: ['Kontrol', 'Çoklu hedef'] },
  rocket: { n: 'Roketatar',   ic: '🚀', cost: 330, hp: 300, range: 360, delay: 2.6,  dmg: 60, d: 'Patlayan roket atar, geniş alana ağır hasar verir.',           tags: ['Alan', 'Ağır hasar'] }
};
const TT_KEYS = Object.keys(TT);
const ttDmg = (t, lv) => TT[t].dmg * (1 + 0.5 * (lv - 1));
const ttRange = (t, lv) => TT[t].range * (1 + 0.08 * (lv - 1));
const cloudR = (lv) => 85 + 10 * (lv - 1);
const ttHp = (t, lv) => Math.round(TT[t].hp * (1 + 0.6 * (lv - 1)));
const ttUp = (t, lv) => Math.round(TT[t].cost * (lv === 1 ? 0.9 : 1.4));

function ttRows(t, lv) {
  const T = TT[t], rate = (1 + 0.15 * (lv - 1)) / T.delay, d = ttDmg(t, lv);
  const f = (n) => String(n >= 10 ? Math.round(n) : +n.toFixed(1));
  const spd = rate >= 1 ? f(rate) + ' atış/sn' : 'her ' + f(1 / rate) + ' sn';
  const R = [];
  switch (t) {
    case 'gun': R.push(['Hasar', f(d) + ' / mermi'], ['Hız', spd]); break;
    case 'flame': R.push(['Hasar', f(d * rate) + ' / sn'], ['Etki', 'yakar']); break;
    case 'tesla': R.push(['Hasar', f(d) + ' / vuruş'], ['Zincir', (lv + 2) + ' hedef'], ['Hız', spd]); break;
    case 'poison': R.push(['Hasar', f(d * 1.6) + ' / sn'], ['Bulut', cloudR(lv) + ' px · 5.5 sn'], ['Hız', spd]); break;
    case 'freeze': R.push(['Alan', Math.round(ttRange(t, lv)) + ' px'], ['Yavaşlatma', '%60'], ['Etki', lv >= 3 ? 'dondurur 1 sn' : lv >= 2 ? 'dondurur 0.5 sn' : 'yavaşlatır'], ['Hız', spd]); break;
    case 'pin': R.push(['Hedef', lv + ' zombi'], ['Sabitleme', f(2.8 + 0.4 * (lv - 1)) + ' sn'], ['Hasar', f(d)], ['Hız', spd]); break;
    case 'rocket': R.push(['Hasar', f(d) + ' / roket'], ['Patlama', (85 + 10 * lv) + ' px'], ['Hız', spd]); break;
  }
  R.push(['Menzil', Math.round(ttRange(t, lv))], ['Can', ttHp(t, lv)]);
  return R;
}

const AB = { soldier: { cd: 25, n: 'Adrenalin' }, engineer: { cd: 30, n: 'Aşırı Yükleme' }, medic: { cd: 22, n: 'Şifa Dalgası' }, sniper: { cd: 18, n: 'Odak' } };

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const pickOf = (a) => a[Math.floor(Math.random() * a.length)];
const angDiff = (a, b) => ((a - b + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;

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
    players: {}, zombies: [], bullets: [], pickups: [], obstacles: [], zones: [], slots: [], fx: [],
    structs: [], nades: [], spits: [], puddles: [], clouds: [], revives: [], corpses: [],
    baseHp: BASE_HP, baseMax: BASE_HP, baseUp: 0, armor: 0, fence: 0, oc: 0,
    wave: 0, toSpawn: 0, spawnTimer: 0, shopT: 0, prepT: 0, bossPending: false, evt: 0, theme: 0, wx: 1, burstAt: 0, bursted: true,
    seed: 0, tickN: 0, nextId: 1, baseFxT: 0, tickMs: 0, pkt: 0,
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
const fx = (room, ...a) => {
  const L = room.fx.length;
  if (L > 160 || (L > 70 && (a[0] === 'hit' || a[0] === 'spark'))) return;
  room.fx.push(a);
};
const say = (room, txt) => io.to(roomName(room)).emit('msg', txt);
const idOf = (room, p) => Object.keys(room.players).find(id => room.players[id] === p);

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

  socket.on('pingT', (t, cb) => { if (typeof cb === 'function' && allow(socket, 'pingT', 3)) cb(t); });

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
      hp: 100, maxHp: 100, angle: 0, lastAngle: 0, cheatCount: 0, score: 0, gold: 60, kills: 0, lastShot: 0,
      weapon: 'pistol', weapons: { pistol: true }, ammo: { pistol: WEAPONS.pistol.mag }, rl: 0, rlMax: 1, wantRl: false, bloom: 0, spin: 0,
      up: { dmg: 0, rate: 0, speed: 0, hp: 0 }, perks: {}, offer: [], picked: true,
      inv: { barricade: 0, wire: 0, mine: 0, crate: 0, nade: 0 }, placeCd: 0,
      dmgMul: 1, spdMul: 1, critBonus: 0, reviveTime: 3, reviveP: 0, god: 0, undUsed: false,
      ms: PLAYER_SPEED, abCd: 0, wantAb: false, focus: 0, spdBoost: 0, slowT: 0, slowF: 1,
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
    if (!allow(socket, 'input', 90)) return;
    const room = rooms[socket.roomId];
    if (!room || room.state !== 'playing') return;
    const p = room.players[socket.id];
    if (!p || !inp || typeof inp !== 'object') return;

    // Oto-aim / Hile Kontrolü (Açı Sınırlandırma - Turn Rate Limiting)
    const targetAngle = num(inp.angle);
    const angleDelta = Math.abs(angDiff(targetAngle, p.lastAngle));
    const MAX_TURN_SPEED = 12; // Normal bir oyuncunun dönebileceği maksimum hız (radyan/tick eşdeğeri)
    
    if (angleDelta > MAX_TURN_SPEED) {
      p.cheatCount++;
      if (p.cheatCount >= 3) {
        // Hileyi kapatmazsa odadan / sunucudan at (Ban değil, sadece atılıyor)
        socket.emit('cheatWarning', 'Hileli hareketler (Oto-aim) algılandı ve kapatılmadı. Sunucudan uzaklaştırılıyorsunuz.');
        setTimeout(() => {
          leaveRoom(socket);
          socket.disconnect(true);
        }, 300);
        return;
      } else {
        // Sadece hile yapana uyarı gönder
        socket.emit('cheatWarning', 'Dikkat: Oto-aim (Açı hilesi) tespit edildi! Lütfen kapatın, aksi takdirde sunucudan atılacaksınız. (Uyarı: ' + p.cheatCount + '/3)');
      }
    } else {
      // Hile yapmıyorsa sayaç yavaşça normale döner
      if (p.cheatCount > 0 && Math.random() < 0.05) p.cheatCount--;
    }

    p.lastAngle = targetAngle;
    p.input = {
      up: !!inp.up, down: !!inp.down, left: !!inp.left, right: !!inp.right,
      shoot: !!inp.shoot, dash: !!inp.dash, use: !!inp.use,
      angle: targetAngle, ax: clamp(num(inp.ax, p.x), 0, W), ay: clamp(num(inp.ay, p.y), 0, H)
    };
    if (inp.rl) p.wantRl = true;
    if (inp.ab) p.wantAb = true;
    if (typeof inp.w === 'string' && hasOwn(p.weapons, inp.w) && inp.w !== p.weapon) {
      p.weapon = inp.w; p.rl = 0; p.spin = 0; fx(room, 'swap', socket.id);
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

  const slotOp = (fn) => (i, type) => {
    if (!allow(socket, 'buy', 10)) return;
    const room = rooms[socket.roomId];
    if (!room || room.state !== 'playing' || room.phase !== 'shop') return;
    const p = room.players[socket.id];
    if (!p || !Number.isInteger(i) || i < 0 || i >= room.slots.length) return;
    if (fn(room, p, room.slots[i], i, type)) { socket.emit('bought'); sendShop(room); }
  };
  socket.on('tbuild', slotOp((room, p, s, i, type) => {
    if (s.t || typeof type !== 'string' || !hasOwn(TT, type)) return false;
    const cost = ttCost(p, TT[type].cost);
    if (p.gold < cost) { socket.emit('err', 'Yeterli altının yok.'); return false; }
    p.gold -= cost;
    s.t = type; s.lv = 1; s.max = ttHp(type, 1); s.hp = s.max; s.own = socket.id; s.cd = 0.5; s.emp = 0; s.inv = cost;
    fx(room, 'tbuild', i);
    say(room, p.name + ' kurdu: ' + TT[type].n + ' taret (yer ' + (i + 1) + ')');
    return true;
  }));
  socket.on('tup', slotOp((room, p, s, i) => {
    if (!s.t || s.lv >= 3) return false;
    const cost = ttCost(p, ttUp(s.t, s.lv));
    if (p.gold < cost) { socket.emit('err', 'Yeterli altının yok.'); return false; }
    p.gold -= cost; s.inv += cost;
    const frac = s.hp / s.max;
    s.lv++; s.max = ttHp(s.t, s.lv); s.hp = Math.min(s.max, s.max * frac + s.max * 0.25);
    fx(room, 'tbuild', i);
    return true;
  }));
  socket.on('trep', slotOp((room, p, s) => {
    if (!s.t || s.hp >= s.max - 0.5) return false;
    const cost = ttRepair(p, s);
    if (p.gold < cost) { socket.emit('err', 'Yeterli altının yok.'); return false; }
    p.gold -= cost; s.hp = s.max;
    return true;
  }));
  socket.on('tsell', slotOp((room, p, s, i) => {
    if (!s.t) return false;
    p.gold += Math.round(s.inv * 0.6);
    clearSlot(s); fx(room, 'tbreak', i);
    return true;
  }));

  socket.on('perk', (id) => {
    if (!allow(socket, 'buy', 10)) return;
    const room = rooms[socket.roomId];
    if (!room || room.state !== 'playing' || room.phase !== 'shop') return;
    const p = room.players[socket.id];
    if (!p || p.picked || typeof id !== 'string' || !p.offer.includes(id)) return;
    p.perks[id] = true; p.picked = true; p.offer = [];
    if (id === 'tank') { p.maxHp += 40; p.hp += 40; }
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

const ttCost = (p, c) => Math.round(c * (p.cls === 'engineer' ? 0.75 : 1));
const ttRepair = (p, s) => Math.max(5, Math.ceil((1 - s.hp / s.max) * TT[s.t].cost * 0.5 * (p.cls === 'engineer' ? 0.75 : 1)));
function clearSlot(s) { s.t = null; s.lv = 0; s.hp = 0; s.max = 0; s.own = null; s.cd = 0; s.emp = 0; s.inv = 0; }

function catalog(room, p) {
  const L = [];
  const mk = (o) => L.push(o);
  const eng = p.cls === 'engineer' ? 0.75 : 1;
  mk({ id: 'dmg', g: 'Kişisel', name: 'Hasar', ic: '💥', desc: 'Mermi hasarı +%15', lvl: p.up.dmg, max: 8, cost: 80 + 60 * p.up.dmg, buy: () => p.up.dmg++ });
  mk({ id: 'rate', g: 'Kişisel', name: 'Atış hızı', ic: '⚡', desc: 'Ateş hızı +%10, doldurma +%6', lvl: p.up.rate, max: 8, cost: 80 + 60 * p.up.rate, buy: () => p.up.rate++ });
  mk({ id: 'speed', g: 'Kişisel', name: 'Çeviklik', ic: '👟', desc: 'Hareket hızı +%6', lvl: p.up.speed, max: 5, cost: 70 + 50 * p.up.speed, buy: () => p.up.speed++ });
  mk({ id: 'hp', g: 'Kişisel', name: 'Zırh yeleği', ic: '🦺', desc: 'Maks. can +20 ve iyileştirir', lvl: p.up.hp, max: 6, cost: 60 + 50 * p.up.hp, buy: () => { p.up.hp++; p.maxHp += 20; p.hp = Math.min(p.maxHp, p.hp + 20); } });
  mk({ id: 'heal', g: 'Kişisel', name: 'Sağlık çantası', ic: '💊', desc: 'Canını doldurur', lvl: 0, max: 99, cost: 40, off: p.hp >= p.maxHp - 0.5, buy: () => { p.hp = p.maxHp; } });
  const ICON = { smg: '🔫', shotgun: '💣', rifle: '🎯', flame: '🔥', bazooka: '🚀', tesla: '⚡', freeze: '❄️', net: '🕸️', crossbow: '🏹', saw: '🪚', minigun: '⚙️', rail: '🔆', blood: '🩸' };
  const DESC = {
    smg: 'Çok hızlı, düşük hasar', shotgun: 'Yakın mesafede yıkıcı', rifle: 'Delip geçer, ağır hasar',
    flame: 'Yakar, kalabalığı eritir', bazooka: 'Roket: geniş alan patlaması', tesla: 'Zincirleme yıldırım, 5 hedefe atlar',
    freeze: 'Yavaşlatır, yeterince vurursan dondurur', net: 'Ağ atar: alandaki zombileri yere sabitler',
    crossbow: 'Zehirli ok: zamanla hasar verir', saw: 'Duvarlardan seken ölümcül testere',
    minigun: 'Isınınca saniyede 18 mermi', rail: 'Hepsini delen anlık ışın', blood: 'Her atış canından yer, vurdukça iyileştirir'
  };
  for (const k of WKEYS) {
    if (k === 'pistol') continue;
    const w = WEAPONS[k];
    mk({ id: 'w_' + k, g: 'Silahlar', name: w.name, ic: ICON[k], desc: DESC[k],
      lvl: hasOwn(p.weapons, k) ? 1 : 0, max: 1, cost: w.cost,
      buy: () => { p.weapons[k] = true; p.ammo[k] = w.mag; p.weapon = k; p.rl = 0; p.spin = 0; } });
  }
  for (const [k, it] of Object.entries(ITEMS)) {
    mk({ id: 'i_' + k, g: 'Eşya', name: it.n + ' (' + p.inv[k] + ')', ic: it.ic, desc: it.d, lvl: 0, max: 99,
      cost: Math.round(it.cost * eng), off: p.inv[k] >= 8, buy: () => { p.inv[k] = Math.min(8, p.inv[k] + it.amt); } });
  }
  mk({ id: 'armor', g: 'Takım', name: 'Çelik duvar', ic: '🧱', desc: 'Bölgenin aldığı hasar -%10', lvl: room.armor, max: 5, cost: 200 + 150 * room.armor, buy: () => room.armor++ });
  mk({ id: 'fence', g: 'Takım', name: 'Elektrikli çit', ic: '⚡', desc: 'Bölge sınırından geçen zombiler hasar alır ve yavaşlar', lvl: room.fence, max: 3, cost: 220 + 160 * room.fence, buy: () => room.fence++ });
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
      owned: Object.keys(p.perks),
      tt: TT_KEYS.map(k => ({ k, n: TT[k].n, ic: TT[k].ic, d: TT[k].d, tags: TT[k].tags, rows: ttRows(k, 1), cost: ttCost(p, TT[k].cost) })),
      slots: room.slots.map((s, i) => ({
        i, t: s.t, lv: s.lv, hp: Math.round(s.hp), max: s.max,
        up: s.t && s.lv < 3 ? ttCost(p, ttUp(s.t, s.lv)) : 0,
        rep: s.t && s.hp < s.max - 0.5 ? ttRepair(p, s) : 0,
        sell: s.t ? Math.round(s.inv * 0.6) : 0, mine: s.own === id,
        n: s.t ? TT[s.t].n : null, ic: s.t ? TT[s.t].ic : null, d: s.t ? TT[s.t].d : null, tags: s.t ? TT[s.t].tags : null,
        rows: s.t ? ttRows(s.t, s.lv) : null, rowsN: s.t && s.lv < 3 ? ttRows(s.t, s.lv + 1) : null
      }))
    });
  }
}

function pickPerks(p) {
  const pool = Object.keys(PERKS).filter(k => !p.perks[k]);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, 3);
}

const OB_KINDS = { forest: [0, 5], city: [1, 2], desert: [0, 3], snow: [4, 5], swamp: [5, 0], factory: [7, 8], graveyard: [6, 5] };
const OB_COUNT = { forest: 16, city: 22, desert: 11, snow: 14, swamp: 14, factory: 20, graveyard: 18 };
function genObstacles(biome) {
  const out = [];
  const want = OB_COUNT[biome] || 16, kinds = OB_KINDS[biome] || [0, 1];
  let tries = 0;
  while (out.length < want && tries++ < 800) {
    const r = 22 + Math.random() * 22;
    const x = 90 + Math.random() * (W - 180), y = 90 + Math.random() * (H - 180);
    if (Math.hypot(x - BASE.x, y - BASE.y) < ZONE_R + r + 120) continue;
    if (out.some(o => Math.hypot(o.x - x, o.y - y) < o.r + r + 70)) continue;
    out.push({ x: Math.round(x), y: Math.round(y), r: Math.round(r), k: kinds[Math.random() < 0.5 ? 0 : 1] });
  }
  return out;
}
function genZones(biome) {
  const k = biome === 'swamp' || biome === 'graveyard' ? 0 : biome === 'snow' ? 1 : -1;
  const out = [];
  if (k < 0) return out;
  let tries = 0;
  while (out.length < (biome === 'graveyard' ? 3 : 6) && tries++ < 300) {
    const r = 60 + Math.random() * 55;
    const x = 100 + Math.random() * (W - 200), y = 100 + Math.random() * (H - 200);
    if (Math.hypot(x - BASE.x, y - BASE.y) < ZONE_R + r + 60) continue;
    if (out.some(o => Math.hypot(o.x - x, o.y - y) < o.r + r + 20)) continue;
    out.push({ x: Math.round(x), y: Math.round(y), r: Math.round(r), k });
  }
  return out;
}
function genSlots(obstacles) {
  const cand = [];
  for (let i = 0; i < 6; i++) cand.push([255, i * Math.PI / 3 + Math.PI / 6]);
  for (let i = 0; i < 4; i++) cand.push([440, i * Math.PI / 2 + Math.PI / 4]);
  const out = [];
  for (const [r, a0] of cand) {
    let a = a0, x = 0, y = 0, ok = false;
    for (let t = 0; t < 14 && !ok; t++) {
      x = BASE.x + Math.cos(a) * r * (r > 300 ? 1.25 : 1); y = BASE.y + Math.sin(a) * r;
      x = clamp(x, 60, W - 60); y = clamp(y, 60, H - 60);
      ok = !obstacles.some(o => Math.hypot(o.x - x, o.y - y) < o.r + 34);
      if (!ok) a += 0.14;
    }
    const s = { x: Math.round(x), y: Math.round(y), a: 0, flT: 0 }; clearSlot(s); out.push(s);
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
  room.zones = genZones(room.biome);
  room.slots = genSlots(room.obstacles);
  room.seed = Math.floor(Math.random() * 1e9);
  for (const p of Object.values(room.players)) applyClass(p);
  startNextWave(room);
  io.to(roomName(room)).emit('start', {
    W, H, BASE, ZONE_R, obstacles: room.obstacles, zones: room.zones, slots: room.slots.map(s => [s.x, s.y]),
    seed: room.seed, biome: room.biome, diff: room.diff, weapons: WCLIENT
  });
  io.emit('roomList', summary());
  room.loop = setInterval(() => {
    const t0 = process.hrtime.bigint();
    try { tick(room); } catch (e) { console.error('tick hatası (oda ' + room.id + '):', e); }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    room.tickMs = room.tickMs * 0.95 + ms * 0.05;
  }, 1000 / TICK);
}

function startNextWave(room) {
  room.wave++;
  room.phase = 'wave';
  const D = DIFFS[room.diff], w = room.wave;
  const n = Object.keys(room.players).length;
  const boss = w % 5 === 0;
  const themeName = boss ? 'boss' : (w >= 3 && Math.random() < 0.55) ? pickOf(['swarm', 'siege', 'plague', 'undead']) : 'normal';
  room.theme = THEMES.indexOf(themeName);
  let cnt = (10 + w * 5.5 + n * 4) * D.cnt;
  if (themeName === 'swarm') cnt *= 1.35;
  if (themeName === 'siege') cnt *= 0.75;
  room.toSpawn = Math.round(cnt) + (boss ? 1 : 0);
  room.bossPending = boss;
  room.spawnTimer = 1.5;
  room.burstAt = Math.floor(room.toSpawn / 2); room.bursted = room.toSpawn < 14;
  room.evt = (!boss && w >= 2 && Math.random() < 0.5) ? 1 + Math.floor(Math.random() * 4) : 0;
  room.wx = Math.random() < 0.25 ? 0 : Math.random() < 0.66 ? 1 : 2;
  if (room.evt === 4) {
    for (let k = 0; k < 4; k++) {
      const a = Math.random() * Math.PI * 2, r = 190 + Math.random() * 160;
      dropPickup(room, clamp(BASE.x + Math.cos(a) * r, 40, W - 40), clamp(BASE.y + Math.sin(a) * r, 40, H - 40), k < 2 ? 3 : k === 2 ? 0 : 1, 45);
    }
  }
  for (const p of Object.values(room.players)) { p.skip = false; p.undUsed = false; }
  fx(room, 'wave', w, boss ? 1 : 0, room.evt, room.theme, room.wx);
}

function startPrep(room) {
  room.phase = 'prep';
  room.prepT = PREP_TIME;
  for (const p of Object.values(room.players)) p.skip = false;
  fx(room, 'prep', PREP_TIME);
}

function startShop(room) {
  room.phase = 'shop';
  room.shopT = 0;
  room.bullets = [];
  room.spits = []; room.puddles = []; room.nades = []; room.clouds = []; room.corpses = [];
  room.evt = 0; room.oc = 0;
  const bonus = 30 + room.wave * 6;
  for (const p of Object.values(room.players)) {
    if (!p.alive) {
      p.alive = true; p.hp = p.maxHp * 0.6; p.reviveP = 0;
      p.x = BASE.x + (Math.random() - 0.5) * 80; p.y = BASE.y + (Math.random() - 0.5) * 80;
      fx(room, 'revive', p.x, p.y);
    } else p.hp = Math.min(p.maxHp, p.hp + 25);
    gain(p, bonus); p.skip = false; p.rl = 0; p.undUsed = false; p.focus = 0; p.slowT = 0;
    p.ammo[p.weapon] = WEAPONS[p.weapon].mag;
    p.offer = pickPerks(p); p.picked = p.offer.length === 0;
  }
  const eng = Object.values(room.players).some(p => p.cls === 'engineer');
  for (const s of room.slots) { if (s.t) { s.hp = Math.min(s.max, s.hp + s.max * (eng ? 0.7 : 0.4)); s.emp = 0; } }
  room.baseHp = Math.min(room.baseMax, room.baseHp + 40);
  fx(room, 'shop', room.wave, bonus);
  sendShop(room);
}

function gain(p, n) { p.gold += Math.round(n * (p.perks.greedy ? 1.25 : 1)); }

function pickType(w, theme, hasTur) {
  const th = THEMES[theme];
  const sw = th === 'swarm', sg = th === 'siege', pl = th === 'plague', ud = th === 'undead';
  const o = [['walker', ud ? 5 : sg ? 6 : 10]];
  const add = (n, min, wt) => { if (w >= min && wt > 0) o.push([n, wt]); };
  add('runner', 2, (3 + w) * (sw ? 3 : 1));
  add('mini', 2, sw ? 8 : 0);
  add('bomber', 3, (2 + w * 0.5) * (sw ? 1.5 : 1));
  add('splitter', 3, (1.5 + w * 0.25) * (ud ? 3 : 1));
  add('brute', 4, (1 + w * 0.6) * (sg ? 3 : 1));
  add('spitter', 4, (2 + w * 0.3) * (pl ? 3 : 1));
  add('screamer', 4, (1 + w * 0.2) * (pl ? 2 : 1));
  add('gnawer', 4, hasTur ? (1.5 + w * 0.2) * (sw ? 2 : 1) : 0);
  add('armored', 5, (1 + w * 0.4) * (sg ? 3 : 1));
  add('toxic', 5, (1 + w * 0.3) * (pl ? 3 : 1));
  add('leaper', 5, (1 + w * 0.25) * (sw ? 2 : 1));
  add('healer', 6, (1 + w * 0.2) * (pl ? 2 : 1));
  add('shadow', 6, 1 + w * 0.25);
  add('sapper', 6, hasTur ? 1 + w * 0.15 : 0);
  add('revenant', 7, (1 + w * 0.4) * (ud ? 3 : 1));
  add('shielder', 7, (1 + w * 0.3) * (sg ? 3 : 1));
  add('necro', 9, (0.6 + w * 0.12) * (ud ? 3 : 1));
  let t = o.reduce((s, [, k]) => s + k, 0) * Math.random();
  for (const [n, k] of o) { if ((t -= k) <= 0) return n; }
  return 'walker';
}

function spawnZombie(room, type, x, y, noElite) {
  if (x === undefined) {
    const side = Math.floor(Math.random() * 4);
    if (side === 0) { x = Math.random() * W; y = -20; }
    else if (side === 1) { x = W + 20; y = Math.random() * H; }
    else if (side === 2) { x = Math.random() * W; y = H + 20; }
    else { x = -20; y = Math.random() * H; }
  }
  const t = ZT[type], D = DIFFS[room.diff], w = room.wave;
  let hp = t.hp(w) * D.hp * (w >= 8 ? 1 + 0.05 * (w - 8) : 1);
  const bk = type === 'boss' ? ((Math.floor(w / 5) - 1) % 4 + 4) % 4 : 0;
  if (type === 'boss') hp *= [1, 0.75, 0.9, 0.85][bk];
  const elite = !noElite && w >= 6 && type !== 'boss' && type !== 'mini' && Math.random() < Math.min(0.25, (w - 5) * 0.03);
  let spd = t.spd(w) * D.spd * (room.evt === 1 ? 1.3 : 1), dmg = t.dmg * D.dmg;
  if (elite) { hp *= 1.7; dmg *= 1.25; spd *= 1.08; }
  const z = {
    id: room.nextId++, type, x, y, hp, maxHp: hp, speed: spd, elite,
    r: t.r, dmg, sumT: bk === 1 ? 3 : 5, bt: type === 'leaper' ? 1.5 + Math.random() * 2 : 4, bs: 0, bk, dir: 0, ang: 0,
    st: 1.5 + Math.random() * 2, ht: 2, stun: 0, burn: 0, burnBy: null, fxT: 0, rev: false,
    root: 0, slowT: 0, slowF: 1, buff: 0, pois: 0, poisBy: null, chill: 0, lastAng: 0
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
function zoneMul(room, x, y) {
  let m = 1;
  for (const z of room.zones) {
    if (Math.hypot(z.x - x, z.y - y) < z.r) m = Math.min(m, z.k === 0 ? 0.6 : 0.75);
  }
  return m;
}

const CELL = 64;
function buildGrid(zs) {
  const g = new Map();
  for (const z of zs) {
    if (z.dead) continue;
    const k = (Math.floor(z.x / CELL) + 100) * 1000 + (Math.floor(z.y / CELL) + 100);
    const a = g.get(k);
    if (a) a.push(z); else g.set(k, [z]);
  }
  return g;
}
function gridQuery(g, x, y, r, out) {
  out.length = 0;
  const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL), y0 = Math.floor((y - r) / CELL), y1 = Math.floor((y + r) / CELL);
  for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
    const a = g.get((cx + 100) * 1000 + (cy + 100));
    if (a) for (let i = 0; i < a.length; i++) out.push(a[i]);
  }
  return out;
}
const _q = [];

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

function explosion(room, x, y, killer) {
  fx(room, 'boom', Math.round(x), Math.round(y), 85);
  for (const p of Object.values(room.players)) {
    if (p.alive && Math.hypot(p.x - x, p.y - y) < 85) hurtPlayer(room, p, 35);
  }
  if (Math.hypot(BASE.x - x, BASE.y - y) < 110) damageBase(room, 30);
  for (const s of room.structs) if ((s.k === 0 || s.k === 1) && Math.hypot(s.x - x, s.y - y) < 85) s.hp -= 60;
  for (const s of room.slots) if (s.t && Math.hypot(s.x - x, s.y - y) < 85) s.hp -= 20;
  for (const o of room.zombies) {
    if (o.dead || Math.hypot(o.x - x, o.y - y) > 85) continue;
    o.hp -= 45;
    if (o.hp <= 0) killZombie(room, o, killer);
  }
}

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

function applySlow(z, t, f) { if (z.slowT <= 0 || f <= z.slowF) { z.slowT = Math.max(z.slowT, t); z.slowF = f; } }
function applyRoot(z, t) { if (z.type === 'boss') applySlow(z, t * 0.6, 0.4); else z.root = Math.max(z.root, t); }

function hitZombie(room, z, dmg, owner, ang, o = {}) {
  if (z.dead) return 0;
  const op = owner && room.players[owner];
  const cc = 0.1 + (op ? (op.perks.crit ? 0.15 : 0) + op.critBonus : 0);
  const crit = !o.noCrit && Math.random() < cc;
  let d = dmg * (crit ? 2 : 1), blocked = false;
  if ((z.type === 'armored' || z.type === 'shielder') && !o.pierceArmor && Math.cos(ang - z.ang) < -0.55) {
    d *= z.type === 'shielder' ? 0.05 : 0.2; blocked = true;
  }
  z.hp -= d; z.lastAng = ang;
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
  const ang = +z.lastAng.toFixed(2);
  if (z.type === 'revenant' && !z.rev) {
    room.revives.push({ x: z.x, y: z.y, t: 3 });
    fx(room, 'kill', Math.round(z.x), Math.round(z.y), idx, '', 0, ang, 0, 0);
    fx(room, 'ghoul', Math.round(z.x), Math.round(z.y), 0);
    return;
  }
  const D = DIFFS[room.diff];
  const p = killerId && room.players[killerId];
  let coin = 0;
  if (p) {
    coin = Math.round(t.coin * D.gold * (room.evt === 1 ? 1.25 : 1) * (z.elite ? 2 : 1));
    p.score += Math.round(t.score * D.score * (z.elite ? 2 : 1)); p.kills++;
    const before = p.gold; gain(p, coin); coin = p.gold - before;
    if (p.perks.vampire && p.alive) p.hp = Math.min(p.maxHp, p.hp + 4);
    if (p.perks.adrenaline) p.haste = Math.max(p.haste, 2.5);
  }
  fx(room, 'kill', Math.round(z.x), Math.round(z.y), idx, killerId || '', coin, ang, z.bk, z.elite ? 1 : 0);
  if (z.type !== 'mini' && z.type !== 'boss' && room.corpses.length < 50) room.corpses.push({ x: z.x, y: z.y, t: 11 });
  if (z.type === 'boss') {
    for (let k = 0; k < 4; k++) dropPickup(room, z.x + (Math.random() - 0.5) * 80, z.y + (Math.random() - 0.5) * 80, k % 3);
  } else {
    const r = Math.random() * (z.elite ? 0.5 : 1);
    if (r < 0.06) dropPickup(room, z.x, z.y, 0);
    else if (r < 0.09) dropPickup(room, z.x, z.y, 1);
    else if (r < 0.12) dropPickup(room, z.x, z.y, 2);
  }
  if (z.type === 'bomber') explosion(room, z.x, z.y, killerId);
  else if (z.type === 'splitter') {
    for (let k = 0; k < 2; k++) spawnZombie(room, 'mini', z.x + (k ? 10 : -10), z.y, true);
    fx(room, 'split', Math.round(z.x), Math.round(z.y));
  } else if (z.type === 'toxic') {
    room.puddles.push({ x: z.x, y: z.y, r: 62, t: 6, max: 6 });
    fx(room, 'splash', Math.round(z.x), Math.round(z.y));
  } else if (z.type === 'sapper') emp(room, z.x, z.y);
}

function emp(room, x, y) {
  fx(room, 'emp', Math.round(x), Math.round(y), 170);
  for (const s of room.slots) if (s.t && Math.hypot(s.x - x, s.y - y) < 170) s.emp = 5;
}

function addBullet(room, x, y, ang, w, dmg, owner, extra) {
  const op = room.players[owner];
  const pk = op ? op.perks : {};
  const b = {
    x, y, ang, vx: Math.cos(ang) * w.speed, vy: Math.sin(ang) * w.speed,
    spd: w.speed, life: w.life, owner, dmg,
    pierce: (w.pierce || 0) + (pk.piercing && (w.pierce || 0) < 50 ? 1 : 0) + (op && op.cls === 'sniper' && w.col === 3 ? 1 : 0),
    hit: new Set(), col: w.col, kb: w.kb || 0, hr: w.hr || 4,
    bounce: (w.bounce || 0) + (pk.ricochet ? 1 : 0), exp: !!pk.explosive, burn: !!w.burn, boom: w.boom || null,
    chill: !!w.chill, net: w.net || null, pois: w.pois || (pk.toxin ? 2.5 : 0), leech: w.leech || 0, frost: !!pk.frostbite
  };
  if (extra) Object.assign(b, extra);
  room.bullets.push(b);
}

function startReload(room, id, p) {
  const w = WEAPONS[p.weapon];
  if (p.rl > 0 || p.ammo[p.weapon] >= w.mag) return;
  p.rlMax = w.rl / (1 + 0.06 * p.up.rate) / (p.perks.quick ? 1.4 : 1);
  p.rl = p.rlMax;
  fx(room, 'reload', id, +p.rlMax.toFixed(2));
}

function zapFrom(room, owner, sx, sy, ang, dmg, c, kb) {
  let best = null, bd = 1e9;
  for (const z of room.zombies) {
    if (z.dead) continue;
    const dx = z.x - sx, dy = z.y - sy, d = Math.hypot(dx, dy);
    if (d > c.range || d < 1) continue;
    if (Math.abs(angDiff(Math.atan2(dy, dx), ang)) > 0.3 + z.r / d) continue;
    if (d < bd) { bd = d; best = z; }
  }
  const pts = [Math.round(sx), Math.round(sy)];
  if (!best) {
    pts.push(Math.round(sx + Math.cos(ang) * c.range * 0.6), Math.round(sy + Math.sin(ang) * c.range * 0.6));
    fx(room, 'zap', owner, pts);
    return;
  }
  const hit = new Set();
  let cur = best, d0 = dmg, px = sx, py = sy;
  for (let j = 0; j <= c.jumps && cur; j++) {
    hit.add(cur.id);
    pts.push(Math.round(cur.x), Math.round(cur.y));
    const a = Math.atan2(cur.y - py, cur.x - px);
    px = cur.x; py = cur.y;
    const from = cur;
    hitZombie(room, cur, d0, owner, a, { kb: kb || 0, pierceArmor: true });
    d0 *= 0.8;
    cur = null; let nd = c.hop;
    for (const z of room.zombies) {
      if (z.dead || hit.has(z.id)) continue;
      const d = Math.hypot(z.x - from.x, z.y - from.y);
      if (d < nd) { nd = d; cur = z; }
    }
  }
  fx(room, 'zap', owner, pts);
}

function railFire(room, id, p, wp, dmg) {
  const a = p.angle, ca = Math.cos(a), sa = Math.sin(a), sx = p.x + ca * 18, sy = p.y + sa * 18;
  let len = 1100;
  for (const o of room.obstacles) {
    const ox = o.x - sx, oy = o.y - sy, t = ox * ca + oy * sa;
    if (t < 0) continue;
    const perp = Math.abs(-ox * sa + oy * ca);
    if (perp < o.r) len = Math.min(len, t - Math.sqrt(o.r * o.r - perp * perp));
  }
  for (const z of room.zombies) {
    if (z.dead) continue;
    const zx = z.x - sx, zy = z.y - sy, t = zx * ca + zy * sa;
    if (t < 0 || t > len) continue;
    if (Math.abs(-zx * sa + zy * ca) <= z.r + 5) hitZombie(room, z, dmg, id, a, { kb: wp.kb, pierceArmor: true });
  }
  fx(room, 'rail', id, Math.round(sx), Math.round(sy), Math.round(sx + ca * len), Math.round(sy + sa * len));
}

function fire(room, id, p, wp, now) {
  if (wp.hpCost) {
    if (p.hp <= wp.hpCost + 1) return;
    p.hp -= wp.hpCost;
  }
  p.lastShot = now;
  if (!(p.perks.scavenger && Math.random() < 0.2)) p.ammo[p.weapon]--;
  let dmg = wp.dmg * (1 + 0.15 * p.up.dmg) * (p.rage > 0 ? 2 : 1) * p.dmgMul * (p.cls === 'sniper' && p.weapon === 'rifle' ? 1.25 : 1);
  if (p.perks.berserk && p.hp < p.maxHp * 0.4) dmg *= 1.4;
  let extra = null;
  if (p.focus > 0) { dmg *= 4; extra = { pierce: 99 }; p.focus = 0; fx(room, 'focus', id); }
  if (wp.chain) zapFrom(room, id, p.x + Math.cos(p.angle) * 18, p.y + Math.sin(p.angle) * 18, p.angle, dmg, wp.chain, wp.kb);
  else if (wp.rail) railFire(room, id, p, wp, dmg);
  else {
    const spread = wp.spread + p.bloom;
    for (let k = 0; k < wp.pellets; k++) {
      const a = p.angle + (Math.random() - 0.5) * spread;
      addBullet(room, p.x + Math.cos(a) * 18, p.y + Math.sin(a) * 18, a, wp, dmg, id, extra);
    }
  }
  p.bloom = Math.min(0.15, p.bloom + wp.bloom);
  if (wp.hpCost) fx(room, 'bleed', id);
  if ((wp.col !== 5 && wp.col !== 12) || (p.fxN++ % 3) === 0) fx(room, 'shoot', Math.round(p.x), Math.round(p.y), +p.angle.toFixed(2), wp.col, id);
}

function revivePlayer(room, helper, dead) {
  dead.alive = true; dead.hp = dead.maxHp * 0.5; dead.reviveP = 0; dead.god = 2;
  fx(room, 'revive', dead.x, dead.y);
  say(room, helper.name + ' ➜ ' + dead.name + ' ayağa kalktı!');
}

function spitAt(room, z, tx, ty) {
  const dx = tx - z.x, dy = ty - z.y, d = Math.hypot(dx, dy) || 1;
  room.spits.push({ x: z.x, y: z.y, tx, ty, vx: dx / d * 260, vy: dy / d * 260, left: d });
}
function spit(room, z, p) { spitAt(room, z, p.x, p.y); fx(room, 'spit', Math.round(z.x), Math.round(z.y)); }

function summon(room, z, n, kinds) {
  fx(room, 'roar', Math.round(z.x), Math.round(z.y));
  for (let k = 0; k < n; k++) {
    const type = kinds ? kinds[k % kinds.length] : (k === 3 ? 'runner' : 'walker');
    spawnZombie(room, type, z.x + (Math.random() - 0.5) * 60, z.y + (Math.random() - 0.5) * 60, true);
  }
}

function stomp(room, z) {
  fx(room, 'stomp', Math.round(z.x), Math.round(z.y), 150);
  for (const p of Object.values(room.players)) {
    if (!p.alive) continue;
    const dx = p.x - z.x, dy = p.y - z.y, d = Math.hypot(dx, dy) || 1;
    if (d < 150) { hurtPlayer(room, p, 35 * DIFFS[room.diff].dmg); p.x = clamp(p.x + dx / d * 45, 12, W - 12); p.y = clamp(p.y + dy / d * 45, 12, H - 12); }
  }
  if (Math.hypot(BASE.x - z.x, BASE.y - z.y) < 180) damageBase(room, 25);
  for (const s of room.slots) if (s.t && Math.hypot(s.x - z.x, s.y - z.y) < 150) s.hp -= 25;
}

function scream(room, z) {
  fx(room, 'scream', Math.round(z.x), Math.round(z.y));
  for (const o of room.zombies) if (!o.dead && Math.hypot(o.x - z.x, o.y - z.y) < 230) o.buff = 4;
  for (const p of Object.values(room.players)) {
    if (p.alive && Math.hypot(p.x - z.x, p.y - z.y) < 230) { p.slowT = 2; p.slowF = 0.6; }
  }
}

function useAbility(room, id, p) {
  if (p.abCd > 0 || !p.alive) return;
  p.abCd = AB[p.cls].cd;
  fx(room, 'ability', id, p.cls);
  if (p.cls === 'soldier') { p.haste = Math.max(p.haste, 6); p.rage = Math.max(p.rage, 4); p.dashCd = 0; p.spdBoost = 6; }
  else if (p.cls === 'engineer') {
    room.oc = 10;
    for (const s of room.slots) if (s.t) { s.hp = Math.min(s.max, s.hp + s.max * 0.5); s.emp = 0; }
  } else if (p.cls === 'medic') {
    for (const o of Object.values(room.players)) {
      if (o.alive && Math.hypot(o.x - p.x, o.y - p.y) < 300) { o.hp = Math.min(o.maxHp, o.hp + 65); o.slowT = 0; }
    }
  } else if (p.cls === 'sniper') p.focus = 8;
}

function turretTick(room, s, i, eng, hasPerkRate) {
  s.flT = Math.max(0, s.flT - DT); s.emp = Math.max(0, s.emp - DT);
  if (!s.t || s.emp > 0) return;
  s.cd -= DT;
  const T = TT[s.t], lv = s.lv, range = ttRange(s.t, lv);
  let tgt = null, bd = range;
  for (const z of room.zombies) {
    if (z.dead) continue;
    const d = Math.hypot(z.x - s.x, z.y - s.y);
    if (d < bd) { bd = d; tgt = z; }
  }
  if (!tgt) return;
  s.a = Math.atan2(tgt.y - s.y, tgt.x - s.x);
  if (s.cd > 0) return;
  const op = room.players[s.own];
  const tm = op && op.perks.turretmaster;
  const rate = (1 + 0.15 * (lv - 1)) * (eng ? 1.3 : 1) * (room.oc > 0 ? 2 : 1) * (tm ? 1.15 : 1);
  s.cd = T.delay / rate; s.flT = 0.12;
  const dmg = ttDmg(s.t, lv) * (tm ? 1.25 : 1);
  const sx = s.x + Math.cos(s.a) * 14, sy = s.y + Math.sin(s.a) * 14;
  const owner = s.own;
  switch (s.t) {
    case 'gun': addBullet(room, sx, sy, s.a, { speed: 950, life: (range + 30) / 950, pierce: 0, col: 4, kb: 1.5 }, dmg, owner); break;
    case 'flame': {
      for (let k = 0; k < 2; k++) {
        const a = s.a + (Math.random() - 0.5) * 0.5;
        addBullet(room, sx, sy, a, { speed: 430, life: (range + 10) / 430, pierce: 99, col: 5, burn: true, hr: 15, kb: 0 }, dmg, owner);
      }
      break;
    }
    case 'tesla': zapFrom(room, owner, sx, sy, s.a, dmg, { range: range + 20, jumps: 1 + lv, hop: 150 }, 0); break;
    case 'poison': {
      if (room.clouds.length < 24) room.clouds.push({ x: tgt.x, y: tgt.y, r: cloudR(lv), t: 5.5, max: 5.5, dps: dmg * 1.6, own: owner });
      fx(room, 'cloud', Math.round(tgt.x), Math.round(tgt.y), cloudR(lv)); break;
    }
    case 'freeze': {
      for (const z of room.zombies) {
        if (z.dead || Math.hypot(z.x - s.x, z.y - s.y) > range) continue;
        applySlow(z, 2.5, 0.4);
        if (lv >= 2) applyRoot(z, lv >= 3 ? 1 : 0.5);
        z.hp -= dmg; if (z.hp <= 0) killZombie(room, z, owner);
      }
      fx(room, 'frost', Math.round(s.x), Math.round(s.y), Math.round(range)); break;
    }
    case 'pin': {
      const c = [];
      for (const z of room.zombies) { if (z.dead) continue; const d = Math.hypot(z.x - s.x, z.y - s.y); if (d < range) c.push([d, z]); }
      c.sort((a, b) => a[0] - b[0]);
      for (const [, z] of c.slice(0, lv)) {
        applyRoot(z, 2.8 + 0.4 * (lv - 1)); z.hp -= dmg; if (z.hp <= 0) killZombie(room, z, owner);
        fx(room, 'pin', Math.round(sx), Math.round(sy), Math.round(z.x), Math.round(z.y));
      }
      break;
    }
    case 'rocket': addBullet(room, sx, sy, s.a, { speed: 520, life: (range + 20) / 520, pierce: 0, col: 6, boom: { r: 85 + 10 * lv }, kb: 0 }, dmg, owner); break;
  }
  if (s.t !== 'flame' || (room.tickN % 3) === 0) fx(room, 'tshoot', i, TT_KEYS.indexOf(s.t));
}

function tick(room) {
  const now = Date.now();
  const ents = Object.entries(room.players);
  const D = DIFFS[room.diff];
  room.tickN++;
  room.baseFxT -= DT;
  room.oc = Math.max(0, room.oc - DT);

  for (const [id, p] of ents) {
    p.hurtT -= DT;
    p.rage = Math.max(0, p.rage - DT);
    p.haste = Math.max(0, p.haste - DT);
    p.dashCd = Math.max(0, p.dashCd - DT);
    p.god = Math.max(0, p.god - DT);
    p.placeCd -= DT;
    p.abCd = Math.max(0, p.abCd - DT);
    p.focus = Math.max(0, p.focus - DT);
    p.spdBoost = Math.max(0, p.spdBoost - DT);
    p.slowT = Math.max(0, p.slowT - DT);
    p.bloom -= p.bloom * Math.min(1, 4 * DT);
    if (!p.alive) continue;
    const i = p.input;
    const dx = (i.right ? 1 : 0) - (i.left ? 1 : 0), dy = (i.down ? 1 : 0) - (i.up ? 1 : 0);
    const len = Math.hypot(dx, dy);
    p.ms = PLAYER_SPEED * (1 + 0.06 * p.up.speed) * p.spdMul * (p.perks.sprinter ? 1.12 : 1) * (p.spdBoost > 0 ? 1.25 : 1) * (p.slowT > 0 ? p.slowF : 1);
    const sp = p.ms * zoneMul(room, p.x, p.y);
    p.angle = i.angle;
    if (i.dash && p.dashCd <= 0) {
      p.dashCd = DASH_CD * (p.perks.sprinter ? 0.7 : 1); p.dashT = 0.15;
      if (len > 0) { p.dvx = dx / len; p.dvy = dy / len; }
      else { p.dvx = Math.cos(p.angle); p.dvy = Math.sin(p.angle); }
      fx(room, 'dash', Math.round(p.x), Math.round(p.y), +Math.atan2(p.dvy, p.dvx).toFixed(2));
    }
    if (p.dashT > 0) {
      p.dashT -= DT;
      p.x += p.dvx * DASH_SPEED * DT; p.y += p.dvy * DASH_SPEED * DT;
      p.mvx = p.dvx * sp * 0.6; p.mvy = p.dvy * sp * 0.6;
    } else {
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
    if (p.wantAb) { p.wantAb = false; useAbility(room, id, p); }

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

    const wp = WEAPONS[p.weapon];
    if (wp.spinup) p.spin = i.shoot && p.rl <= 0 ? Math.min(1, p.spin + DT * 1.1) : Math.max(0, p.spin - DT * 2);
    const delay = wp.delay * (wp.spinup ? 2.4 - 1.4 * p.spin : 1) / (1 + 0.1 * p.up.rate) / (p.haste > 0 ? 1.6 : 1);
    if (i.shoot) {
      if (p.ammo[p.weapon] <= 0) startReload(room, id, p);
      else if (p.rl <= 0 && now - p.lastShot > delay) fire(room, id, p, wp, now);
    }
  }

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
  const builtSlots = room.slots.filter(s => s.t);

  if (room.phase === 'wave' && room.toSpawn > 0) {
    room.spawnTimer -= DT;
    if (room.spawnTimer <= 0 && room.zombies.length < MAX_ZOMBIES) {
      if (room.bossPending) { spawnZombie(room, 'boss'); room.bossPending = false; room.toSpawn--; }
      else if (!room.bursted && room.toSpawn <= room.burstAt) {
        room.bursted = true;
        const n = Math.min(room.toSpawn, 6 + Math.floor(room.wave / 2));
        const side = Math.floor(Math.random() * 4), t0 = 0.2 + Math.random() * 0.6;
        for (let k = 0; k < n; k++) {
          const j = (Math.random() - 0.5) * 120;
          const x = side === 0 ? t0 * W + j : side === 2 ? t0 * W + j : side === 1 ? W + 20 : -20;
          const y = side === 1 ? t0 * H + j : side === 3 ? t0 * H + j : side === 0 ? -20 : H + 20;
          spawnZombie(room, pickType(room.wave, room.theme, builtSlots.length > 0), x, y);
        }
        room.toSpawn -= n;
        fx(room, 'horde', side);
      } else { spawnZombie(room, pickType(room.wave, room.theme, builtSlots.length > 0)); room.toSpawn--; }
      room.spawnTimer = Math.max(0.12, 0.65 - room.wave * 0.03);
    }
  }

  for (const r of room.revives) {
    r.t -= DT;
    if (r.t <= 0) {
      const z = spawnZombie(room, 'revenant', r.x, r.y, true);
      z.rev = true; z.hp = z.maxHp * 0.5;
      fx(room, 'ghoul', Math.round(r.x), Math.round(r.y), 1);
    }
  }
  room.revives = room.revives.filter(r => r.t > 0);
  for (const c of room.corpses) c.t -= DT;
  room.corpses = room.corpses.filter(c => c.t > 0);

  const zs = room.zombies;
  const wires = room.structs.filter(s => s.k === 1);
  for (const z of zs) {
    if (z.dead) continue;
    z.fxT -= DT; z.stun -= DT; z.buff = Math.max(0, z.buff - DT);
    if (z.burn > 0) {
      z.burn -= DT; z.hp -= 7 * DT;
      if (z.hp <= 0) { killZombie(room, z, z.burnBy); continue; }
    }
    if (z.pois > 0) {
      z.pois -= DT; z.hp -= 6 * DT;
      if (z.hp <= 0) { killZombie(room, z, z.poisBy); continue; }
    }
    let tx = BASE.x, ty = BASE.y, best = 240, tp = null, tslot = null;
    if (z.type === 'gnawer' || z.type === 'sapper') {
      let bd = 700;
      for (const s of builtSlots) { const d = Math.hypot(s.x - z.x, s.y - z.y); if (d < bd) { bd = d; tslot = s; } }
      if (tslot) { tx = tslot.x; ty = tslot.y; }
    }
    if (!tslot) {
      for (const p of living) {
        const d = Math.hypot(p.x - z.x, p.y - z.y);
        if (d < best) { best = d; tx = p.x; ty = p.y; tp = p; }
      }
      for (const s of builtSlots) {
        const d = Math.hypot(s.x - z.x, s.y - z.y);
        if (d < 110 && d < best) { best = d; tx = s.x; ty = s.y; tp = null; }
      }
    }
    let dx = tx - z.x, dy = ty - z.y, d = Math.hypot(dx, dy) || 1;
    z.ang = Math.atan2(dy, dx);
    let sp = z.speed * (z.stun > 0 && z.type !== 'boss' ? 0.35 : 1) * (z.buff > 0 ? 1.4 : 1) * zoneMul(room, z.x, z.y);
    let mx = dx / d, my = dy / d, move = true;
    if (z.slowT > 0) { z.slowT -= DT; sp *= z.slowF; }
    if (z.root > 0) { z.root -= DT; move = false; }

    for (const s of wires) {
      if (s.hp > 0 && Math.hypot(s.x - z.x, s.y - z.y) < 34) {
        sp *= 0.45; s.hp -= 10 * DT; z.hp -= 8 * DT;
        if (z.hp <= 0) { killZombie(room, z, s.own); break; }
      }
    }
    if (z.dead) continue;
    if (room.fence > 0) {
      const bd = Math.hypot(z.x - BASE.x, z.y - BASE.y);
      if (Math.abs(bd - ZONE_R) < 14) {
        sp *= 0.7; z.hp -= 7 * room.fence * DT;
        if (z.hp <= 0) { killZombie(room, z, null); continue; }
      }
    }

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
    } else if (z.type === 'screamer') {
      z.st -= DT;
      if (z.st <= 0 && tp && d < 280) { z.st = 6; scream(room, z); }
    } else if (z.type === 'necro') {
      if (tp && d < 180) { mx = -mx; my = -my; sp *= 0.7; } else if (tp && d < 230) move = false;
      z.st -= DT;
      if (z.st <= 0) {
        z.st = 7; let n = 0;
        for (const c of room.corpses) {
          if (n >= 3) break;
          if (c.t > 0 && Math.hypot(c.x - z.x, c.y - z.y) < 260) { spawnZombie(room, 'walker', c.x, c.y, true); fx(room, 'raise', Math.round(c.x), Math.round(c.y)); c.t = 0; n++; }
        }
        if (n === 0) summon(room, z, 2, ['mini']);
        else fx(room, 'roar', Math.round(z.x), Math.round(z.y));
      }
    } else if (z.type === 'leaper') {
      z.bt -= DT;
      if (z.bs === 0 && z.bt <= 0 && tp && d > 110 && d < 320) { z.bs = 1; z.bt = 0.35; z.dir = z.ang; }
      else if (z.bs === 1) { move = false; if (z.bt <= 0) { z.bs = 2; z.bt = 0.4; } }
      else if (z.bs === 2) { mx = Math.cos(z.dir); my = Math.sin(z.dir); sp = 560; move = true; if (z.bt <= 0) { z.bs = 0; z.bt = 3.5; } }
    } else if (z.type === 'boss') {
      z.bt -= DT;
      if (z.bk === 0) {
        if (z.bs === 0 && z.bt <= 0) { z.bs = 1; z.bt = 0.7; }
        else if (z.bs === 1) { move = false; if (z.bt <= 0) { stomp(room, z); z.bs = 0; z.bt = 6; } }
        z.sumT -= DT; if (z.sumT <= 0) { z.sumT = 8; summon(room, z, 3); }
      } else if (z.bk === 1) {
        sp *= 0.85;
        z.sumT -= DT; if (z.sumT <= 0) { z.sumT = 4; summon(room, z, 4); }
      } else if (z.bk === 2) {
        if (z.bs === 0 && z.bt <= 0) { z.bs = 1; z.bt = 0.9; }
        else if (z.bs === 1) { move = false; z.dir = z.ang; if (z.bt <= 0) { z.bs = 2; z.bt = 0.8; fx(room, 'roar', Math.round(z.x), Math.round(z.y)); } }
        else if (z.bs === 2) { mx = Math.cos(z.dir); my = Math.sin(z.dir); sp = 460; move = true; if (z.bt <= 0) { z.bs = 0; z.bt = 6; } }
        z.sumT -= DT; if (z.sumT <= 0) { z.sumT = 9; summon(room, z, 2); }
      } else {
        sp *= 0.8;
        z.sumT -= DT; if (z.sumT <= 0) { z.sumT = 6; summon(room, z, 4, ['spitter', 'gnawer', 'walker', 'walker']); }
        if (z.bt <= 0 && tp) {
          z.bt = 5;
          for (let k = -2; k <= 2; k++) {
            const a = Math.atan2(tp.y - z.y, tp.x - z.x) + k * 0.28, dd = Math.min(320, Math.hypot(tp.x - z.x, tp.y - z.y));
            spitAt(room, z, z.x + Math.cos(a) * dd, z.y + Math.sin(a) * dd);
          }
          fx(room, 'spit', Math.round(z.x), Math.round(z.y)); fx(room, 'roar', Math.round(z.x), Math.round(z.y));
        }
      }
    }
    if (move) { z.x += mx * sp * DT; z.y += my * sp * DT; }
  }

  const grid = buildGrid(zs);
  const bars = room.structs.filter(s => s.k === 0 && s.hp > 0).map(s => ({ x: s.x, y: s.y, r: 15 }));
  for (const A of zs) {
    if (A.dead) continue;
    gridQuery(grid, A.x, A.y, A.r + 34, _q);
    for (let b = 0; b < _q.length; b++) {
      const B = _q[b];
      if (B.id <= A.id || B.dead) continue;
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

  for (const z of zs) {
    if (z.dead) continue;
    const mult = (z.type === 'boss' && z.bs === 2 && z.bk === 2) ? 2 : (z.type === 'leaper' && z.bs === 2) ? 1.5 : 1;
    const boom = z.type === 'bomber' || z.type === 'sapper';
    for (const p of living) {
      if (!p.alive || Math.hypot(p.x - z.x, p.y - z.y) > z.r + 11) continue;
      if (boom) { killZombie(room, z, null); break; }
      hurtPlayer(room, p, z.dmg * mult * DT);
    }
    if (z.dead) continue;
    for (const s of room.structs) {
      if (s.k !== 0 || s.hp <= 0 || Math.hypot(s.x - z.x, s.y - z.y) > 15 + z.r + 3) continue;
      if (boom) { killZombie(room, z, null); break; }
      s.hp -= z.dmg * 0.6 * DT;
    }
    if (z.dead) continue;
    for (const s of builtSlots) {
      if (!s.t || Math.hypot(s.x - z.x, s.y - z.y) > z.r + 16) continue;
      if (boom) { killZombie(room, z, null); break; }
      s.hp -= z.dmg * (z.type === 'gnawer' ? 1.2 : 0.35) * DT;
    }
    if (z.dead) continue;
    if (Math.hypot(BASE.x - z.x, BASE.y - z.y) < 30 + z.r) {
      if (boom) killZombie(room, z, null);
      else damageBase(room, z.dmg * 0.55 * DT);
    }
  }

  for (let i = 0; i < room.slots.length; i++) {
    const s = room.slots[i];
    if (s.t && s.hp <= 0) { clearSlot(s); fx(room, 'tbreak', i); say(room, 'Taret yıkıldı! (yer ' + (i + 1) + ')'); }
  }

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

  for (const s of room.spits) {
    s.x += s.vx * DT; s.y += s.vy * DT; s.left -= 260 * DT;
    if (s.left <= 0) {
      s.done = true;
      room.puddles.push({ x: s.tx, y: s.ty, r: 34, t: 4, max: 4 });
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
  for (const c of room.clouds) {
    c.t -= DT;
    for (const z of zs) {
      if (z.dead || Math.hypot(z.x - c.x, z.y - c.y) > c.r + z.r) continue;
      z.hp -= c.dps * DT; z.pois = Math.max(z.pois, 0.3); z.poisBy = c.own; applySlow(z, 0.3, 0.7);
      if (z.hp <= 0) killZombie(room, z, c.own);
    }
  }
  room.clouds = room.clouds.filter(c => c.t > 0);
  for (const g of room.nades) {
    g.t += DT;
    const dx = g.tx - g.x, dy = g.ty - g.y, d = Math.hypot(dx, dy);
    if (d > 6) { const st = Math.min(d, 420 * DT); g.x += dx / d * st; g.y += dy / d * st; }
    if (g.t >= 1.2) { g.done = true; blast(room, g.x, g.y, 95, 80, g.own); }
  }
  room.nades = room.nades.filter(g => !g.done);

  const eng = living.some(p => p.cls === 'engineer');
  for (let i = 0; i < room.slots.length; i++) turretTick(room, room.slots[i], i, eng);

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
      gridQuery(grid, b.x, b.y, 32 + b.hr, _q);
      for (let qi = 0; qi < _q.length; qi++) {
        const z = _q[qi];
        if (z.dead || b.hit.has(z.id) || Math.hypot(z.x - b.x, z.y - b.y) > z.r + b.hr) continue;
        if (b.boom) { b.life = 0; break; }
        b.hit.add(z.id);
        if (b.burn) { z.burn = 2.5; z.burnBy = b.owner; }
        if (b.pois) { z.pois = Math.max(z.pois, b.pois); z.poisBy = b.owner; }
        if (b.frost) applySlow(z, 1.5, 0.75);
        if (b.chill) { applySlow(z, 2, 0.5); z.chill++; if (z.chill >= 6) { z.chill = 0; applyRoot(z, 1.8); fx(room, 'frost', Math.round(z.x), Math.round(z.y), 40); } }
        if (b.net) {
          fx(room, 'net', Math.round(z.x), Math.round(z.y), b.net.r);
          for (const o of room.zombies) if (!o.dead && Math.hypot(o.x - z.x, o.y - z.y) < b.net.r) applyRoot(o, b.net.t);
        }
        if (b.leech) { const op = room.players[b.owner]; if (op && op.alive) op.hp = Math.min(op.maxHp, op.hp + b.leech); }
        hitZombie(room, z, b.dmg, b.owner, b.ang, { kb: b.kb, throttle: b.burn });
        if (b.exp && !b.burn && Math.random() < 0.3) blast(room, z.x, z.y, 48, b.dmg * 0.5, b.owner, { small: true });
        if (b.pierce > 0) b.pierce--; else { b.life = 0; break; }
      }
    }
    if (b.life <= 0 && b.boom && !b.boomed) { b.boomed = true; blast(room, b.x, b.y, b.boom.r, b.dmg, b.owner); }
  }
  room.bullets = room.bullets.filter(b => b.life > 0 && b.x > -50 && b.x < W + 50 && b.y > -50 && b.y < H + 50);
  room.zombies = room.zombies.filter(z => !z.dead);

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

  if (room.phase === 'wave') {
    if (room.toSpawn <= 0 && room.zombies.length === 0 && room.revives.length === 0) startShop(room);
  } else if (room.phase === 'shop') {
    const all = Object.values(room.players);
    if (all.length > 0 && all.every(p => p.skip)) startPrep(room);
  } else {
    room.prepT -= DT;
    if (room.prepT <= 0) startNextWave(room);
  }

  if (room.baseHp <= 0 || !ents.some(([, p]) => p.alive)) {
    endGame(room, room.baseHp <= 0 ? 'Bölge düştü!' : 'Tüm oyuncular öldü!');
    return;
  }

  if (room.tickN % NET_EVERY !== 0) return;
  const idxOf = {};
  ents.forEach(([id], i) => { idxOf[id] = i; });
  const payload = {
    ph: room.phase, prepT: Math.max(0, Math.ceil(room.prepT)), ev: room.evt,
    skips: ents.filter(([, p]) => p.skip).length, np: ents.length,
    players: ents.map(([id, p]) => ({
      id, name: p.name, x: Math.round(p.x), y: Math.round(p.y), hp: Math.round(p.hp), mhp: p.maxHp,
      alive: p.alive, a: +p.angle.toFixed(2), score: p.score, gold: p.gold, kills: p.kills,
      w: p.weapon, ws: Object.keys(p.weapons), rage: +p.rage.toFixed(1), haste: +p.haste.toFixed(1),
      dcd: +p.dashCd.toFixed(1), cls: p.cls, sk: p.sk, pk: Object.keys(p.perks),
      am: p.ammo[p.weapon], mg: WEAPONS[p.weapon].mag, rl: p.rl > 0 ? +(1 - p.rl / p.rlMax).toFixed(2) : -1,
      fr: +((1 + 0.1 * p.up.rate) * (p.haste > 0 ? 1.6 : 1)).toFixed(2), bl: +p.bloom.toFixed(3), sp: +p.spin.toFixed(2),
      rv: +p.reviveP.toFixed(2), god: +p.god.toFixed(1), ab: +p.abCd.toFixed(1), abm: AB[p.cls].cd, fo: p.focus > 0 ? 1 : 0,
      sl: p.slowT > 0 ? 1 : 0, ms: Math.round(p.ms || PLAYER_SPEED),
      inv: [p.inv.barricade, p.inv.wire, p.inv.mine, p.inv.crate, p.inv.nade]
    })),
    zombies: room.zombies.map(z => [
      z.id, Math.round(z.x), Math.round(z.y), +(z.hp / z.maxHp).toFixed(2), ZT_LIST.indexOf(z.type), z.bk,
      (z.burn > 0 ? 1 : 0) | (z.bs === 1 && (z.type === 'boss' || z.type === 'leaper') ? 2 : 0) | (z.bs === 2 && (z.type === 'boss' || z.type === 'leaper') ? 4 : 0) |
      (z.type === 'shadow' ? 8 : 0) | (z.pois > 0 ? 16 : 0) | (z.elite ? 32 : 0) | (z.slowT > 0 ? 64 : 0) | (z.root > 0 ? 128 : 0) | (z.buff > 0 ? 256 : 0)
    ]),
    bullets: room.bullets.map(b => [Math.round(b.x), Math.round(b.y), +b.ang.toFixed(2), b.col, Math.round(b.spd / 10), idxOf[b.owner] === undefined ? -1 : idxOf[b.owner]]),
    pickups: room.pickups.map(p => [p.id, Math.round(p.x), Math.round(p.y), p.t]),
    structs: room.structs.map(s => [s.id, s.k, Math.round(s.x), Math.round(s.y), +(s.hp / s.max).toFixed(2), s.k === 2 ? (s.arm > 0 ? 1 : 0) : s.ch]),
    spits: room.spits.map(s => [Math.round(s.x), Math.round(s.y)]),
    puds: room.puddles.map(g => [Math.round(g.x), Math.round(g.y), g.r, +(g.t / g.max).toFixed(2)]),
    clouds: room.clouds.map(c => [Math.round(c.x), Math.round(c.y), c.r, +(c.t / c.max).toFixed(2)]),
    nades: room.nades.map(g => [Math.round(g.x), Math.round(g.y), +g.t.toFixed(2)]),
    slots: room.slots.map(s => [s.t ? TT_KEYS.indexOf(s.t) : -1, s.lv, s.t ? +(s.hp / s.max).toFixed(2) : 0, +s.a.toFixed(2), (s.emp > 0 ? 1 : 0) | (s.flT > 0 ? 2 : 0)]),
    baseHp: Math.max(0, Math.round(room.baseHp)), baseMax: room.baseMax, armor: room.armor, bu: room.baseUp, fence: room.fence, oc: room.oc > 0 ? 1 : 0,
    wave: room.wave, left: room.toSpawn + room.zombies.length + room.revives.length, th: room.theme,
    tm: +room.tickMs.toFixed(2), sz: room.pkt, nz: room.zombies.length,
    fx: room.fx
  };
  if (room.tickN % TICK === 0) { try { room.pkt = Math.round(JSON.stringify(payload).length / 100) / 10; } catch (e) {} }
  io.to(roomName(room)).emit('state', payload);
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
