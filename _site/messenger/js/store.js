/* ============ store.js — слой хранения (localStorage), v2 ============ */
const Store = (() => {
  const KEY = 'teleport_data_v3';
  const OLD_KEYS = ['teleport_data_v2', 'teleport_data_v1'];

  const WALLPAPERS = ['pattern', 'ocean', 'sunset', 'forest', 'dark', 'none'];

  const defaultData = () => ({
    me: null,                 // { name, avatar, bio }
    theme: 'light',           // light | dark
    fontScale: 100,           // 85..135
    wallpaper: 'pattern',     // см. WALLPAPERS
    notif: true,
    sound: true,
    enterToSend: true,
    chats: [],
    muted: [],                // id заглушённых чатов (совместимость)
    drafts: {},               // черновики ввода: chatId -> text
    statuses: {},             // статусы в чате: chatId -> { online, lastSeen }
  });

  let data = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return migrate(JSON.parse(raw));
      for (const ok of OLD_KEYS) {                // перенос данных из старых версий
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
      lastSeen: Date.now() - 3600000,
    }, c));
    out.drafts = out.drafts || {};
    out.statuses = out.statuses || {};
    if (out.me && typeof out.me === 'object') { out.me.avatar = out.me.avatar || null; out.me.bio = out.me.bio || ''; }
    return out;
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      // квота: режем самые старые медиа и пробуем ещё раз
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

  const pickColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

  /* ---------- демо-данные при первом запуске ---------- */
  function seedIfEmpty() {
    if (data.chats.length) return;
    const now = Date.now();
    data.chats = [
      mkChat('c_saved', 'Избранное', '#3390ec', [
        msgFrom('self', 'Сохранённые сообщения — ваш личный блокнот 📝', now - 86400000),
        msgFrom('self', 'Отмечайте ⭐ важные сообщения и возвращайтесь к ним позже.', now - 86300000),
      ]),
      mkChat('c_alice', 'Алиса', '#e17076', [
        msgFrom('peer', 'Привет! Как дела? 👋', now - 7200000),
        msgOut('Привет! Всё отлично, тестирую новый мессенджер 🚀', now - 7100000, 'read'),
        msgFrom('peer', 'Выглядит как Telegram! Круто 😄', now - 7000000),
      ], true),
      mkChat('c_bob', 'Боб', '#7bc862', [
        msgFrom('peer', 'Скинь фотку вчерашней прогулки', now - 3 * 86400000),
      ]),
      mkChat('c_team', 'Команда разработки', '#a284e2', [
        msgFrom('peer', 'Деплой в 18:00, все на месте?', now - 5 * 3600000),
        msgFrom('peer', 'Я буду ✅', now - 4.8 * 3600000),
      ], false, 2),
      mkChat('c_dave', 'Dave 🤖', '#6ac9ce', [
        msgFrom('peer', 'Я бот-помощник. Напиши /help — покажу, что умею 🤖', now - 2 * 86400000),
      ], true),
    ];
    save();
  }

  const COLORS = ['#3390ec', '#e17076', '#7bc862', '#a284e2', '#eec643', '#6ac9ce', '#d885f4', '#e8815a'];

  function mkChat(id, name, color, messages = [], online = false, unread = 0) {
    return {
      id, name, color: color || pickColor(), online, unread, messages,
      pinned: false, muted: false, archived: false, avatar: null, bio: '',
      lastSeen: online ? Date.now() : Date.now() - 3600000 * (1 + Math.random() * 48),
    };
  }
  function msgFrom(from, text, ts, status = 'read') {
    return { id: uid(), from, text, ts, status, media: null, replyTo: null, edited: false, deleted: false, starred: false };
  }
  function msgOut(text, ts, status = 'sent') {
    return { id: uid(), from: 'me', text, ts, status, media: null, replyTo: null, edited: false, deleted: false, starred: false };
  }
  function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

  /* ---------- публичный API ---------- */
  return {
    get data() { return data; },
    WALLPAPERS,
    seedIfEmpty, save, uid, msgOut,
    colors: COLORS,

    newChat(name) {
      const c = mkChat(uid(), name, null, [], Math.random() > .5);
      data.chats.unshift(c); save(); return c;
    },
    chat(id) { return data.chats.find(c => c.id === id); },
    addMessage(chatId, m) {
      const c = this.chat(chatId); if (!c) return;
      c.messages.push(m);
      if (m.from !== 'me' && m.from !== 'self') c.lastSeen = Date.now();
      save(); return c;
    },
    updateMessage(chatId, msgId, patch) {
      const c = this.chat(chatId); if (!c) return;
      const m = c.messages.find(x => x.id === msgId);
      if (m) Object.assign(m, patch); save();
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
    setMe(name) { data.me = Object.assign({ avatar: null, bio: '' }, data.me, { name }); save(); },
    setMyAvatar(dataUrl) { if (data.me) { data.me.avatar = dataUrl; save(); } },
    setMyBio(bio) { if (data.me) { data.me.bio = bio; save(); } },
    logout() { data.me = null; save(); },

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

    togglePin(chatId) {
      const c = this.chat(chatId); if (!c) return;
      c.pinned = !c.pinned; save(); return c.pinned;
    },
    toggleMute(chatId) {
      const c = this.chat(chatId); if (!c) return;
      c.muted = !c.muted; save(); return c.muted;
    },
    toggleArchive(chatId) {
      const c = this.chat(chatId); if (!c) return;
      c.archived = !c.archived; save(); return c.archived;
    },
    toggleStar(chatId, msgId) {
      const c = this.chat(chatId); const m = c && c.messages.find(x => x.id === msgId);
      if (m) { m.starred = !m.starred; save(); }
      return m && m.starred;
    },
    setAvatar(chatId, dataUrl) { const c = this.chat(chatId); if (c) { c.avatar = dataUrl; save(); } },
    setBio(chatId, bio) { const c = this.chat(chatId); if (c) { c.bio = bio; save(); } },
    renameChat(chatId, name) { const c = this.chat(chatId); if (c) { c.name = name; save(); } },
    removeChat(chatId) {
      data.chats = data.chats.filter(c => c.id !== chatId); save();
    },
    allMessages() {
      const out = [];
      for (const c of data.chats)
        for (const m of c.messages)
          if (!m.deleted) out.push({ chat: c, msg: m });
      return out.sort((a, b) => b.msg.ts - a.msg.ts);
    },
  };
})();
