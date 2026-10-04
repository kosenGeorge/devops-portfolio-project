/* ============ store.js — persistence layer (localStorage) ============ */
const Store = (() => {
  const KEY = 'teleport_data_v1';

  const defaultData = () => ({
    me: null,               // { name }
    theme: 'light',
    notif: true,
    chats: [],              // { id, name, color, online, unread, messages: [] }
  });

  let data = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { console.warn('load failed', e); }
    return defaultData();
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); }
    catch (e) { toastSaveError(e); }
  }

  function toastSaveError(e) {
    // images can exceed quota; drop oldest media and retry once
    console.warn('save failed', e);
  }

  /* ---------- seed demo chats on first run ---------- */
  function seedIfEmpty() {
    if (data.chats.length) return;
    const now = Date.now();
    data.chats = [
      mkChat('c_saved', '🔖 Избранное', '#3390ec', [
        msgIn('self', 'Сохранённые сообщения — здесь ваш личный блокнот.', now - 86400000),
      ]),
      mkChat('c_alice', 'Алиса', '#e17076', [
        msgIn('peer', 'Привет! Как дела? 👋', now - 7200000),
        msgOut('me', 'Привет! Всё отлично, тестирую новый мессенджер 🚀', now - 7100000, 'read'),
        msgIn('peer', 'Выглядит как Telegram! Круто 😄', now - 7000000),
      ], true),
      mkChat('c_bob', 'Боб', '#7bc862', [
        msgIn('peer', 'Скинь фотку вчерашней прогулки', now - 3 * 86400000),
      ]),
      mkChat('c_team', 'Команда разработки', '#a284e2', [
        msgIn('peer', 'Деплой в 18:00, все на месте?', now - 5 * 3600000),
        msgIn('peer', 'Я буду ✅', now - 4.8 * 3600000),
      ], false, 2),
    ];
    save();
  }

  const COLORS = ['#3390ec','#e17076','#7bc862','#a284e2','#eec643','#6ac9ce','#d885f4'];

  function mkChat(id, name, color, messages = [], online = false, unread = 0) {
    return { id, name, color: color || COLORS[Math.floor(Math.random()*COLORS.length)],
             online, unread, messages };
  }
  function msgIn(from, text, ts, status='read') {
    return { id: uid(), from, text, ts, status, media: null, replyTo: null, edited: false, deleted: false };
  }
  function msgOut(text, ts, status='sent') {
    return { id: uid(), from: 'me', text, ts, status, media: null, replyTo: null, edited: false, deleted: false };
  }
  function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

  /* ---------- public API ---------- */
  return {
    get data() { return data; },
    seedIfEmpty, save,
    colors: COLORS,
    uid,
    newChat(name) {
      const c = mkChat(uid(), name, null, [], Math.random() > .5);
      data.chats.unshift(c); save(); return c;
    },
    chat(id) { return data.chats.find(c => c.id === id); },
    addMessage(chatId, m) {
      const c = this.chat(chatId); if (!c) return;
      c.messages.push(m); save(); return c;
    },
    updateMessage(chatId, msgId, patch) {
      const c = this.chat(chatId); if (!c) return;
      const m = c.messages.find(x => x.id === msgId);
      if (m) Object.assign(m, patch); save();
    },
    deleteMessage(chatId, msgId) { this.updateMessage(chatId, msgId, { deleted: true, text: '', media: null }); },
    clearChat(chatId) { const c = this.chat(chatId); if (c) { c.messages = []; save(); } },
    clearAll() { data.chats.forEach(c => c.messages = []); save(); },
    markRead(chatId) { const c = this.chat(chatId); if (c) { c.unread = 0; save(); } },
    setTheme(t) { data.theme = t; save(); },
    setNotif(v) { data.notif = v; save(); },
    setMe(name) { data.me = { name }; save(); },
    logout() { data.me = null; save(); },
  };
})();
