/* ============ store.js — слой хранения (localStorage), v4 ============
   Данные аккаунта и чаты живут локально; синхронизация с сервером — в app.js/net.js */
const Store = (() => {
  const KEY = 'teleport_data_v3';
  const OLD_KEYS = ['teleport_data_v2', 'teleport_data_v1'];

  const WALLPAPERS = ['pattern', 'ocean', 'sunset', 'forest', 'dark', 'none'];

  const defaultData = () => ({
    me: null,                 // { name, avatar, bio } + поля аккаунта (id, username)
    theme: 'light',           // light | dark
    fontScale: 100,           // 85..135
    wallpaper: 'pattern',     // см. WALLPAPERS
    notif: true,
    sound: true,
    soundKind: 'melody',      // melody | marimba | chime | pop
    enterToSend: true,
    sendReadReceipts: true,   // отправлять «прочитано» собеседнику
    showOnline: true,         // показывать меня как «в сети»
    chats: [],
    muted: [],
    drafts: {},               // chatId -> text
    statuses: {},             // chatId -> { online, lastSeen }
    contacts: {},             // userId -> { id,name,username,avatar,chatId }
  });

  let data = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return migrate(JSON.parse(raw));
      for (const ok of OLD_KEYS) {
        const old = localStorage.getItem(ok);
        if (old) {
          const d = migrate(JSON.parse(old));
          try { localStorage.setItem(KEY, JSON.stringify(d)); localStorage.removeItem(ok); } catch (e) {}
          return d;
        }
      }
    } catch (e) { console.warn('load failed', e); }
    return defaultData();
  }

  function migrate(d) {
    const base = defaultData();
    const out = Object.assign(base, d);
    out.chats = (out.chats || []).map(c => Object.assign({
      pinned: false, muted: false, archived: false, avatar: null, bio: '',
      lastSeen: Date.now() - 3600000, kind: 'user', peerId: null,
    }, c));
    out.drafts = out.drafts || {};
    out.statuses = out.statuses || {};
    out.contacts = out.contacts || {};
    if (!['melody', 'marimba', 'chime', 'pop'].includes(out.soundKind)) out.soundKind = 'melody';
    if (typeof out.sendReadReceipts !== 'boolean') out.sendReadReceipts = true;
    if (typeof out.showOnline !== 'boolean') out.showOnline = true;
    if (out.me && typeof out.me === 'object') { out.me.avatar = out.me.avatar || null; out.me.bio = out.me.bio || ''; }
    return out;
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('save failed, pruning media…', e && e.name);
      try {
        for (const c of data.chats) {
          const withMedia = c.messages.filter(m => m.media);
          for (const m of withMedia.slice(0, Math.ceil(withMedia.length / 2))) m.media = null;
        }
        localStorage.setItem(KEY, JSON.stringify(data));
      } catch (e2) { console.error('save failed permanently', e2); }
    }
  }

  const COLORS = ['#3390ec', '#e17076', '#7bc862', '#a284e2', '#eec643', '#6ac9ce', '#d885f4', '#e8815a'];
  const pickColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

  /* ---------- стартовый набор: только Избранное и общий чат (без ботов) ---------- */
  function seedIfEmpty() {
    if (data.chats.length) return;
    const now = Date.now();
    data.chats = [
      mkChat('c_saved', 'Избранное', '#3390ec', [
        msgFrom('self', 'Сохранённые сообщения — ваш личный блокнот 📝', now),
      ]),
      mkChat('room_global', '🌍 Общий чат', '#7c5cff', [
        msgFrom('self', 'Здесь пишут реальные люди, зарегистрированные на этом сервере. Найдите друзей через «＋» и начните личный чат!', now),
      ], 'global'),
    ];
    save();
  }

  function mkChat(id, name, color, messages = [], kind = 'user', unread = 0) {
    return {
      id, name, color: color || pickColor(), online: false, unread, messages,
      pinned: false, muted: false, archived: false, avatar: null, bio: '',
      kind, peerId: null,
      lastSeen: Date.now() - 3600000,
    };
  }
  function msgFrom(from, text, ts, status = 'read') {
    return { id: uid(), from, text, ts, status, media: null, replyTo: null, edited: false, deleted: false, starred: false };
  }
  function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

  /* ---------- публичный API ---------- */
  return {
    get data() { return data; },
    WALLPAPERS, colors: COLORS,
    seedIfEmpty, save, uid, mkChat,
    KEY,

    newChat(name, opts = {}) {
      const c = mkChat(opts.id || uid(), name, opts.color, [], opts.kind || 'user');
      c.peerId = opts.peerId || null;
      if (opts.avatar) c.avatar = opts.avatar;
      if (opts.bio) c.bio = opts.bio;
      data.chats.unshift(c); save(); return c;
    },
    chat(id) { return data.chats.find(c => c.id === id); },
    chatByPeer(peerId) { return data.chats.find(c => c.peerId === peerId); },
    addMessage(chatId, m) {
      const c = this.chat(chatId); if (!c) return;
      const dup = c.messages.some(x => x.id === m.id);
      if (dup) { Object.assign(c.messages.find(x => x.id === m.id), m); save(); return c; }
      c.messages.push(m);
      if (m.from !== 'me' && m.from !== 'self') c.lastSeen = Date.now();
      save(); return c;
    },
    updateMessage(chatId, msgId, patch) {
      const c = this.chat(chatId); if (!c) return;
      const m = c.messages.find(x => x.id === msgId);
      if (m) { Object.assign(m, patch); save(); }
    },
    deleteMessage(chatId, msgId) { this.updateMessage(chatId, msgId, { deleted: true, text: '', media: null, starred: false }); },
    clearChat(chatId) { const c = this.chat(chatId); if (c) { c.messages = []; save(); } },
    clearAll() { data.chats.forEach(c => c.messages = []); save(); },
    markRead(chatId) { const c = this.chat(chatId); if (c) { c.unread = 0; save(); } },

    setTheme(t) { data.theme = t; save(); },
    setFont(v) { data.fontScale = v; save(); },
    setWallpaper(w) { data.wallpaper = w; save(); },
    setNotif(v) { data.notif = v; save(); },
    setSound(v) { data.sound = v; save(); },
    setEnterToSend(v) { data.enterToSend = v; save(); },
    setReadReceipts(v) { data.sendReadReceipts = !!v; save(); },
    setShowOnline(v) { data.showOnline = !!v; save(); },

    setMe(patch) {
      data.me = Object.assign({ avatar: null, bio: '' }, data.me, patch);
      save();
    },
    setMyAvatar(dataUrl) { if (data.me) { data.me.avatar = dataUrl; save(); } },
    setMyBio(bio) { if (data.me) { data.me.bio = bio; save(); } },
    logout() {
      // удаляем локальные живые чаты/контакты, но оставляем Избранное
      data.chats = data.chats.filter(c => c.id === 'c_saved');
      data.contacts = {}; data.statuses = {}; data.drafts = {};
      data.me = null;
      localStorage.removeItem('teleport_token');
      save();
    },

    /* контакты (реальные пользователи сервера) */
    addContact(u, chatId) {
      data.contacts[u.id] = { id: u.id, name: u.name, username: u.username, avatar: u.avatar || null, chatId };
      save();
    },
    removeContact(userId) { delete data.contacts[userId]; save(); },

    setDraft(chatId, text) {
      if (text) data.drafts[chatId] = text; else delete data.drafts[chatId];
      save();
    },
    getDraft(chatId) { return data.drafts[chatId] || ''; },

    setStatus(chatId, patch) {
      data.statuses[chatId] = Object.assign({}, data.statuses[chatId], patch);
      save();
    },
    getStatus(chatId) { return data.statuses[chatId] || null; },

    togglePin(chatId) { const c = this.chat(chatId); if (!c) return; c.pinned = !c.pinned; save(); return c.pinned; },
    toggleMute(chatId) { const c = this.chat(chatId); if (!c) return; c.muted = !c.muted; save(); return c.muted; },
    toggleArchive(chatId) { const c = this.chat(chatId); if (!c) return; c.archived = !c.archived; save(); return c.archived; },
    toggleStar(chatId, msgId) {
      const c = this.chat(chatId); const m = c && c.messages.find(x => x.id === msgId);
      if (m) { m.starred = !m.starred; save(); }
      return m && m.starred;
    },
    setAvatar(chatId, dataUrl) { const c = this.chat(chatId); if (c) { c.avatar = dataUrl; save(); } },
    setBio(chatId, bio) { const c = this.chat(chatId); if (c) { c.bio = bio; save(); } },
    renameChat(chatId, name) { const c = this.chat(chatId); if (c) { c.name = name; save(); } },
    removeChat(chatId) { data.chats = data.chats.filter(c => c.id !== chatId); save(); },
    allMessages() {
      const out = [];
      for (const c of data.chats)
        for (const m of c.messages)
          if (!m.deleted) out.push({ chat: c, msg: m });
      return out.sort((a, b) => b.msg.ts - a.msg.ts);
    },
  };
})();
