/* ============ bot.js — «собеседник»: имитация ответов + команды ============ */
const Bot = (() => {

  const replies = [
    'Звучит отлично! 👍', 'Ага, понял тебя', 'Интересно, расскажи подробнее 🤔',
    'Ха-ха, точно 😄', 'Согласен на все 100%', 'Ок, договорились!',
    'Я как раз об этом думал', 'Круто! 🚀', 'Хм, надо подумать…',
    'Супер, спасибо!', 'Без проблем 🙂', 'Давай позже обсудим?',
    'Ты всегда так быстро отвечаешь? ⚡', 'Получил ✅',
  ];

  const greetings = ['Привет! 👋', 'Здравствуй!', 'Хэй! Как ты?', 'На связи 🙂'];
  const questions = ['Хороший вопрос! Дай подумать… 🤔', 'Думаю, да!', 'Скорее нет, но интересно почему ты спрашиваешь?', 'Давай проверим вместе!'];
  const thanks = ['Всегда пожалуйста! 😊', 'Обращайся 😉', 'Не за что!'];

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function generateReply(text) {
    const t = (text || '').toLowerCase().trim();
    if (/^(привет|здаров|хай|hello|hi|добрый)/.test(t)) return pick(greetings);
    if (/спасиб|благодар/.test(t)) return pick(thanks);
    if (/\?$/.test((text || '').trim())) return pick(questions);
    if (/фото|картинк|скинь/.test(t)) return 'Уже смотрю! 📸';
    return pick(replies);
  }

  /* ---------- команды бота Dave ---------- */
  function runCommand(rawText) {
    const t = (rawText || '').trim();
    const low = t.toLowerCase();
    const arg = t.slice(t.indexOf(' ') + 1).trim();

    if (low === '/help' || low === '/старт')
      return '🤖 Я умею:\n/help — этот список\n/echo <текст> — повторить текст\n/time — текущее время\n/date — сегодняшняя дата\n/dice — бросить кубик 🎲\n/roll <N> — случайное число 1…N\n/calc <выражение> — посчитать, напр. /calc 2+2*3\n/weather — демо-погода\n/joke — шутку 😄';
    if (low.startsWith('/echo')) return arg || '…пусто';
    if (low === '/time') return '🕹 Сейчас: ' + new Date().toLocaleTimeString('ru-RU');
    if (low === '/date') return '📅 ' + new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (low === '/dice') { const n = 1 + Math.floor(Math.random() * 6); return '🎲 Выпало: ' + n; }
    if (low.startsWith('/roll')) {
      const n = parseInt(arg, 10);
      if (!n || n < 1 || n > 1e6) return 'Скажи, например: /roll 100';
      return '🎯 ' + (1 + Math.floor(Math.random() * n));
    }
    if (low.startsWith('/calc')) {
      const expr = (arg || '').replace(/[^0-9+\-*/().,%\s]/g, '');
      if (!expr) return 'Пример: /calc (2+2)*5';
      try {
        const val = Function('"use strict"; return (' + expr.replace(/,/g, '.') + ')')();
        if (typeof val !== 'number' || !isFinite(val)) throw 0;
        return '🧮 ' + expr.trim() + ' = ' + Math.round(val * 1e6) / 1e6;
      } catch (e) { return '⚠️ Не могу это посчитать'; }
    }
    if (low === '/weather')
      return '🌤 Демо-погода: Москва, +18°C, ясно, ветер 3 м/с (это просто имитация 🙂)';
    if (low === '/joke')
      return pick([
        '— Как дела?\n— Тестовое сообщение, ничего личного 😄',
        'Программист заходит в лифт, а там кнопки 0 и 1.',
        'Захожу в комнату, а там ремонт. Ну всё, зашёл и вышел.',
        'Чат без ботов — как деплой без отката.',
      ]);
    if (low.startsWith('/')) return 'Неизвестная команда. Напиши /help';
    return null;
  }

  /** Живой статус собеседника: после ответа ещё «в сети», потом уходит. */
  function keepOnline(chatId, ui, ms) {
    setTimeout(() => {
      Store.setStatus(chatId, { online: false, lastSeen: Date.now() });
      ui.onStopTyping && ui.onStopTyping();
    }, ms);
  }

  /**
   * Имитирует живой ответ: "печатает…" -> сообщение.
   * Команды вида /xxx выполняются мгновенно (без «печатает»).
   */
  function respond(chatId, userText, ui) {
    const cmdReply = /^\//.test((userText || '').trim()) ? runCommand(userText) : null;
    const answer = cmdReply !== null ? cmdReply : generateReply(userText);
    const typeMs = Math.min(2600, 700 + answer.length * 45);

    const emit = () => {
      const msg = {
        id: Store.uid(), from: 'peer', text: answer, ts: Date.now(),
        status: 'read', media: null, replyTo: null, edited: false, deleted: false, starred: false,
      };
      Store.setStatus(chatId, { online: true, lastSeen: Date.now() });
      ui.onMessage && ui.onMessage(msg);
      keepOnline(chatId, ui, 40000 + Math.random() * 60000); // 40–100 сек ещё «в сети»
    };

    if (cmdReply !== null) { setTimeout(emit, 250 + Math.random() * 350); return; }

    const thinkMs = 500 + Math.random() * 900;
    setTimeout(() => {
      Store.setStatus(chatId, { online: true });
      ui.onTyping && ui.onTyping();
      setTimeout(() => {
        ui.onStopTyping && ui.onStopTyping();
        emit();
      }, typeMs);
    }, thinkMs);
  }

  /** Случайная фоновая активность: иногда кто-то пишет сам. */
  function scheduleAmbient(getActiveChatId, onIncoming) {
    setInterval(() => {
      if (Math.random() > 0.18) return; // редкие фоновые сообщения
      const chats = Store.data.chats.filter(c => c.id !== 'c_saved' && !c.archived);
      if (!chats.length) return;
      const c = chats[Math.floor(Math.random() * chats.length)];
      const msg = {
        id: Store.uid(), from: 'peer', text: pick([].concat(replies, greetings)),
        ts: Date.now(), status: 'read', media: null, replyTo: null, edited: false, deleted: false, starred: false,
      };
      Store.setStatus(c.id, { online: true, lastSeen: Date.now() });
      Store.addMessage(c.id, msg);
      if (c.id !== getActiveChatId()) { c.unread = (c.unread || 0) + 1; Store.save(); }
      onIncoming(c, msg, c.id === getActiveChatId());
      keepOnline(c.id, {}, 60000 + Math.random() * 60000);
    }, 25000);
  }

  return { respond, scheduleAmbient, generateReply, runCommand };
})();
