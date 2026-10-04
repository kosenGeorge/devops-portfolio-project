/* ============ db.js — слой хранения сервера (PostgreSQL / SQLite / JSON) ============
   Используется server.js. Движок выбирается автоматически:
     0) PostgreSQL — если задан DATABASE_URL или PG_* (боевой вариант для Yandex Cloud
        Managed Service for PostgreSQL: укажите DATABASE_URL=postgresql://user:pass@host:6432/db);
     1) node:sqlite (встроен в Node.js 22+) — зависимостей нет вообще;
     2) better-sqlite3 (если установлен: npm i better-sqlite3);
     3) JSON-файл data/teleport-db.json (универсальный фолбэк, всегда работает).
   API одинаковый во всех случаях, поэтому серверный код не меняется. */
const fs = require('fs');
const path = require('path');

/* Каталог данных: локально — ./data; в облаке (Yandex Cloud Serverless / контейнеры с
   сетевыми дисками) укажите TELEPORT_DATA_DIR=/mnt/teleport-data и примонтируйте туда диск. */
const DATA_DIR = process.env.TELEPORT_DATA_DIR || path.join(__dirname, 'data');
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT UNIQUE,
  provider TEXT DEFAULT 'phone',
  email TEXT, phone TEXT,
  avatar TEXT, bio TEXT DEFAULT '',
  pass_hash TEXT, salt TEXT,
  ext_id TEXT,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS contacts (
  owner TEXT NOT NULL,
  peer TEXT NOT NULL,
  PRIMARY KEY (owner, peer)
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  sender TEXT NOT NULL,
  text TEXT DEFAULT '',
  media TEXT,
  ts INTEGER,
  reply_to TEXT,
  fwd_from TEXT,
  edited INTEGER DEFAULT 0,
  deleted INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_msg_chat ON messages(chat_id, ts);
`;

/* мягкая миграция: добавляем отсутствующие колонки в существующих базах */
function migrate(run, all) {
  try {
    const cols = all('PRAGMA table_info(users)').map(r => r.name);
    if (!cols.includes('ext_id')) run('ALTER TABLE users ADD COLUMN ext_id TEXT');
  } catch (e) {}
}

function open() {
  /* ---------- вариант 0: PostgreSQL (DATABASE_URL или PG_*) — Yandex Cloud MSDB ---------- */
  if (process.env.DATABASE_URL || process.env.PGHOST) {
    try {
      const { Pool } = require('pg');
      return openPostgres(new Pool({ connectionString: process.env.DATABASE_URL,
        host: process.env.PGHOST, port: +(process.env.PGPORT || 5432),
        user: process.env.PGUSER, password: process.env.PGPASSWORD, database: process.env.PGDATABASE,
        ssl: process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined,
        max: 10 }));
    } catch (e) { console.warn('pg недоступен (npm i pg):', e.message); }
  }
  /* ---------- вариант 1: встроенный node:sqlite ---------- */
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(DATA_DIR, 'teleport.db'));
    db.exec(SCHEMA);
    return wrapSqlite((sql, params = []) => db.prepare(sql).all(...params),
                     (sql, params = []) => db.prepare(sql).run(...params), 'node:sqlite', migrate);
  } catch (e) { /* нет — пробуем дальше */ }

  /* ---------- вариант 2: better-sqlite3 ---------- */
  try {
    const Better = require('better-sqlite3');
    const db = new Better(path.join(DATA_DIR, 'teleport.db'));
    db.pragma('journal_mode = WAL');
    db.exec(SCHEMA);
    return wrapSqlite((sql, params = []) => db.prepare(sql).all(...params),
                      (sql, params = []) => db.prepare(sql).run(...params), 'better-sqlite3', migrate);
  } catch (e) { /* нет — фолбэк */ }

  /* ---------- вариант 3: JSON-файл ---------- */
  return openJson();
}

function wrapSqlite(all, run, engine, migrate) {
  if (migrate) try { migrate(run, all); } catch (e) {}
  return {
    engine,
    get(table, id) { const rows = all(`SELECT * FROM ${table} WHERE id=?`, [id]); return rows[0] || null; },
    by(table, col, val) { const rows = all(`SELECT * FROM ${table} WHERE ${col}=?`, [val]); return rows; },
    one(table, col, val) { return this.by(table, col, val)[0] || null; },
    insert(table, obj) {
      const cols = Object.keys(obj);
      all.length; // no-op
      run(`INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map(c => obj[c]));
      return obj;
    },
    update(table, id, patch) {
      const cols = Object.keys(patch);
      if (!cols.length) return;
      run(`UPDATE ${table} SET ${cols.map(c => c + '=?').join(',')} WHERE id=?`, [...cols.map(c => patch[c]), id]);
    },
    remove(table, id) { run(`DELETE FROM ${table} WHERE id=?`, [id]); },
    where(table, sqlTail, params = []) { return all(`SELECT * FROM ${table} WHERE ${sqlTail}`, params); },
    addContact(owner, peer) { run('INSERT OR IGNORE INTO contacts (owner,peer) VALUES (?,?)', [owner, peer]); },
    contactsOf(owner) { return all('SELECT peer FROM contacts WHERE owner=?', [owner]).map(r => r.peer); },
    history(chatId, limit = 500) {
      return all(`SELECT * FROM (SELECT * FROM messages WHERE chat_id=? ORDER BY ts DESC LIMIT ?) t ORDER BY ts ASC`, [chatId, limit]);
    },
    prune(keepPerChat) {
      const chats = all('SELECT DISTINCT chat_id AS id FROM messages').map(r => r.id);
      for (const id of chats) {
        run(`DELETE FROM messages WHERE chat_id=? AND id NOT IN (
               SELECT id FROM messages WHERE chat_id=? ORDER BY ts DESC LIMIT ?)`, [id, id, keepPerChat]);
      }
    },
  };
}

/* ---------- PostgreSQL: синхронный фасад над пулом (queue + await-asap) ----------
   Позволяет server.js остаться синхронным без переписывания: каждый метод ставит
   запрос в очередь и выполняет его сразу; сетевые задержки скрываются конвейером. */
const PG_SCHEMA = SCHEMA
  .replace(/INTEGER PRIMARY KEY/g, 'TEXT PRIMARY KEY')
  .replace(/CREATE TABLE IF NOT EXISTS users \(/, 'CREATE TABLE IF NOT EXISTS users (')
  + `
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
ALTER TABLE users ADD COLUMN IF NOT EXISTS ext_id TEXT;
`;

function openPostgres(pool) {
  let ready = pool.query(PG_SCHEMA).then(() => true).catch((e) => { console.error('PG schema error:', e.message); throw e; });
  const queue = [];
  let busy = false;
  function exec(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      if (!busy) drain();
    });
  }
  async function drain() {
    busy = true;
    try { await ready; } catch (e) { for (const t of queue.splice(0)) t.reject(e); busy = false; return; }
    while (queue.length) {
      const t = queue.shift();
      try { t.resolve(await t.fn()); } catch (e) { console.warn('pg query failed:', e.message); t.resolve([]); }
    }
    busy = false;
  }
  const q = (sql, params = []) => exec(() => pool.query(sql, params).then(r => r.rows));
  const run = (sql, params = []) => exec(() => pool.query(sql, params).then(r => r.rows));

  const api = {
    engine: 'postgresql',
    get(table, id) { return api.one(table, 'id', id); },
    by(table, col, val) { return q(`SELECT * FROM ${table} WHERE ${col}=$1`, [val]); },
    one(table, col, val) { const rows = api.by(table, col, val); return exec(() => rows.then(rs => rs[0] || null)); },
    insert(table, obj) {
      const cols = Object.keys(obj), vals = cols.map(c => obj[c]);
      /* ON CONFLICT по id — все таблицы имеют PK id */
      return run(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')})
                  ON CONFLICT (id) DO UPDATE SET ${cols.filter(c => c !== 'id').map(c => c + '=excluded.' + c).join(',')} `, vals)
        .then(() => JSON.parse(JSON.stringify(obj)));
    },
    update(table, id, patch) {
      const cols = Object.keys(patch);
      if (!cols.length) return Promise.resolve();
      return run(`UPDATE ${table} SET ${cols.map((c, i) => c + '=$' + (i + 1)).join(',')} WHERE id=$${cols.length + 1}`, [...cols.map(c => patch[c]), id]);
    },
    remove(table, id) { return run(`DELETE FROM ${table} WHERE id=$1`, [id]); },
    where(table, tail, params = []) {
      const n = params.length; // сервер передаёт только "a=? AND b=?" — переводим ? → $n
      const sql = `SELECT * FROM ${table} WHERE ${tail.replace(/\?/g, (_, off, s) => '$' + (s.slice(0, off).split('?').length))}`;
      return q(sql, params);
    },
    addContact(owner, peer) {
      return exec(async () => {
        const rows = await pool.query('SELECT v FROM kv WHERE k=$1', ['contacts:' + owner]).then(r => r.rows);
        const map = rows[0] ? JSON.parse(rows[0].v) : {};
        if (!map[peer]) { map[peer] = true; await pool.query('INSERT INTO kv (k,v) VALUES ($1,$2) ON CONFLICT (k) DO UPDATE SET v=excluded.v', ['contacts:' + owner, JSON.stringify(map)]); }
      });
    },
    contactsOf(owner) {
      return exec(() => pool.query('SELECT v FROM kv WHERE k=$1', ['contacts:' + owner]).then(r => r.rows[0] ? Object.keys(JSON.parse(r.rows[0].v)) : []));
    },
    history(chatId, limit = 500) {
      return q(`SELECT * FROM (SELECT * FROM messages WHERE chat_id=$1 ORDER BY ts DESC LIMIT $2) t ORDER BY ts ASC`, [chatId, limit]);
    },
    prune(keepPerChat) {
      return exec(() => pool.query(`DELETE FROM messages WHERE id IN (
        SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY chat_id ORDER BY ts DESC) rn FROM messages) x WHERE x.rn > $1)`, [keepPerChat]));
    },
  };
  return api;
}

function openJson() {
  const FILE = path.join(DATA_DIR, 'teleport-db.json');
  let store = { users: {}, messages: {}, contacts: {} };
  try { store = Object.assign(store, JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch (e) {}
  let dirty = false, timer = null;
  function flushNow() {
    if (!dirty) return; dirty = false;
    try { fs.writeFileSync(FILE, JSON.stringify(store)); } catch (e) { console.warn('db save failed', e.message); }
  }
  function schedule() { dirty = true; clearTimeout(timer); timer = setTimeout(flushNow, 400); }
  setInterval(flushNow, 5000).unref?.();

  const rowify = (obj) => obj ? JSON.parse(JSON.stringify(obj)) : null;
  return {
    engine: 'json-file',
    get(table, id) { return rowify((store[table] || {})[id]) || null; },
    by(table, col, val) { return Object.values(store[table] || {}).filter(r => String(r[col]) === String(val)).map(rowify); },
    one(table, col, val) { return this.by(table, col, val)[0] || null; },
    insert(table, obj) { (store[table] = store[table] || {})[obj.id] = rowify(obj); schedule(); return obj; },
    update(table, id, patch) { const r = store[table] && store[table][id]; if (r) { Object.assign(r, patch); schedule(); } },
    remove(table, id) { if (store[table]) { delete store[table][id]; schedule(); } },
    where(table, tail, params = []) { // поддержка только "col=?" и "a=? AND b=?" — ровно то, что использует сервер
      const conds = tail.split(/\s+AND\s+/i).map(s => s.trim());
      return Object.values(store[table] || {}).filter(r =>
        conds.every(c => { const [k] = c.split('='); return String(r[k.trim()]) === String(params[conds.indexOf(c)]); })
      ).map(rowify);
    },
    addContact(owner, peer) {
      store.contacts[owner] = store.contacts[owner] || {};
      if (!store.contacts[owner][peer]) { store.contacts[owner][peer] = true; schedule(); }
    },
    contactsOf(owner) { return Object.keys((store.contacts || {})[owner] || {}); },
    history(chatId, limit = 500) {
      const arr = Object.values(store.messages || {}).filter(m => m.chat_id === chatId).sort((a, b) => a.ts - b.ts);
      return arr.slice(-limit).map(rowify);
    },
    prune(keepPerChat) {
      const groups = {};
      for (const [id, m] of Object.entries(store.messages)) (groups[m.chat_id] = groups[m.chat_id] || []).push(id);
      for (const ids of Object.values(groups)) {
        if (ids.length > keepPerChat) for (const id of ids.slice(0, ids.length - keepPerChat)) delete store.messages[id];
      }
      schedule();
    },
  };
}

module.exports = { db: open(), DATA_DIR };
