/* ============ server.js — Teleport PRO: боевой сервер (статика + аккаунты + WS-чат) ============
   Использование:  node server.js          (или: npm start)
   Возможности:
     • регистрация/вход: телефон+SMS-код, e-mail+пароль, VK ID, Яндекс ID (боевой OAuth 2.0)
     • база данных: SQLite (node:sqlite / better-sqlite3) или JSON-фолбэк — см. db.js
     • история сообщений на сервере (пересылается при входе — чаты на любом устройстве)
     • личные чаты с людьми по @username, контакты, поиск пользователей
     • доставка / прочтение / «печатает…» / presence / сигнализация звонков (WebRTC)
     • загрузка фото, файлов, голосовых и видеокружков на сервер

   ⚙️ ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ (создайте файл messenger-app/.env — сервер читает его сам):
     PUBLIC_URL=https://ваш-домен.ru       # обязателен для VK/Яндекс OAuth (https!)
     VK_CLIENT_ID=...        VK_CLIENT_SECRET=...         # id.mycloud.ru → приложения
     YANDEX_CLIENT_ID=...    YANDEX_CLIENT_SECRET=...     # oauth.yandex.ru → сервисы
     SMS_PROVIDER=smscru     SMSCRU_LOGIN=... SMSCRU_PASSWORD=...   # smsc.ru
     # либо: SMS_PROVIDER=cellhippus CELLHIPPUS_TOKEN=...           # cellhippus.ru
     # ЛИБО включите EMAIL_MODE=1 — код будет приходить на e-mail пользователя (SMTP_* ниже).
     Без SMS-шлюза и EMAIL_MODE вход по телефону заблокирован (приложение покажет подсказку). */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { db } = require('./db.js');

/* ---- .env: загружаем переменные из файла messenger-app/.env (без зависимостей) ---- */
(function loadEnv() {
  try {
    const txt = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    for (const line of txt.split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch (e) {}
})();

const ROOT = __dirname;
/* В облаке (Yandex Cloud Functions / Serverless Containers) порт приходит в переменной PORT. */
const PORT = process.env.PORT || 8080;
/* Каталог загрузок: локально ./uploads; в облаке с сетевым диском — TELEPORT_DATA_DIR/uploads */
const DATA_ROOT = process.env.TELEPORT_DATA_DIR || ROOT;
const MEDIA_DIR = process.env.TELEPORT_DATA_DIR ? path.join(process.env.TELEPORT_DATA_DIR, 'uploads') : path.join(ROOT, 'uploads');
try { fs.mkdirSync(MEDIA_DIR, { recursive: true }); } catch (e) {}

/* ---- конфигурация OAuth (боевая, из .env) ---- */
const OAUTH = {
  vk:     { client_id: process.env.VK_CLIENT_ID || '',     secret: process.env.VK_CLIENT_SECRET || '',     redirect: '/auth/vk/callback' },
  yandex: { client_id: process.env.YANDEX_CLIENT_ID || '', secret: process.env.YANDEX_CLIENT_SECRET || '', redirect: '/auth/yandex/callback' },
};
const PUBLIC_URL = process.env.PUBLIC_URL || ''; // напр. https://t.example.ru — для редиректов OAuth

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.webm': 'video/webm', '.mp4': 'video/mp4',
  '.pdf': 'application/pdf', '.zip': 'application/zip', '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
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
const TOKENS_FILE = path.join(process.env.TELEPORT_DATA_DIR || path.join(ROOT, 'data'), 'tokens.json');
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
async function userByReq(req) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : (req.url.split('token=')[1] || '').split('&')[0];
  return await userByToken(t);
}
function publicUser(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, username: u.username, avatar: u.avatar || null, bio: u.bio || '', provider: u.provider };
}

/* ---- коды подтверждения + боевая отправка (SMS-шлюз или e-mail) ---- */
const codes = new Map();
const lastSmsAt = new Map(); // rate-limit: не чаще 1 SMS на номер раз в 60 секунд
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

function fetchTimeout(url, opts = {}, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, Object.assign({ signal: ctrl.signal }, opts)).finally(() => clearTimeout(t));
}

/* SMS через smsc.ru */
async function sendSmsSmscru(phone, text) {
  const login = process.env.SMSCRU_LOGIN, pass = process.env.SMSCRU_PASSWORD;
  if (!login || !pass) throw new Error('SMSCRU_LOGIN/SMSCRU_PASSWORD не заданы в .env');
  const u = new URL('https://smsc.ru/send.php/');
  u.searchParams.set('login', login); u.searchParams.set('password', pass);
  u.searchParams.set('phone', phone); u.searchParams.set('mes', text); u.searchParams.set('charset', 'utf-8');
  const j = await fetchTimeout(u).then(r => r.json());
  if (j.error && j.error !== 'None') throw new Error('smsc.ru: ' + (j.error_code || '') + ' ' + j.error);
  return true;
}
/* SMS через Cellhippus */
async function sendSmsCellhippus(phone, text) {
  const token = process.env.CELLHIPPUS_TOKEN;
  if (!token) throw new Error('CELLHIPPUS_TOKEN не задан в .env');
  const j = await fetchTimeout('https://api.cellhippus.ru/v1/sms/send', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, message: text }),
  }).then(r => r.json());
  if (j.error) throw new Error('cellhippus: ' + j.error);
  return true;
}
/* E-mail без npm-зависимостей — raw SMTP (STARTTLS/PLAIN AUTH) */
function sendMail(to, subject, text) {
  return new Promise((resolve, reject) => {
    const net = require('net'), tls = require('tls');
    const host = process.env.SMTP_HOST, port = +(process.env.SMTP_PORT || 465), user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
    if (!host || !user || !pass) return reject(new Error('SMTP_HOST/SMTP_USER/SMTP_PASS не заданы в .env'));
    const from = process.env.SMTP_FROM || user;
    let sock, stage = 'connect';
    const log = {};
    function step(cmd, expect, next) {
      const onData = (chunk) => {
        const s = chunk.toString();
        if (/^\d+/.test(s)) {
          sock.removeListener('data', onData);
          if (expect && !s.startsWith(expect)) return reject(new Error('SMTP ' + stage + ': ' + s.split('\r\n')[0]));
          next();
        }
      };
      sock.on('data', onData);
      if (cmd) sock.write(cmd + '\r\n');
    }
    function finish() {
      const boundary = '--tp' + uid();
      const msg = ['From: ' + from, 'To: ' + to, 'Subject: =?UTF-8?B?' + Buffer.from(subject, 'utf8').toString('base64') + '?=',
        'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '',
        text.replace(/\./g, '..'), '.'].join('\r\n');
      step('DATA', '3', () => step(msg, '250', () => step('QUIT', null, () => { try { sock.end(); } catch (e) {} resolve(true); })));
    }
    function authAndMail() {
      step('AUTH LOGIN', '334', () => step(Buffer.from(user).toString('base64'), '334', () =>
        step(Buffer.from(pass).toString('base64'), '235', () =>
          step('MAIL FROM:<' + from + '>', '250', () => step('RCPT TO:<' + to + '>', '250', finish))
        )));
    } /*fixed*/
    function afterSecure() { step('EHLO teleport', null, authAndMail); }
    function startTls() {
      step('STARTTLS', '220', () => {
        const secure = tls.connect({ socket: sock, servername: host, rejectUnauthorized: false }, afterSecure);
        secure.on('error', reject); sock = secure;
      });
    }
    sock = net.connect(port, host);
    sock.setTimeout(15000, () => { try { sock.destroy(); } catch (e) {} reject(new Error('SMTP timeout')); });
    sock.on('error', reject);
    step(null, '220', () => {
      if (port === 465) { // implicit TLS
        const secure = tls.connect({ socket: sock, servername: host, rejectUnauthorized: false }, afterSecure);
        secure.on('error', reject); sock = secure;
      } else { step('EHLO teleport', null, startTls); }
    });
  });
}
async function deliverCode(channel, target, code) {
  if (channel === 'sms') {
    const provider = (process.env.SMS_PROVIDER || 'smscru').toLowerCase();
    const text = `${code} — ваш код входа в Teleport. Никому его не передавайте!`;
    if (provider === 'cellhippus') return sendSmsCellhippus(target, text);
    return sendSmsSmscru(target, text);
  }
  return sendMail(target, 'Код входа в Teleport', `Ваш код: ${code}\nДействует 5 минут. Если вы вход не запрашивали — просто проигнорируйте письмо.`);
}

/* ---- создание аккаунта ---- */
async function createUser({ name, username, provider, email, phone, pass, avatar }) {
  const u = {
    id: 'u_' + uid(), name: sanitize(name, 32) || 'Пользователь',
    username: username || ('@user' + uid().slice(0, 6)),
    provider: provider || 'phone', email: email || null, phone: phone || null,
    avatar: avatar || null, bio: '', created_at: Date.now(),
  };
  if (pass) { u.salt = crypto.randomBytes(8).toString('hex'); u.pass_hash = hashPass(pass, u.salt); }
  await db.insert('users', u);
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

    /* --- промисифицированные обёртки БД: работают синхронно (SQLite/JSON) и асинхронно (PostgreSQL) --- */
    const A = (v) => (v && typeof v.then === 'function') ? v : Promise.resolve(v);
    const adb = {
      get: (t, id) => A(db.get(t, id)), by: (t, c, v) => A(db.by(t, c, v)), one: (t, c, v) => A(db.one(t, c, v)),
      insert: (t, o) => A(db.insert(t, o)), update: (t, id, p) => A(db.update(t, id, p)), remove: (t, id) => A(db.remove(t, id)),
      where: (t, s, p) => A(db.where(t, s, p)), addContact: (o, p) => A(db.addContact(o, p)),
      contactsOf: (o) => A(db.contactsOf(o)), history: (c, l) => A(db.history(c, l)), prune: (k) => A(db.prune(k)),
    };
    async function userByTokenA(t) {
      const rec = tokens[t];
      if (!rec || rec.exp < Date.now()) return null;
      return await aadb.get('users', rec.userId);
    }
    async function userByReqA(req) {
      const h = req.headers.authorization || '';
      const t = h.startsWith('Bearer ') ? h.slice(7) : (req.url.split('token=')[1] || '').split('&')[0];
      return userByTokenA(t);
    }

    if (req.method === 'GET' && url === '/api/check') {
      const v = (q.get('v') || '').trim();
      const taken = !!(await adb.one('users', 'username', normUsername(v.replace(/^@/, ''))));
      return json(res, 200, { ok: true, taken });
    }

    /* телефон: запрос кода (боевой: SMS-шлюз; опция EMAIL_MODE — код на почту) */
    if (req.method === 'POST' && url === '/api/code_phone') {
      const b = await readJSON(req); if (!b) return json(res, 400, { ok: false, error: 'bad json' });
      const phone = normPhone(b.phone);
      if (phone.length !== 10) return json(res, 200, { ok: false, error: 'Введите номер из 10 цифр' });
      const last = lastSmsAt.get(phone) || 0;
      if (Date.now() - last < 60000) return json(res, 200, { ok: false, error: 'Повторный запрос можно через 60 секунд' });

      const emailMode = process.env.EMAIL_MODE === '1';
      let channel = null, target = '7' + phone;
      if (process.env.SMS_PROVIDER && (process.env.SMSCRU_LOGIN || process.env.CELLHIPPUS_TOKEN)) channel = 'sms';
      else if (emailMode && process.env.SMTP_HOST) {
        const u = await adb.by('users', 'phone', phone)[0];
        if (!u || !u.email) return json(res, 200, { ok: false, error: 'Для входа по телефону нужен e-mail-код (EMAIL_MODE) или SMS-шлюз. Зарегистрируйтесь по почте.' });
        channel = 'email'; target = u.email;
      } else {
        return json(res, 200, { ok: false, error: 'SMS-вход ещё не подключён: укажите SMS-шлюз в .env. Войдите по почте, VK или Яндексу.' });
      }
      const code = issueCode('ph:' + phone);
      lastSmsAt.set(phone, Date.now());
      try {
        await deliverCode(channel, target, code);
        console.log(`[Teleport] Код для +7${phone} отправлен (${channel}).`);
        return json(res, 200, { ok: true, sent_via: channel });
      } catch (e) {
        console.warn('[Teleport] Ошибка отправки кода:', e.message);
        return json(res, 200, { ok: false, error: 'Не удалось отправить код: ' + e.message });
      }
    }
    /* телефон: подтверждение → вход/регистрация */
    if (req.method === 'POST' && url === '/api/login_phone') {
      const b = await readJSON(req); if (!b) return json(res, 400, { ok: false, error: 'bad json' });
      const phone = normPhone(b.phone);
      if (!checkCode('ph:' + phone, b.code)) return json(res, 200, { ok: false, error: 'Неверный или истёкший код' });
      let u = await adb.by('users', 'phone', phone)[0];
      if (!u) u = await createUser({ name: sanitize(b.name, 32) || 'Телефон-' + phone.slice(-4), provider: 'phone', phone });
      else if (u.phone !== phone) await adb.update('users', u.id, { phone }); // привязка номера к существующему аккаунту
      return json(res, 200, { ok: true, token: makeToken(u.id), user: publicUser(u) });
    }

    /* e-mail: регистрация (с подтверждением почты кодом, если настроена почта) */
    if (req.method === 'POST' && url === '/api/signup_email') {
      const b = await readJSON(req); if (!b) return json(res, 400, { ok: false, error: 'bad json' });
      const email = sanitize(b.email, 64).toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, 200, { ok: false, error: 'Некорректная почта' });
      if (await adb.where('users', 'email=?', [email]).length) return json(res, 200, { ok: false, error: 'Эта почта уже зарегистрирована' });
      if (String(b.password || '').length < 6) return json(res, 200, { ok: false, error: 'Пароль минимум 6 символов' });
      const uname = normUsername(b.username || email.split('@')[0]);
      if (!uname || uname === '@') return json(res, 200, { ok: false, error: 'Придумайте @имя' });
      if (await adb.one('users', 'username', uname)) return json(res, 200, { ok: false, error: '@имя занято' });
      /* боевая проверка: код на почту обязателен, если SMTP настроен */
      if (process.env.SMTP_HOST && process.env.SMTP_USER) {
        if (!b.code) {
          const code = issueCode('em:' + email);
          try { await deliverCode('email', email, code); } catch (e) {
            return json(res, 200, { ok: false, error: 'Не удалось отправить письмо с кодом: ' + e.message });
          }
          return json(res, 200, { ok: false, need_code: true, error: 'Мы отправили код подтверждения на ' + email });
        }
        if (!checkCode('em:' + email, b.code)) return json(res, 200, { ok: false, need_code: true, error: 'Неверный или истёкший код из письма' });
      }
      const u = await createUser({ name: sanitize(b.name, 32) || email.split('@')[0], username: uname, provider: 'email', email, pass: b.password });
      return json(res, 200, { ok: true, token: makeToken(u.id), user: publicUser(u) });
    }
    /* сброс пароля по почте */
    if (req.method === 'POST' && url === '/api/forgot_password') {
      const b = await readJSON(req); if (!b) return json(res, 400, { ok: false });
      const email = sanitize(b.email, 64).toLowerCase();
      const u = await adb.where('users', 'email=?', [email])[0];
      if (!u) return json(res, 200, { ok: false, error: 'Аккаунт с такой почтой не найден' });
      if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return json(res, 200, { ok: false, error: 'Восстановление по почте недоступно: не настроен SMTP' });
      if (!b.code) {
        const code = issueCode('rp:' + email);
        try { await deliverCode('email', email, code); } catch (e) {
          return json(res, 200, { ok: false, error: 'Не удалось отправить письмо: ' + e.message });
        }
        return json(res, 200, { ok: false, need_code: true, error: 'Код для смены пароля отправлен на ' + email });
      }
      if (!checkCode('rp:' + email, b.code)) return json(res, 200, { ok: false, need_code: true, error: 'Неверный или истёкший код' });
      if (String(b.new_password || '').length < 6) return json(res, 200, { ok: false, error: 'Новый пароль минимум 6 символов' });
      const salt = crypto.randomBytes(8).toString('hex');
      await adb.update('users', u.id, { salt, pass_hash: hashPass(b.new_password, salt) });
      return json(res, 200, { ok: true, token: makeToken(u.id), user: publicUser(await adb.get('users', u.id)) });
    }
    /* e-mail: вход */
    if (req.method === 'POST' && url === '/api/login_email') {
      const b = await readJSON(req); if (!b) return json(res, 400, { ok: false, error: 'bad json' });
      const email = sanitize(b.email, 64).toLowerCase();
      const u = await adb.where('users', 'email=?', [email])[0];
      if (!u || !u.pass_hash) return json(res, 200, { ok: false, error: 'Аккаунт не найден' });
      if (hashPass(b.password || '', u.salt) !== u.pass_hash) return json(res, 200, { ok: false, error: 'Неверный пароль' });
      return json(res, 200, { ok: true, token: makeToken(u.id), user: publicUser(u) });
    }

    /* выход: инвалидация токена */
    if (req.method === 'POST' && url === '/api/logout') {
      const h = req.headers.authorization || '';
      const t = h.startsWith('Bearer ') ? h.slice(7) : '';
      if (t && tokens[t]) { delete tokens[t]; saveTokens(); }
      return json(res, 200, { ok: true });
    }

    /* VK / Яндекс: ссылка авторизации (боевой OAuth 2.0) */

    /* VK / Яндекс: ссылка авторизации (боевой OAuth 2.0) */
    if (req.method === 'GET' && (url === '/api/oauth/vk' || url === '/api/oauth/yandex')) {
      const prov = url.endsWith('vk') ? 'vk' : 'yandex';
      const base = PUBLIC_URL || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
      const redir = base + OAUTH[prov].redirect;
      if (!OAUTH[prov].client_id) {
        return json(res, 200, { ok: false, error: `Вход через ${prov === 'vk' ? 'VK' : 'Яндекс'} ещё не настроен: добавьте ключи в .env`, not_configured: true });
      }
      const state = crypto.randomBytes(8).toString('hex');
      try { fs.writeFileSync(path.join(ROOT, 'data', `oauth_state_${prov}.json`), JSON.stringify({ state, exp: Date.now() + 600000 })); } catch (e) {}
      const loc = prov === 'vk'
        ? `https://id.vk.com/authorize?response_type=code&client_id=${OAUTH[prov].client_id}&redirect_uri=${encodeURIComponent(redir)}&scope=phone,email&state=${state}`
        : `https://oauth.yandex.ru/authorize?response_type=code&client_id=${OAUTH[prov].client_id}&redirect_uri=${encodeURIComponent(redir)}&state=${state}`;
      return json(res, 200, { ok: true, url: loc });
    }
    /* колбэки OAuth (боевые) */
    if (req.method === 'GET' && (url === '/auth/vk/callback' || url === '/auth/yandex/callback')) {
      const prov = url.includes('/vk/') ? 'vk' : 'yandex';
      const code = q.get('code');
      if (!code || !OAUTH[prov].client_id) { res.writeHead(302, { Location: '/' }); return res.end(); }
      try {
        const base = PUBLIC_URL || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
        let tokResp, uidProvider = null;
        if (prov === 'vk') {
          // VK ID (OAuth 2.1): exchange по POST form + /user_info c access_token
          tokResp = await fetchTimeout('https://id.vk.com/auth/oauth/token', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: OAUTH[prov].client_id, redirect_uri: base + OAUTH[prov].redirect }).toString(),
          }).then(r => r.json());
          const at = tokResp.access_token; if (!at) throw new Error('VK: нет access_token');
          const vi = await fetchTimeout('https://api.vk.com/method/account.getInfo?fields=first_name,last_name,photo_200&v=5.199&access_token=' + at).then(r => r.json());
          const j = (vi.response && vi.response[0]) || {};
          uidProvider = String(vi.user_id || j.user_id || '');
          var name = [j.first_name, j.last_name].filter(Boolean).join(' ') || 'Пользователь VK';
          var email = j.email || null, avatar = j.photo_200 || null;
        } else {
          tokResp = await fetchTimeout('https://oauth.yandex.ru/token', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: OAUTH[prov].client_id, client_secret: OAUTH[prov].secret }),
          }).then(r => r.json());
          const at = tokResp.access_token; if (!at) throw new Error('Яндекс: нет access_token');
          const prof = await fetchTimeout('https://login.yandex.ru/info?format=json', { headers: { Authorization: 'OAuth ' + at } }).then(r => r.json());
          uidProvider = String(prof.id || '');
          var name = prof.display_name || prof.real_domain || 'Пользователь Яндекс';
          var email = prof.default_email || null;
          var avatar = prof.default_avatar ? `https://avatars.yandex.net/get-yapic/${prof.default_avatar}/islands-200` : null;
        }
        if (!uidProvider) throw new Error('не удалось определить id пользователя');
        let u = await adb.where('users', 'provider=?', [prov]).find(x => x.ext_id === uidProvider) ||
                (email && await adb.where('users', 'email=?', [email])[0]);
        if (!u) {
          u = await createUser({ name: String(name).trim(), username: normUsername(String(name).replace(/\s+/g, '_')), provider: prov, email, avatar });
          await adb.update('users', u.id, { ext_id: uidProvider });
        } else await adb.update('users', u.id, { name: String(name).trim() || u.name, avatar: avatar || u.avatar, ext_id: uidProvider });
        res.writeHead(302, { Location: '/#token=' + makeToken(u.id) });
        res.end();
      } catch (e) {
        console.warn('[Teleport] OAuth error:', e.message);
        res.writeHead(302, { Location: '/?auth_error=' + encodeURIComponent(e.message) }); res.end();
      }
      return;
    }

    /* текущий профиль */
    if (req.method === 'GET' && url === '/api/me') {
      const u = await userByReqA(req);
      return u ? json(res, 200, { ok: true, user: publicUser(u) }) : json(res, 401, { ok: false, error: 'no session' });
    }

    /* обновление профиля */
    if (req.method === 'POST' && url === '/api/profile') {
      const u = await userByReqA(req); if (!u) return json(res, 401, { ok: false });
      const b = await readJSON(req); if (!b) return json(res, 400, { ok: false });
      const patch = {};
      if (b.name) patch.name = sanitize(b.name, 32);
      if (typeof b.bio === 'string') patch.bio = sanitize(b.bio, 120);
      if (typeof b.avatar === 'string' && b.avatar.startsWith('data:image/')) patch.avatar = b.avatar.slice(0, 300 * 1024);
      if (b.username) {
        const uname = normUsername(b.username);
        const busy = await adb.one('users', 'username', uname);
        if (busy && busy.id !== u.id) return json(res, 200, { ok: false, error: '@имя занято' });
        patch.username = uname;
      }
      await adb.update('users', u.id, patch);
      return json(res, 200, { ok: true, user: publicUser(await adb.get('users', u.id)) });
    }

    /* поиск людей по @username / имени */
    if (req.method === 'GET' && url === '/api/search_users') {
      const me = await userByReqA(req); if (!me) return json(res, 401, { ok: false });
      const raw = (q.get('q') || '').trim().toLowerCase();
      if (raw.length < 2) return json(res, 200, { ok: true, users: [] });
      const wantUname = raw.startsWith('@') ? normUsername(raw.slice(1)) : null;
      const all = await adb.where('users', 'id IS NOT NULL').filter(u =>
        u.id !== me.id && (wantUname ? u.username === wantUname : (String(u.name).toLowerCase().includes(raw) || String(u.username).toLowerCase().includes(raw)))
      ).slice(0, 20).map(publicUser);
      return json(res, 200, { ok: true, users: all });
    }

    /* загрузка медиа (фото, файлы, голосовые, видеокружки) */
    if (req.method === 'POST' && url === '/upload') {
      const ct = (req.headers['content-type'] || '').split(';')[0];
      const IMG_EXT = ['.jpg', '.png', '.webp', '.gif'];
      const VIDEO_EXT = ['.webm', '.mp4', '.mov', '.m4v'];
      const AUDIO_EXT = { 'audio/ogg': '.ogg', 'audio/webm': '.webm', 'audio/mp4': '.m4a', 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav' };
      const VIDEO_CT  = { 'video/webm': '.webm', 'video/mp4': '.mp4', 'video/quicktime': '.mov' };
      try {
        let buf = await readBody(req, 16 * 1024 * 1024); // до 16 МБ — видео/файлы
        let ext = [...IMG_EXT, ...VIDEO_EXT].includes(q.get('ext') || '') ? q.get('ext') : null; // явный hint от клиента
        if (!ext && ct === 'multipart/form-data') {
          const m = /filename="[^"]*\.(jpe?g|png|webp|gif|ogg|webm|m4a|mp3|wav|mp4|mov)"/i.exec(buf.toString('latin1').slice(0, 2048));
          ext = m ? '.' + m[1].toLowerCase().replace('jpeg', 'jpg') : '.jpg';
          const idx = buf.indexOf('\r\n\r\n'); if (idx >= 0) buf = buf.slice(idx + 4);
          const tail = buf.lastIndexOf('\r\n--'); if (tail > 0) buf = buf.slice(0, tail);
        }
        if (!ext) ext = AUDIO_EXT[ct] || VIDEO_CT[ct] || IMG_EXT.find(e => e === '.' + ((q.get('name') || '').match(/\.(\w+)$/) || [])[1]?.toLowerCase()) || '.bin';
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
  /* При TELEPORT_DATA_DIR загрузки лежат на диске данных — ищем их там в первую очередь. */
  const readTarget = (fileUrl.startsWith('/uploads/') && process.env.TELEPORT_DATA_DIR)
    ? path.join(MEDIA_DIR, path.basename(file))
    : file;
  fs.readFile(readTarget, (err, data) => {
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
const seenMsgs = new Set();     // дедупликация: mid уже принят (защита от ретраев клиента)

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

async function saveMessage(m) {
  await db.insert('messages', {
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

  ws.on('message', async (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    const me = ws._user;

    switch (m.t) {
      case 'auth': { // { t:'auth', token }
        const u = await userByToken(String(m.token || ''));
        if (!u) return send(ws, { t: 'auth_fail' });
        ws._user = u;
        if (!byUser.has(u.id)) byUser.set(u.id, new Set());
        byUser.get(u.id).add(ws);
        send(ws, { t: 'auth_ok', me: publicUser(u) });
        // подписка: общий чат + все личные комнаты пользователя
        const myRooms = new Set(['room_global']);
        for (const cid of await db.contactsOf(u.id)) myRooms.add(cid);
        for (const c of myRooms) { ensureRoom(c); rooms.get(c).add(ws); (ws._chats = ws._chats || new Set()).add(c); }
        // история — чтобы чаты восстановились на любом устройстве
        const chatsOut = [];
        for (const c of myRooms) {
        const hist = await db.history(c, 300).map(row => {
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
        await db.addContact(me.id, chatId);
        await db.addContact(String(m.peerUserId), chatId); // взаимно — чат появится у собеседника
        ensureRoom(chatId);
        toUser(String(m.peerUserId), { t: 'contact_added', from: publicUser(me), chatId });
        send(ws, { t: 'ok', what: 'contacts:add' });
        break;
      }

      case 'msg': { // { t:'msg', chatId, mid, text, mediaUrl, ts, replyTo, fwdFrom }
        if (!me) return;
        const chatId = String(m.chatId || '').slice(0, 80);
        const mid = String(m.mid || uid()).slice(0, 32);
        if (seenMsgs.has(mid)) return;            // дедупликация повторов клиента
        seenMsgs.add(mid); if (seenMsgs.size > 5000) seenMsgs.clear();
        const clip = (v) => typeof v === 'string' ? v.slice(0, 200) : null;
        const payload = {
          t: 'msg', chatId,
          from: sanitize(me.name, 32), fromId: me.id,
          mid,
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
        await saveMessage(payload);
        toChat(chatId, payload, ws);
        break;
      }

      case 'edit': { // { t:'edit', chatId, mid, text }
        if (!me) return;
        const row = await db.get('messages', String(m.mid || '').slice(0, 32));
        if (!row || row.sender !== me.id) return;
        await db.update('messages', row.id, { text: String(m.text || '').slice(0, 4000), edited: 1 });
        toChat(String(m.chatId), { t: 'edit', chatId: row.chat_id, mid: row.id, text: String(m.text || '').slice(0, 4000) }, ws);
        break;
      }
      case 'del': { // { t:'del', chatId, mid }
        if (!me) return;
        const row = await db.get('messages', String(m.mid || '').slice(0, 32));
        if (!row || row.sender !== me.id) return;
        await db.update('messages', row.id, { deleted: 1, text: '', media: null });
        toChat(String(m.chatId), { t: 'del', chatId: row.chat_id, mid: row.id }, ws);
        break;
      }

      case 'read': { // { t:'read', chatId } — отправляем владельцу сообщений (me читает чужие)
        if (!me) return;
        const set = rooms.get(String(m.chatId)); if (!set) return;
        for (const peer of set) if (peer._user && peer._user.id !== me.id) send(peer, { t: 'read', by: me.id, byName: me.name });
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
        if (m.t === 'call') { // параллельно — всем остальным устройствам звонящего, чтобы закрыть «исходящий» на них
          for (const s of byUser.get(me.id) || []) if (s !== ws) send(s, { t: 'call-self', to: target, kind: m.kind || 'audio' });
        }
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

server.listen(PORT, process.env.BIND_HOST || '0.0.0.0', () => {
  console.log(`✅ Teleport PRO запущен: http://localhost:${PORT}`);
  console.log(`   База данных: ${db.engine}`);
  console.log(`   WebSocket: ws://localhost:${PORT}/ws`);
  if (!OAUTH.vk.client_id) console.log('   ⚠️ VK OAuth не настроен — добавьте VK_CLIENT_ID/VK_CLIENT_SECRET в .env');
  if (!OAUTH.yandex.client_id) console.log('   ⚠️ Яндекс OAuth не настроен — добавьте YANDEX_CLIENT_ID/YANDEX_CLIENT_SECRET в .env');
  if (!(process.env.SMS_PROVIDER && (process.env.SMSCRU_LOGIN || process.env.CELLHIPPUS_TOKEN)) && process.env.EMAIL_MODE !== '1')
    console.log('   ⚠️ SMS/код по телефону выключен: подключите SMS-шлюз или EMAIL_MODE=1 + SMTP_* в .env');
});
