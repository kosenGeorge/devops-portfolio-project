/* ============ db.js — слой хранения сервера (SQLite) ============
   Используется server.js. Движок выбирается автоматически:
     1) node:sqlite (встроен в Node.js 22+) — зависимостей нет вообще;
     2) better-sqlite3 (если установлен: npm i better-sqlite3);
     3) JSON-файл data/teleport-db.json (универсальный фолбэк, всегда работает).
   API одинаковый во всех трёх случаях, поэтому серверный код не меняется. */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
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

function open() {
  /* ---------- вариант 1: встроенный node:sqlite ---------- */
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(DATA_DIR, 'teleport.db'));
    db.exec(SCHEMA);
    return wrapSqlite((sql, params = []) => db.prepare(sql).all(...params),
                     (sql, params = []) => db.prepare(sql).run(...params), 'node:sqlite');
  } catch (e) { /* нет — пробуем дальше */ }

  /* ---------- вариант 2: better-sqlite3 ---------- */
  try {
    const Better = require('better-sqlite3');
    const db = new Better(path.join(DATA_DIR, 'teleport.db'));
    db.pragma('journal_mode = WAL');
    db.exec(SCHEMA);
    return wrapSqlite((sql, params = []) => db.prepare(sql).all(...params),
                      (sql, params = []) => db.prepare(sql).run(...params), 'better-sqlite3');
  } catch (e) { /* нет — фолбэк */ }

  /* ---------- вариант 3: JSON-файл ---------- */
  return openJson();
}

function wrapSqlite(all, run, engine) {
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
