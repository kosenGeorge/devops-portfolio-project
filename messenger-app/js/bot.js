/* ============ bot.js — «собеседник»: имитация ответов ============ */
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
  const thanks   = ['Всегда пожалуйста! 😊', 'Обращайся 😉', 'Не за что!'];

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function generateReply(text) {
    const t = (text || '').toLowerCase().trim();
    if (/^(привет|здаров|хай|hello|hi|добрый)/.test(t)) return pick(greetings);
    if (/спасиб|благодар/.test(t)) return pick(thanks);
    if (/\?$/.test((text || '').trim())) return pick(questions);
    if (/фото|картинк|скинь/.test(t)) return 'Уже смотрю! 📸';
    return pick(replies);
  }

  /**
   * Имитирует живой ответ: "печатает…" -> сообщение.
   * @param {string} chatId
   * @param {string} userText
   * @param {object} ui - callbacks: onTyping(), onStopTyping(), onMessage(msg)
   */
  function respond(chatId, userText, ui) {
    const thinkMs = 500 + Math.random() * 900;
    const answer = generateReply(userText);
    const typeMs = Math.min(2600, 700 + answer.length * 45);

    setTimeout(() => {
      ui.onTyping && ui.onTyping();
      setTimeout(() => {
        ui.onStopTyping && ui.onStopTyping();
        const msg = {
          id: Store.uid(), from: 'peer', text: answer, ts: Date.now(),
          status: 'read', media: null, replyTo: null, edited: false, deleted: false,
        };
        ui.onMessage && ui.onMessage(msg);
      }, typeMs);
    }, thinkMs);
  }

  /** Случайная фоновая активность: иногда кто-то пишет сам. */
  function scheduleAmbient(getActiveChatId, onIncoming) {
    setInterval(() => {
      if (Math.random() > 0.18) return; // редкие фоновые сообщения
      const chats = Store.data.chats.filter(c => c.id !== 'c_saved');
      if (!chats.length) return;
      const c = chats[Math.floor(Math.random() * chats.length)];
      const msg = {
        id: Store.uid(), from: 'peer', text: pick([].concat(replies, greetings)),
        ts: Date.now(), status: 'read', media: null, replyTo: null, edited: false, deleted: false,
      };
      Store.addMessage(c.id, msg);
      if (c.id !== getActiveChatId()) { c.unread = (c.unread || 0) + 1; Store.save(); }
      onIncoming(c, msg, c.id === getActiveChatId());
    }, 25000);
  }

  return { respond, scheduleAmbient, generateReply };
})();
