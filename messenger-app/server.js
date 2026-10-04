/* ============ server.js — Teleport PRO: статика + аккаунты + WebSocket-чат ============
   Использование:  node server.js            (http://localhost:8080)
   Возможности:
     • регистрация/вход: телефон+код, e-mail+пароль, VK, Яндекс (OAuth или демо-режим)
     • база данных: SQLite (node:sqlite / better-sqlite3) или JSON-файл — см. db.js
     • история сообщений на сервере (пересылается при входе — чаты на любом устройстве)
     • личные чаты с людьми по @username, контакты, поиск пользователей
     • доставка / прочтение / «печатает…» / presence / сигнализация звонков (WebRTC)
     • загрузка фото и голосовых сообщений на сервер */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { db } = require('./db.js');

const ROOT = __dirname;
const PORT = process.env.PORT || 8080;
const MEDIA_DIR = path.join(ROOT, 'uploads');
try { fs.mkdirSync(MEDIA_DIR, { recursive: true }); } catch (e) {}

/* ---- конфигурация OAuth (необязательная). Без ключей вход работает в демо-режиме ---- */
const OAUTH = {
  vk:     { client_id: process.env.VK_CLIENT_ID || '',     redirect: '/auth/vk/callback' },
  yandex: { client_id: process.env.YANDEX_CLIENT_ID || '', redirect: '/auth/yandex/callback' },
};
const PUBLIC_URL = process.env.PUBLIC_URL || ''; // напр. https://t.example.ru — для редиректов OAuth

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.webm': 'audio/webm',
};

/* ==================== helpers ==================== */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (d) => { size += d.length; if (size > limit) { reject(new Error('too big')); req.destroy(); return; } chunks.push(d); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJSON(req) {
  try { return JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}'); } catch (e) { return null; }
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
function hashPass(pass, salt) { return crypto.scryptSync(String(pass), salt, 32).toString('hex'); }
function sanitize(s, max = 64) { return String(s == null ? '' : s).replace(/[<>]/g, '').slice(0, max).trim(); }
function normPhone(p) { const d = String(p || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; }
function normUsername(u) { return '@' + String(u || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24); }

/* ---- токены сессий (память + файл, переживают перезапуск) ---- */
const TOKENS_FILE = path.join(ROOT, 'data', 'tokens.json');
let tokens = {};
try { fs.mkdirSync(path.dirname(TOKENS_FILE), { recursive: true }); tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8')); } catch (e) {}
function saveTokens() { try { fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens)); } catch (e) {} }
setInterval(() => {
  const now = Date.now(); let ch = false;
  for (const t in tokens) if (tokens[t].exp < now) { delete tokens[t]; ch = true; }
  if (ch) saveTokens();
}, 3600000).unref?.();
function makeToken(userId) {
  const t = crypto.randomBytes(24).toString('hex');
  tokens[t] = { userId, exp: Date.now() + 90 * 86400000 }; // 90 дней
  saveTokens(); return t;
}
function userByToken(t) {
  const rec = tokens[t];
  if (!rec || rec.exp < Date.now()) return null;
  return db.get('users', rec.userId);
}
function userByReq(req) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : (req.url.split('token=')[1] || '').split('&')[0];
  return userByToken(t);
}
function publicUser(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, username: u.username, avatar: u.avatar || null, bio: u.bio || '', provider: u.provider };
}

/* ---- коды подтверждения (демо: возвращаем в ответе; боевой режим — SMS-шлюз) ---- */
const codes = new Map();
function issueCode(key) {
  const code = String(crypto.randomInt(100000, 999999));
  codes.set(key, { code, exp: Date.now() + 5 * 60000 });
  return code;
}
function checkCode(key, code) {
  const r = codes.get(key);
  if (!r || r.exp < Date.now()) return false;
  if (r.code !== String(code).trim()) return false;
  codes.delete(key); return true;
}

/* ---- создание аккаунта ---- */
function createUser({ name, username, provider, email, phone, pass, avatar }) {
  const u = {
    id: 'u_' + uid(), name: sanitize(name, 32) || 'Пользователь',
    username: username || ('@user' + uid().slice(0, 6)),
    provider: provider || 'phone', email: email || null, phone: phone || null,
    avatar: avatar || null, bio: '', created_at: Date.now(),
  };
  if (pass) { u.salt = crypto.randomBytes(8).toString('hex'); u.pass_hash = hashPass(pass, u.salt); }
  db.insert('users', u);
  return u;
}

/* ==================== HTTP ==================== */
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
  const url = decodeURIComponent(req.url.split('?')[0]);
  const q = new URLSearchParams(req.url.split('?')[1] || '');

  /* ---------- API ---------- */
  if (url.startsWith('/api/') || url.startsWith('/auth/')) {

    if (req.method === 'GET' && url === '/api/check') {
      const v = (q.get('v') || '').trim();
      const taken = !!db.one('users', 'username', normUsername(v.replace(/^@/, '')));
      return json(res, 200, { ok: true, taken });
    }

    /* телефон: запрос кода */
    if (req.method === 'POST' && url === '/api/code_phone') {
      const b = await readJSON(req); if (!b) return json(res, 400, { ok: false, error: 'bad json' });
      const phone = normPhone(b.phone);
      if (phone.length !== 10) return json(res, 200, { ok: false, error: 'Введите номер из 10 цифр' });
      const code = issueCode('ph:' + phone);
      // ⚠️ демо: SMS-шлюза нет — код возвращается в ответе и пишется в лог сервера.
      console.log(`[Teleport] Код для +7${phone}: ${code}`);
      return json(res, 200, { ok: true, demo_code: code, hint: 'SMS-шлюз не подключён — код показан сразу (демо).' });
    }
    /* телефон: подтверждение → вход/регистрация */
    if (req.method === 'POST' && url === '/api/login_phone') {
      const b = await readJSON(req); if (!b) return json(res, 400, { ok: false, error: 'bad json' });
      const phone = normPhone(b.phone);
      if (!checkCode('ph:' + phone, b.code)) return json(res, 200, { ok: false, error: 'Неверный или истёкший код' });
      let u = db.by('users', 'phone', phone)[0];
      if (!u) u = createUser({ name: sanitize(b.name, 32) || 'Телефон-' + phone.slice(-4), provider: 'phone', phone });
      return json(res, 200, { ok: true, token: makeToken(u.id), user: publicUser(u) });
    }

    /* e-mail: регистрация */
    if (req.method === 'POST' && url === '/api/signup_email') {
      const b = await readJSON(req); if (!b) return json(res, 400, { ok: false, error: 'bad json' });
      const email = sanitize(b.email, 64).toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, 200, { ok: false, error: 'Некорректная почта' });
      if (db.where('users', 'email=?', [email]).length) return json(res, 200, { ok: false, error: 'Эта почта уже зарегистрирована' });
      if (String(b.password || '').length < 6) return json(res, 200, { ok: false, error: 'Пароль минимум 6 символов' });
      const uname = normUsername(b.username || email.split('@')[0]);
      if (!uname || uname === '@') return json(res, 200, { ok: false, error: 'Придумайте @имя' });
      if (db.one('users', 'username', uname)) return json(res, 200, { ok: false, error: '@имя занято' });
      const u = createUser({ name: sanitize(b.name, 32) || email.split('@')[0], username: uname, provider: 'email', email, pass: b.password });
      return json(res, 200, { ok: true, token: makeToken(u.id), user: publicUser(u) });
    }
    /* e-mail: вход */
    if (req.method === 'POST' && url === '/api/login_email') {
      const b = await readJSON(req); if (!b) return json(res, 400, { ok: false, error: 'bad json' });
      const email = sanitize(b.email, 64).toLowerCase();
      const u = db.where('users', 'email=?', [email])[0];
      if (!u || !u.pass_hash) return json(res, 200, { ok: false, error: 'Аккаунт не найден' });
      if (hashPass(b.password || '', u.salt) !== u.pass_hash) return json(res, 200, { ok: false, error: 'Неверный пароль' });
      return json(res, 200, { ok: true, token: makeToken(u.id), user: publicUser(u) });
    }

    /* VK / Яндекс: ссылка авторизации */
    if (req.method === 'GET' && (url === '/api/oauth/vk' || url === '/api/oauth/yandex')) {
      const prov = url.endsWith('vk') ? 'vk' : 'yandex';
      const base = PUBLIC_URL || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
      const redir = base + OAUTH[prov].redirect;
      if (OAUTH[prov].client_id) {
        const loc = prov === 'vk'
          ? `https://oauth.vk.com/authorize?client_id=${OAUTH[prov].client_id}&display=page&redirect_uri=${encodeURIComponent(redir)}&scope=email&response_type=code&v=5.199`
          : `https://oauth.yandex.ru/authorize?response_type=code&client_id=${OAUTH[prov].client_id}&redirect_uri=${encodeURIComponent(redir)}`;
        return json(res, 200, { ok: true, url: loc, demo: false });
      }
      // демо-режим без ключей: мгновенный аккаунт провайдера
      const u = createUser({ name: (prov === 'vk' ? 'VK' : 'Яндекс') + '-пользователь', provider: prov + '-demo' });
      return json(res, 200, { ok: true, demo: true, token: makeToken(u.id), user: publicUser(u) });
    }
    /* колбэки OAuth (если ключи заданы) */
    if (req.method === 'GET' && (url === '/auth/vk/callback' || url === '/auth/yandex/callback')) {
      const prov = url.includes('/vk/') ? 'vk' : 'yandex';
      const code = q.get('code');
      if (!code || !OAUTH[prov].client_id) { res.writeHead(302, { Location: '/' }); return res.end(); }
      try {
        const base = PUBLIC_URL || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
        let tokResp;
        if (prov === 'vk') {
          tokResp = await fetch(`https://oauth.vk.com/access_token?client_id=${OAUTH[prov].client_id}&client_secret=${process.env.VK_CLIENT_SECRET || ''}&redirect_uri=${encodeURIComponent(base + OAUTH[prov].redirect)}&code=${code}`).then(r => r.json());
        } else {
          tokResp = await fetch('https://oauth.yandex.ru/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: OAUTH[prov].client_id, client_secret: process.env.YANDEX_CLIENT_SECRET || '' }) }).then(r => r.json());
        }
        const at = tokResp.access_token;
        if (!at) throw new Error('нет access_token');
        let prof, name, email = null, avatar = null;
        if (prov === 'vk') {
          const j = await fetch(`https://api.vk.com/method/users.get?user_ids=${tokResp.user_id}&fields=photo_200&v=5.199&access_token=${at}`).then(r => r.json());
          prof = j.response && j.response[0];
          name = prof ? prof.first_name + ' ' + (prof.last_name || '') : 'VK-пользователь';
          email = tokResp.email || null; avatar = prof && prof.photo_200 || null;
        } else {
          prof = await fetch('https://login.yandex.ru/info?format=json', { headers: { Authorization: 'OAuth ' + at } }).then(r => r.json());
          name = prof.display_name || prof.real_domain || 'Яндекс-пользователь';
          email = prof.default_email || null;
          avatar = prof.default_avatar ? `https://avatars.yandex.net/get-yapic/${prof.default_avatar}/islands-200` : null;
        }
        const exId = String(prof && (prof.id || prof.uid) || uid());
        let u = db.where('users', 'provider=?', [prov]).find(x => x.id === 'x_' + exId) ||
                (email && db.where('users', 'email=?', [email])[0]);
        if (!u) u = createUser({ name: String(name).trim(), username: normUsername(String(name).replace(/\s+/g, '_')), provider: prov, email, avatar });
        else db.update('users', u.id, { name: String(name).trim() || u.name, avatar: avatar || u.avatar });
        res.writeHead(302, { Location: '/#token=' + makeToken(u.id) });
        res.end();
      } catch (e) {
        res.writeHead(302, { Location: '/?auth_error=' + encodeURIComponent(e.message) }); res.end();
      }
      return;
    }

    /* текущий профиль */
    if (req.method === 'GET' && url === '/api/me') {
      const u = userByReq(req);
      return u ? json(res, 200, { ok: true, user: publicUser(u) }) : json(res, 401, { ok: false, error: 'no session' });
    }

    /* обновление профиля */
    if (req.method === 'POST' && url === '/api/profile') {
      const u = userByReq(req); if (!u) return json(res, 401, { ok: false });
      const b = await readJSON(req); if (!b) return json(res, 400, { ok: false });
      const patch = {};
      if (b.name) patch.name = sanitize(b.name, 32);
      if (typeof b.bio === 'string') patch.bio = sanitize(b.bio, 120);
      if (typeof b.avatar === 'string' && b.avatar.startsWith('data:image/')) patch.avatar = b.avatar.slice(0, 300 * 1024);
      if (b.username) {
        const uname = normUsername(b.username);
        const busy = db.one('users', 'username', uname);
        if (busy && busy.id !== u.id) return json(res, 200, { ok: false, error: '@имя занято' });
        patch.username = uname;
      }
      db.update('users', u.id, patch);
      return json(res, 200, { ok: true, user: publicUser(db.get('users', u.id)) });
    }

    /* поиск людей по @username / имени */
    if (req.method === 'GET' && url === '/api/search_users') {
      const me = userByReq(req); if (!me) return json(res, 401, { ok: false });
      const raw = (q.get('q') || '').trim().toLowerCase();
      if (raw.length < 2) return json(res, 200, { ok: true, users: [] });
      const wantUname = raw.startsWith('@') ? normUsername(raw.slice(1)) : null;
      const all = db.where('users', 'id IS NOT NULL').filter(u =>
        u.id !== me.id && (wantUname ? u.username === wantUname : (String(u.name).toLowerCase().includes(raw) || String(u.username).toLowerCase().includes(raw)))
      ).slice(0, 20).map(publicUser);
      return json(res, 200, { ok: true, users: all });
    }

    /* загрузка медиа (фото, файлы, голосовые) */
    if (req.method === 'POST' && url === '/upload') {
      const ct = (req.headers['content-type'] || '').split(';')[0];
      const IMG_EXT = ['.jpg', '.png', '.webp', '.gif'];
      const AUDIO_EXT = { 'audio/ogg': '.ogg', 'audio/webm': '.webm', 'audio/mp4': '.m4a', 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav' };
      try {
        let buf = await readBody(req, 8 * 1024 * 1024);
        let ext = IMG_EXT.includes(q.get('ext') || '') ? q.get('ext') : null; // явный hint от клиента
        if (!ext && ct === 'multipart/form-data') {
          const m = /filename="[^"]*\.(jpe?g|png|webp|gif|ogg|webm|m4a|mp3|wav)"/i.exec(buf.toString('latin1').slice(0, 2048));
          ext = m ? '.' + m[1].toLowerCase().replace('jpeg', 'jpg') : '.jpg';
          const idx = buf.indexOf('\r\n\r\n'); if (idx >= 0) buf = buf.slice(idx + 4);
          const tail = buf.lastIndexOf('\r\n--'); if (tail > 0) buf = buf.slice(0, tail);
        }
        if (!ext) ext = AUDIO_EXT[ct] || IMG_EXT.find(e => e === '.' + ((q.get('name') || '').match(/\.(\w+)$/) || [])[1]?.toLowerCase()) || '.bin';
        const name = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + ext;
        fs.writeFileSync(path.join(MEDIA_DIR, name), buf);
        return json(res, 200, { ok: true, url: '/uploads/' + name });
      } catch (e) {
        return json(res, e.message === 'too big' ? 413 : 500, { ok: false, error: e.message });
      }
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { ok: false });
    return json(res, 404, { ok: false, error: 'not found' });
  }

  /* ---------- раздача статики ---------- */
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  let fileUrl = url === '/' ? '/index.html' : url;
  const file = path.normalize(path.join(ROOT, fileUrl)).replace(/^(\.\.[\/\\])+/, '');
  fs.readFile(file, (err, data) => {
    if (err) {
      fs.readFile(path.join(ROOT, 'index.html'), (e2, html) => {
        if (e2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
        res.end(html);
      });
      return;
    }
    const isUploads = url.startsWith('/uploads/');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': isUploads ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(data);
  });
});

/* ==================== WebSocket ==================== */
const wss = new WebSocketServer({ server, path: '/ws' });

const byUser = new Map();       // userId -> Set<ws>
const rooms = new Map();        // chatId -> Set<ws>

function send(ws, obj) { try { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch (e) {} }
function toChat(chatId, obj, exceptWs) {
  const set = rooms.get(chatId); if (!set) return;
  for (const ws of set) if (ws !== exceptWs) send(ws, obj);
}
function toUser(userId, obj) {
  const set = byUser.get(userId); if (!set) return;
  for (const ws of set) send(ws, obj);
}
function chatsOf(ws) { return ws._chats || new Set(); }
function joinRoom(ws, chatId) {
  leaveAllRooms(ws);
  ws._chats = new Set([chatId]);
  if (!rooms.has(chatId)) rooms.set(chatId, new Set());
  rooms.get(chatId).add(ws);
}
function leaveAllRooms(ws) {
  for (const c of chatsOf(ws)) { const s = rooms.get(c); if (s) { s.delete(ws); if (!s.size) rooms.delete(c); } }
  ws._chats = new Set();
}
function ensureRoom(chatId) { if (!rooms.has(chatId)) rooms.set(chatId, new Set()); }

function saveMessage(m) {
  db.insert('messages', {
    id: m.mid, chat_id: m.chatId, sender: m.fromId || 'anon', text: m.text || '',
    media: JSON.stringify({
      mediaUrl: m.mediaUrl || null, fileUrl: m.fileUrl || null, fileName: m.fileName || null,
      audioUrl: m.audioUrl || null, audioDur: m.audioDur || null, geo: m.geo || null,
      circleUrl: m.circleUrl || null, poster: m.poster || null, dur: m.dur || null,
    }),
    ts: m.ts, reply_to: m.replyTo ? JSON.stringify(m.replyTo) : null,
    fwd_from: m.fwdFrom || null, edited: 0, deleted: 0,
  });
}
function parseMedia(row) {
  try { return Object.assign({ mediaUrl: null, fileUrl: null, fileName: null, audioUrl: null, audioDur: null, geo: null }, JSON.parse(row.media || '{}')); }
  catch (e) { return { mediaUrl: row.media || null }; } // старая схема: media = url картинки
}

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    const me = ws._user;

    switch (m.t) {
      case 'auth': { // { t:'auth', token }
        const u = userByToken(String(m.token || ''));
        if (!u) return send(ws, { t: 'auth_fail' });
        ws._user = u;
        if (!byUser.has(u.id)) byUser.set(u.id, new Set());
        byUser.get(u.id).add(ws);
        send(ws, { t: 'auth_ok', me: publicUser(u) });
        // подписка: общий чат + все личные комнаты пользователя
        const myRooms = new Set(['room_global']);
        for (const cid of db.contactsOf(u.id)) myRooms.add(cid);
        for (const c of myRooms) { ensureRoom(c); rooms.get(c).add(ws); (ws._chats = ws._chats || new Set()).add(c); }
        // история — чтобы чаты восстановились на любом устройстве
        const chatsOut = [];
        for (const c of myRooms) {
        const hist = db.history(c, 300).map(row => {
          const md = parseMedia(row);
          return Object.assign({
            mid: row.id, chatId: c, senderId: row.sender,
            text: row.text, ts: row.ts,
            replyTo: row.reply_to ? JSON.parse(row.reply_to) : null, fwdFrom: row.fwd_from,
            edited: !!row.edited, deleted: !!row.deleted,
          }, md);
        });
          chatsOut.push({ chatId: c, messages: hist });
        }
        send(ws, { t: 'sync', chats: chatsOut });
        break;
      }

      case 'join': { // { t:'join', chatId } — открыть конкретную комнату (доп. к авто-подписке)
        if (!me) return;
        const chatId = String(m.chatId || '').slice(0, 80);
        ensureRoom(chatId);
        if (!chatsOf(ws).has(chatId)) rooms.get(chatId).add(ws);
        send(ws, { t: 'peers', online: onlineNames(chatId, ws) });
        break;
      }

      case 'contacts:add': { // { t:'contacts:add', peerUserId, chatId }
        if (!me) return;
        const chatId = String(m.chatId || '').slice(0, 80);
        db.addContact(me.id, chatId);
        db.addContact(String(m.peerUserId), chatId); // взаимно — чат появится у собеседника
        ensureRoom(chatId);
        toUser(String(m.peerUserId), { t: 'contact_added', from: publicUser(me), chatId });
        send(ws, { t: 'ok', what: 'contacts:add' });
        break;
      }

      case 'msg': { // { t:'msg', chatId, mid, text, mediaUrl, ts, replyTo, fwdFrom }
        if (!me) return;
        const chatId = String(m.chatId || '').slice(0, 80);
        const clip = (v) => typeof v === 'string' ? v.slice(0, 200) : null;
        const payload = {
          t: 'msg', chatId,
          from: sanitize(me.name, 32), fromId: me.id,
          mid: String(m.mid || uid()).slice(0, 32),
          text: String(m.text || '').slice(0, 4000),
          mediaUrl: clip(m.mediaUrl), fileUrl: clip(m.fileUrl), fileName: clip(m.fileName),
          audioUrl: clip(m.audioUrl), audioDur: Number(m.audioDur) || null,
          geo: clip(m.geo),
          circleUrl: clip(m.circleUrl), poster: clip(m.poster), dur: Number(m.dur) || null,
          ts: Number(m.ts) || Date.now(),
          replyTo: m.replyTo && typeof m.replyTo === 'object'
            ? { id: String(m.replyTo.id || '').slice(0, 32), name: String(m.replyTo.name || '').slice(0, 32), text: String(m.replyTo.text || '').slice(0, 120) }
            : null,
          fwdFrom: m.fwdFrom ? String(m.fwdFrom).slice(0, 32) : null,
        };
        saveMessage(payload);
        toChat(chatId, payload, ws);
        break;
      }

      case 'edit': { // { t:'edit', chatId, mid, text }
        if (!me) return;
        const row = db.get('messages', String(m.mid || '').slice(0, 32));
        if (!row || row.sender !== me.id) return;
        db.update('messages', row.id, { text: String(m.text || '').slice(0, 4000), edited: 1 });
        toChat(String(m.chatId), { t: 'edit', chatId: row.chat_id, mid: row.id, text: String(m.text || '').slice(0, 4000) }, ws);
        break;
      }
      case 'del': { // { t:'del', chatId, mid }
        if (!me) return;
        const row = db.get('messages', String(m.mid || '').slice(0, 32));
        if (!row || row.sender !== me.id) return;
        db.update('messages', row.id, { deleted: 1, text: '', media: null });
        toChat(String(m.chatId), { t: 'del', chatId: row.chat_id, mid: row.id }, ws);
        break;
      }

      case 'read': { // { t:'read', chatId }
        if (!me) return;
        toChat(String(m.chatId), { t: 'read', by: me.id, byName: me.name }, ws);
        break;
      }
      case 'typing': { // { t:'typing', chatId, on }
        if (!me) return;
        toChat(String(m.chatId), { t: 'typing', on: !!m.on, who: me.name, whoId: me.id }, ws);
        break;
      }

      case 'call': case 'call-accept': case 'call-decline':
      case 'call-end': case 'signal': { // WebRTC-сигнализация для звонков
        if (!me) return;
        const target = String(m.to || '');
        if (!target) return;
        const map = { call: 'call-incoming', 'call-accept': 'call-accepted', 'call-decline': 'call-declined', 'call-end': 'call-ended', signal: 'signal' };
        toUser(target, { t: map[m.t], from: publicUser(me), chatId: m.chatId || null, kind: m.kind || null, data: m.data || null });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (ws._user) { const s = byUser.get(ws._user.id); if (s) { s.delete(ws); if (!s.size) byUser.delete(ws._user.id); } }
    const wasChats = [...chatsOf(ws)];
    leaveAllRooms(ws);
    for (const c of wasChats) toChat(c, { t: 'peers', online: onlineNames(c) });
  });
  ws.on('error', () => { try { ws.close(); } catch (e) {} });
});

function onlineNames(chatId, exceptWs) {
  const set = rooms.get(chatId); if (!set) return [];
  const out = [];
  for (const ws of set) if (ws !== exceptWs && ws._user) out.push({ name: ws._user.name, id: ws._user.id });
  return out;
}

/* ping для обрыва «мёртвых» соединений */
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 30000).unref?.();

/* чистка старой истории: держим последние 1000 сообщений на комнату */
setInterval(() => { try { db.prune(1000); } catch (e) {} }, 6 * 3600000).unref?.();

server.listen(PORT, () => {
  console.log(`✅ Teleport PRO запущен: http://localhost:${PORT}`);
  console.log(`   База данных: ${db.engine}`);
  console.log(`   WebSocket: ws://localhost:${PORT}/ws`);
  if (!OAUTH.vk.client_id) console.log('   VK OAuth: демо-режим (задайте VK_CLIENT_ID/VK_CLIENT_SECRET для боевого)');
  if (!OAUTH.yandex.client_id) console.log('   Яндекс OAuth: демо-режим (задайте YANDEX_CLIENT_ID/YANDEX_CLIENT_SECRET для боевого)');
});
