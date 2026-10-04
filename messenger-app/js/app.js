/* ============ app.js — UI controller ============ */
(() => {
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  };

  let currentChatId = null;
  let replyTo = null;      // { id, name, text }
  let editingId = null;    // message id being edited
  let lastSent = null;     // for "reply to my own" quick nav

  /* ==================== INIT ==================== */
  function init() {
    Store.seedIfEmpty();
    applyTheme(Store.data.theme);

    if (Store.data.me && Store.data.me.name) {
      showApp();
    } else {
      $('#loginScreen').classList.remove('hidden');
    }

    bindLogin();
    bindSidebar();
    bindComposer();
    bindDrawer();
    renderChatList();

    // ambient bot activity + notifications
    Bot.scheduleAmbient(
      () => currentChatId,
      (chat, msg, isOpen) => {
        renderChatList();
        if (isOpen) { renderMessages(chat); scrollBottom(true); }
        notify(chat, msg);
      }
    );

    registerSW();
  }

  /* ==================== LOGIN ==================== */
  function bindLogin() {
    const go = () => {
      const name = $('#loginName').value.trim();
      if (!name) { $('#loginName').focus(); return; }
      Store.setMe(name);
      showApp();
    };
    $('#loginBtn').addEventListener('click', go);
    $('#loginName').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  }

  function showApp() {
    $('#loginScreen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#drawerName').textContent = Store.data.me?.name || 'Гость';
    $('#drawerAvatar').textContent = firstLetter(Store.data.me?.name || 'Я');
    renderChatList();
    // open Saved messages by default on desktop
    if (window.innerWidth > 760) openChat('c_saved');
  }

  /* ==================== SIDEBAR / CHAT LIST ==================== */
  function firstLetter(name) { return (name || '?').trim().charAt(0).toUpperCase(); }

  function fmtTime(ts) {
    const d = new Date(ts), now = new Date();
    if (d.toDateString() === now.toDateString())
      return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const y = new Date(now); y.setDate(y.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'вчера';
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  }

  function previewText(m) {
    if (!m) return '';
    if (m.deleted) return 'Сообщение удалено';
    const who = m.from === 'me' ? 'Вы: ' : '';
    if (m.media && !m.text) return who + '📷 Фото';
    return who + m.text;
  }

  function renderChatList(filter = '') {
    const list = $('#chatList');
    list.innerHTML = '';
    const q = filter.toLowerCase();
    const chats = [...Store.data.chats].sort((a, b) => {
      const la = a.messages.at(-1)?.ts || 0, lb = b.messages.at(-1)?.ts || 0;
      return lb - la;
    });

    for (const c of chats) {
      if (q && !c.name.toLowerCase().includes(q)) continue;
      const last = c.messages.filter(m => !m.deleted).at(-1) || c.messages.at(-1);

      const item = el('div', 'chat-item' + (c.id === currentChatId ? ' active' : ''));
      item.dataset.id = c.id;

      const av = el('div', 'avatar' + (c.online ? ' online' : ''), escapeHtml(firstLetter(c.name)));
      av.style.background = c.color;

      const meta = el('div', 'chat-meta');
      const top = el('div', 'chat-top');
      top.appendChild(el('div', 'chat-name', escapeHtml(c.name)));
      top.appendChild(el('div', 'chat-time', last ? fmtTime(last.ts) : ''));

      const bottom = el('div', 'chat-bottom');
      bottom.appendChild(el('div', 'chat-preview', escapeHtml(previewText(last))));
      if (c.unread > 0) bottom.appendChild(el('div', 'badge', String(c.unread)));

      meta.append(top, bottom);
      item.append(av, meta);
      item.addEventListener('click', () => openChat(c.id));
      list.appendChild(item);
    }
    if (!list.children.length) {
      list.appendChild(el('div', 'chat-empty-list', '<p style="padding:20px;color:var(--text-secondary);text-align:center">Ничего не найдено</p>'));
    }
  }

  function bindSidebar() {
    $('#searchInput').addEventListener('input', e => renderChatList(e.target.value));

    $('#newChatBtn').addEventListener('click', () => {
      $('#newChatPanel').classList.toggle('hidden');
      $('#newChatInput').focus();
    });
    const create = () => {
      const name = $('#newChatInput').value.trim();
      if (!name) return;
      const c = Store.newChat(name);
      $('#newChatInput').value = '';
      $('#newChatPanel').classList.add('hidden');
      renderChatList($('#searchInput').value);
      openChat(c.id);
    };
    $('#newChatCreate').addEventListener('click', create);
    $('#newChatInput').addEventListener('keydown', e => { if (e.key === 'Enter') create(); });

    $('#backBtn').addEventListener('click', () => {
      $('#app').classList.remove('show-chat');
    });
    $('#callBtn').addEventListener('click', () => toast('📞 Звонки появятся в следующей версии!'));
    $('#infoBtn').addEventListener('click', () => {
      const c = Store.chat(currentChatId); if (!c) return;
      showCtxAt(window.innerWidth - 190, 60, [
        ['🗑 Очистить историю', () => { Store.clearChat(c.id); renderMessages(c); renderChatList(); }],
        ['🔇 Заглушить', () => toast('Уведомления отключены для «' + c.name + '»')],
      ]);
    });
  }

  /* ==================== OPEN CHAT ==================== */
  function openChat(id) {
    currentChatId = id;
    const c = Store.chat(id); if (!c) return;
    Store.markRead(id);

    $('#chatEmpty').classList.add('hidden');
    $('#chatView').classList.remove('hidden');
    $('#app').classList.add('show-chat');

    $('#peerName').textContent = c.name;
    $('#peerStatus').textContent = c.online ? 'в сети' : 'был(а) недавно';
    $('#peerStatus').classList.toggle('offline', !c.online);
    const pa = $('#peerAvatar');
    pa.textContent = firstLetter(c.name);
    pa.style.background = c.color;

    replyTo = null; editingId = null; updateReplyHint();
    renderMessages(c);
    renderChatList($('#searchInput').value);
    scrollBottom(true);
    $('#msgInput').focus();
  }

  /* ==================== MESSAGES ==================== */
  function renderMessages(c) {
    const box = $('#messages');
    box.innerHTML = '';
    let lastDate = '';

    for (const m of c.messages) {
      const day = new Date(m.ts).toDateString();
      if (day !== lastDate) {
        lastDate = day;
        const div = el('div', 'date-divider');
        div.appendChild(el('span', '', formatDateLabel(m.ts)));
        box.appendChild(div);
      }
      box.appendChild(renderBubble(c, m));
    }
  }

  function formatDateLabel(ts) {
    const d = new Date(ts), now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Сегодня';
    const y = new Date(now); y.setDate(y.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Вчера';
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  }

  function ticks(status) {
    if (status === 'read') return '<i class="bi bi-check-all"></i>';
    if (status === 'delivered') return '<i class="bi bi-check-all"></i>';
    return '<i class="bi bi-check"></i>';
  }

  function renderBubble(c, m) {
    const row = el('div', 'msg-row ' + (m.from === 'me' || m.from === 'self' ? 'out' : 'in'));
    row.dataset.mid = m.id;
    const b = el('div', 'bubble' + (m.deleted ? ' deleted' : ''));

    if (m.replyTo) {
      const r = el('div', 'reply-ref', `<b>${escapeHtml(m.replyTo.name)}</b>${escapeHtml(trunc(m.replyTo.text, 60))}`);
      b.appendChild(r);
    }
    if (m.media) {
      const img = el('img', 'media');
      img.src = m.media; img.alt = 'фото';
      img.addEventListener('click', () => lightbox(m.media));
      b.appendChild(img);
    }
    if (m.deleted) {
      b.appendChild(document.createTextNode('🚫 Сообщение удалено'));
    } else if (m.text) {
      b.appendChild(el('span', 'text', linkify(escapeHtml(m.text)).replace(/\n/g, '<br>')));
    }

    const meta = el('div', 'meta');
    meta.innerHTML = `${m.edited ? '<span class="edited">изменено</span>' : ''}
      <span>${new Date(m.ts).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</span>
      ${m.from === 'me' ? `<span class="ticks">${ticks(m.status)}</span>` : ''}`;
    b.appendChild(meta);

    if (!m.deleted && m.from !== 'self') {
      const acts = el('div', 'actions');
      if (m.from === 'me') {
        acts.appendChild(iconAct('✏️', 'Изменить', () => startEdit(m)));
      }
      acts.appendChild(iconAct('↩️', 'Ответить', () => setReply(m, c)));
      acts.appendChild(iconAct('🗑', 'Удалить', () => {
        Store.deleteMessage(c.id, m.id); renderMessages(c); renderChatList($('#searchInput').value);
      }));
      b.appendChild(acts);
    }

    row.appendChild(b);
    return row;
  }

  function iconAct(txt, title, fn) {
    const btn = el('button', '', txt); btn.title = title;
    btn.addEventListener('click', e => { e.stopPropagation(); fn(); });
    return btn;
  }

  const trunc = (s, n) => s.length > n ? s.slice(0, n) + '…' : s;
  function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }
  function linkify(s) {
    return s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" style="color:var(--tg-blue)">$1</a>');
  }

  function scrollBottom(force) {
    const box = $('#messages');
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 150;
    if (force || nearBottom) box.scrollTo({ top: box.scrollHeight, behavior: force ? 'auto' : 'smooth' });
  }

  /* ==================== COMPOSER ==================== */
  function bindComposer() {
    const input = $('#msgInput');

    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 140) + 'px';
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });

    $('#sendBtn').addEventListener('click', send);
    $('#attachBtn').addEventListener('click', () => $('#fileInput').click());
    $('#fileInput').addEventListener('change', onPickImage);

    $('#emojiBtn').addEventListener('click', toggleEmoji);
    $('#messages').addEventListener('scroll', () => {
      const box = $('#messages');
      $('#scrollBottomBtn').classList.toggle('hidden',
        box.scrollHeight - box.scrollTop - box.clientHeight < 120);
    });
    $('#scrollBottomBtn').addEventListener('click', () => scrollBottom(true));

    buildEmojiPanel();
  }

  function send() {
    const input = $('#msgInput');
    const text = input.value.trim();
    if (!text && !pendingMedia) return;
    if (!currentChatId) return;

    const c = Store.chat(currentChatId);

    if (editingId) { // EDIT mode
      Store.updateMessage(c.id, editingId, { text, edited: true });
      editingId = null; pendingMedia = null;
      $('#sendBtn').classList.remove('edit-mode');
      input.value = ''; autoResize(input); updateReplyHint();
      renderMessages(c); renderChatList($('#searchInput').value); scrollBottom(true);
      return;
    }

    const m = {
      id: Store.uid(), from: 'me', text, ts: Date.now(),
      status: 'sent', media: pendingMedia, replyTo, edited: false, deleted: false,
    };
    Store.addMessage(c.id, m);
    pendingMedia = null; replyTo = null;
    input.value = ''; autoResize(input); updateReplyHint();

    renderMessages(c); renderChatList($('#searchInput').value); scrollBottom(true);

    // simulate delivery -> read -> typing -> answer (except Saved)
    if (c.id !== 'c_saved') {
      setTimeout(() => { Store.updateMessage(c.id, m.id, { status: 'delivered' }); refreshTick(m.id); }, 500);
      setTimeout(() => { Store.updateMessage(c.id, m.id, { status: 'read' }); refreshTick(m.id); }, 1300);

      Bot.respond(c.id, text, {
        onTyping: () => showTyping(true),
        onStopTyping: () => showTyping(false),
        onMessage: (ans) => {
          if (currentChatId === c.id) {
            Store.addMessage(c.id, ans);
            renderMessages(c); scrollBottom();
          } else {
            Store.addMessage(c.id, ans);
            c.unread = (c.unread || 0) + 1; Store.save();
          }
          renderChatList($('#searchInput').value);
          notify(c, ans, currentChatId === c.id);
        },
      });
    }
  }

  function refreshTick(mid) {
    const node = document.querySelector(`.msg-row[data-mid="${mid}"] .ticks`);
    const m = findMsg(mid);
    if (node && m) node.innerHTML = ticks(m.status);
  }
  function findMsg(mid) {
    const c = Store.chat(currentChatId);
    return c && c.messages.find(x => x.id === mid);
  }

  function showTyping(on) {
    let t = $('#typingRow');
    if (on) {
      if (t) return;
      t = el('div', 'msg-row in typing-row'); t.id = 'typingRow';
      t.innerHTML = '<div class="typing-dots"><i></i><i></i><i></i></div>';
      $('#messages').appendChild(t); scrollBottom();
    } else if (t) t.remove();
  }

  function autoResize(input) { input.style.height = 'auto'; }

  /* ---------- reply / edit ---------- */
  function setReply(m, c) {
    replyTo = { id: m.id, name: m.from === 'me' ? 'Вы' : c.name, text: m.text || '📷 Фото' };
    updateReplyHint(); $('#msgInput').focus();
  }
  function startEdit(m) {
    editingId = m.id; replyTo = null;
    $('#msgInput').value = m.text;
    $('#sendBtn').classList.add('edit-mode');
    $('#sendBtn').innerHTML = '<i class="bi bi-check-lg"></i>';
    updateReplyHint('✏️ Редактирование сообщения');
    $('#msgInput').focus();
  }
  function updateReplyHint(custom) {
    let hint = document.getElementById('replyHint');
    if (custom || replyTo || editingId) {
      if (!hint) {
        hint = el('div', 'reply-ref'); hint.id = 'replyHint';
        hint.style.cssText = 'margin:0 56px 2px;background:var(--bg);border-radius:10px 10px 0 0;border-left-width:4px;padding:6px 12px;display:flex;justify-content:space-between;align-items:center;box-shadow:var(--shadow);';
        document.querySelector('.composer').before(hint);
      }
      const label = custom || `Ответ: ${replyTo.name} — ${trunc(replyTo.text, 50)}`;
      hint.innerHTML = `<div><b>${editingId ? 'Редактирование' : 'Ответ'}</b> ${escapeHtml(label.replace(/^(Ответ|✏️)\s*[:—]?\s*/,''))}</div>`;
      const x = el('button', '', '✕');
      x.style.cssText = 'border:none;background:none;cursor:pointer;font-size:16px;color:var(--text-secondary)';
      x.onclick = () => { replyTo = null; cancelEdit(); updateReplyHint(); };
      hint.appendChild(x);
      hint.classList.remove('hidden');
    } else if (hint) hint.classList.add('hidden');
  }
  function cancelEdit() {
    editingId = null;
    $('#sendBtn').classList.remove('edit-mode');
    $('#sendBtn').innerHTML = '<i class="bi bi-send-fill"></i>';
    $('#msgInput').value = '';
  }

  /* ---------- attachments ---------- */
  let pendingMedia = null;
  function onPickImage(e) {
    const f = e.target.files[0]; if (!f || !currentChatId) return;
    const reader = new FileReader();
    reader.onload = () => {
      // downscale to keep localStorage small
      const img = new Image();
      img.onload = () => {
        const max = 800;
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = img.width * k; cv.height = img.height * k;
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        pendingMedia = cv.toDataURL('image/jpeg', 0.75);
        send(); // auto-send photo
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
    e.target.value = '';
  }

  /* ---------- emoji ---------- */
  const EMOJIS = ['😀','😂','🥹','😍','😎','🤔','😅','🙃','😉','😊','😇','🥳','😢','😡','🤯','😴','👍','👎','👏','🙏','💪','🔥','✨','🎉','❤️','💔','💯','☕','🍕','🎮','⚽','🚀','🌧','☀️','🌙','⭐','🎵','📷','💡','✅'];
  function buildEmojiPanel() {
    const p = $('#emojiPanel');
    p.innerHTML = '';
    for (const e of EMOJIS) {
      const b = el('button', '', e);
      b.addEventListener('click', () => {
        const i = $('#msgInput'); i.value += e; i.focus();
      });
      p.appendChild(b);
    }
  }
  function toggleEmoji() { $('#emojiPanel').classList.toggle('hidden'); }

  /* ==================== DRAWER ==================== */
  function bindDrawer() {
    $('#menuBtn').addEventListener('click', e => {
      e.stopPropagation();
      $('#drawer').classList.toggle('hidden');
    });
    document.addEventListener('click', e => {
      const d = $('#drawer');
      if (!d.classList.contains('hidden') && !d.contains(e.target)) d.classList.add('hidden');
      const cm = document.querySelector('.ctx-menu');
      if (cm && !cm.contains(e.target)) cm.remove();
    });

    document.querySelectorAll('.drawer-item').forEach(item => {
      item.addEventListener('click', () => {
        const a = item.dataset.action;
        if (a === 'toggle-theme') {
          const t = Store.data.theme === 'dark' ? 'light' : 'dark';
          Store.setTheme(t); applyTheme(t);
        }
        if (a === 'toggle-notif') {
          const v = !Store.data.notif;
          Store.setNotif(v);
          $('#notifState').textContent = v ? 'вкл' : 'выкл';
          if (v && 'Notification' in window) Notification.requestPermission();
        }
        if (a === 'clear-all') {
          Store.clearAll(); renderChatList(); if (currentChatId) renderMessages(Store.chat(currentChatId));
          toast('Все чаты очищены');
        }
        if (a === 'logout') {
          Store.logout(); location.reload();
        }
        $('#drawer').classList.add('hidden');
      });
    });
    $('#notifState').textContent = Store.data.notif ? 'вкл' : 'выкл';
  }

  function applyTheme(t) {
    document.body.classList.toggle('dark', t === 'dark');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = t === 'dark' ? '#181818' : '#0088cc';
  }

  /* ==================== NOTIFICATIONS ==================== */
  function notify(chat, msg, isOpen) {
    if (!Store.data.notif) return;
    if (isOpen) return;
    if (msg.from === 'me' || msg.from === 'self') return;
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(chat.name, { body: msg.text || '📷 Фото', icon: 'icons/icon-192.png' });
      } catch (e) {}
    }
  }

  /* ==================== HELPERS ==================== */
  let toastTimer;
  function toast(text) {
    const t = $('#toast'); t.textContent = text; t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
  }

  function lightbox(src) {
    const lb = el('div', 'lightbox');
    const img = el('img'); img.src = src;
    lb.appendChild(img);
    lb.addEventListener('click', () => lb.remove());
    document.body.appendChild(lb);
  }

  function showCtxAt(x, y, items) {
    document.querySelector('.ctx-menu')?.remove();
    const menu = el('div', 'ctx-menu');
    menu.style.left = x + 'px'; menu.style.top = y + 'px';
    for (const [label, fn] of items) {
      const it = el('div', '', label);
      it.addEventListener('click', () => { menu.remove(); fn(); });
      menu.appendChild(it);
    }
    document.body.appendChild(menu);
  }

  function registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
