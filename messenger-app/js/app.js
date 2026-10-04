/* ============ app.js — контроллер интерфейса Teleport PRO ============
   Никаких ботов: всё общение — только с реальными людьми через сервер. */
(() => {
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  };
  const esc = U.esc;

  let currentChatId = null;
  let prevChatId = null;
  let replyTo = null;       // { id, name, text }
  let editingId = null;
  let pendingMedia = null;  // dataURL фото (локально)
  let pendingUrl = null;    // URL на сервере
  let showArchived = false;
  let unreadBelow = 0;
  let searchHits = [];
  let searchIdx = -1;
  let liveTypingWho = null;
  let livePeers = [];       // [{name,id}] кто в сети в текущей комнате
  let typingThrottle = 0;
  let authPhone = '';

  const isLiveRoom = (id) => !!Net.live && (id === 'room_global' || String(id).startsWith('dm:'));

  /* ==================== INIT ==================== */
  function init() {
    Store.seedIfEmpty();
    if (Store.data.palette && Store.data.palette !== 'blue')
      document.documentElement.setAttribute('data-pal', Store.data.palette);
    applyTheme(Store.data.theme);
    applyFont(Store.data.fontScale);
    applyWallpaper(Store.data.wallpaper);
    if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (Store.data.theme === 'auto') applyTheme('auto');
    });

    bindLogin();
    bindSidebar();
    bindComposer();
    bindDrawer();
    bindModals();
    bindMsgSearch();
    bindGlobalKeys();
    bindResize();
    bindCallsUI();
    bindRipple();
    renderChatList();

    Net.handlers.onConn = (on) => { updateLiveBadge(on); if (currentChatId) refreshHeader(); };
    Net.handlers.onAuth = (user) => {
      if (!user) { toast('Сессия истекла — войдите заново'); Store.logout(); location.reload(); return; }
      Store.setMe({ id: user.id, name: user.name, username: user.username, avatar: user.avatar, bio: user.bio });
      $('#drawerName').textContent = user.name;
      $('#drawerUsername').textContent = user.username || '';
      applyMeAvatar();
      updateLiveBadge(Net.connected);
    };
    Net.handlers.onSync = (chats) => mergeServerChats(chats);
    Net.handlers.onMessage = onNetMessage;
    Net.handlers.onEdit = (d) => {
      const c = Store.chat(d.chatId); if (!c) return;
      Store.updateMessage(c.id, d.mid, { text: d.text, edited: true });
      if (currentChatId === c.id) renderMessages(c);
    };
    Net.handlers.onDelete = (d) => {
      const c = Store.chat(d.chatId); if (!c) return;
      Store.deleteMessage(c.id, d.mid);
      if (currentChatId === c.id) renderMessages(c);
    };
    Net.handlers.onTyping = (on, who) => {
      liveTypingWho = on ? who : null;
      if (currentChatId && isLiveRoom(currentChatId)) refreshHeader();
    };
    Net.handlers.onRead = () => {
      const c = Store.chat(currentChatId); if (!c) return;
      for (const m of c.messages) if (m.from === 'me' && m.status !== 'read') m.status = 'read';
      Store.save(); renderMessages(c);
    };
    Net.handlers.onPeers = (list) => {
      livePeers = list || [];
      if (currentChatId) {
        const cid = currentChatId;
        Store.setStatus(cid, { online: livePeers.length > 0, lastSeen: Date.now() });
        refreshHeader();
      }
    };
    Net.handlers.onContactAdded = ({ from, chatId }) => {
      if (!from || !chatId) return;
      if (!Store.chat(chatId)) {
        const c = Store.newChat(from.name, { id: chatId, kind: 'dm', peerId: from.id, avatar: from.avatar });
        c.bio = from.bio || '';
        renderChatList($('#searchInput').value);
        toast(`💌 ${from.name} хочет общаться с вами!`);
        playPing();
      }
      Store.addContact(from, chatId);
    };

    Calls.init(callUICallbacks);
    Net.handlers.onCallIncoming = ({ from }) => Calls.onIncoming(from);
    Net.handlers.onCallAccepted = ({ from }) => { toast(`${from && from.name} принял звонок`); };
    Net.handlers.onCallDeclined = ({ from }) => { toast(`${from && from.name}: звонок отклонён`); Calls.declineRemote(); };
    Net.handlers.onCallEnded = () => Calls.endRemote();
    Net.handlers.onSignal = ({ from, kind, data }) => Calls.handleSignal(from, kind, data);

    registerSW();
    updateDrawerCounts();
    handleHashRoute();
    window.addEventListener('hashchange', handleHashRoute);

    // уже авторизованы?
    if (Net.live) {
      enterApp();
      Net.connect();
      Net.Auth.me().then(r => { if (r && r.ok && r.user) Net.handlers.onAuth(r.user); else if (r && !r.ok) {/* токен протух — ws сам сбросит */} });
    } else {
      // OAuth-редирект: сервер вернул /#token=...
      const h = location.hash || '';
      if (h.startsWith('#token=')) {
        Net.Auth.setToken(h.slice(7));
        history.replaceState(null, '', location.pathname);
        enterApp(); Net.connect();
      } else {
        $('#loginScreen').classList.remove('hidden');
      }
    }
  }

  function enterApp() {
    $('#loginScreen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    if (Store.data.me && Store.data.me.name) $('#drawerName').textContent = Store.data.me.name;
    $('#drawerUsername').textContent = (Store.data.me && Store.data.me.username) || '';
    applyMeAvatar();
    renderChatList();
    updateLiveBadge(Net.connected);
    if (window.matchMedia('(display-mode: standalone)').matches) navigator.setAppBadge?.(totalUnread()).catch(() => {});
  }

  function totalUnread() { return Store.data.chats.reduce((s, c) => s + (c.unread || 0), 0); }

  function applyMeAvatar() {
    const me = Store.data.me || {};
    const dAv = $('#drawerAvatar');
    if (me.avatar) { dAv.style.backgroundImage = `url(${me.avatar})`; dAv.classList.add('avatar-img'); dAv.textContent = ''; }
    else { dAv.style.backgroundImage = ''; dAv.classList.remove('avatar-img'); dAv.textContent = U.firstLetter(me.name || 'Я'); }
  }

  function handleHashRoute() {
    const h = location.hash.replace(/^#/, '');
    if (h.startsWith('token=')) return; // обрабатывается в init
    if (h === 'saved') { setTimeout(() => showStarred(), 200); history.replaceState(null, '', location.pathname + location.search); }
    else if (h.startsWith('c_') || h.startsWith('dm:') || h === 'room_global') { setTimeout(() => openChat(h), 150); history.replaceState(null, '', location.pathname + location.search); }
  }

  /* ==================== LOGIN / REGISTRATION ==================== */
  function authError(msg) {
    const box = $('#authError');
    if (!msg) { box.classList.add('hidden'); return; }
    box.textContent = msg; box.classList.remove('hidden');
    box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
  }
  function showForm(which) {
    ['authMethods', 'emailForm', 'emailLoginForm', 'phoneForm', 'codeForm'].forEach(id => $('#' + id).classList.add('hidden'));
    $('#' + which).classList.remove('hidden');
    authError('');
  }
  function bindLogin() {
    $('#btnEmailTab').onclick = () => showForm('emailForm');
    $('#btnPhoneTab').onclick = () => showForm('phoneForm');
    $('#toLoginEmail').onclick = () => showForm('emailLoginForm');
    $('#toSignupEmail').onclick = () => showForm('emailForm');
    $('#toPhoneCancel').onclick = () => showForm('authMethods');

    $('#btnVK').onclick = () => oauthFlow('vk');
    $('#btnYandex').onclick = () => oauthFlow('yandex');

    $('#btnSignup').onclick = async () => {
      const b = {
        name: $('#regName').value.trim(), username: $('#regUser').value.trim(),
        email: $('#regEmail').value.trim(), password: $('#regPass').value,
      };
      if (!b.name) return authError('Укажите имя');
      if (!b.email) return authError('Укажите почту');
      authBtnBusy($('#btnSignup'), async () => {
        const r = await Net.Auth.signupEmail(b);
        if (r.ok) afterAuth(r); else authError(r.error || 'Ошибка регистрации');
      });
    };
    $('#btnLoginEmail').onclick = async () => {
      authBtnBusy($('#btnLoginEmail'), async () => {
        const r = await Net.Auth.loginEmail($('#logEmail').value.trim(), $('#logPass').value);
        if (r.ok) afterAuth(r); else authError(r.error || 'Ошибка входа');
      });
    };

    $('#btnSendCode').onclick = async () => {
      const ph = $('#regPhone').value;
      authBtnBusy($('#btnSendCode'), async () => {
        const r = await Net.Auth.codePhone(ph);
        if (!r.ok) return authError(r.error || 'Сервер недоступен');
        authPhone = ph;
        $('#codePhoneLabel').textContent = formatPhone(ph);
        showForm('codeForm');
        if (r.demo_code) { $('#regCode').value = r.demo_code; authError('SMS-шлюз не подключён — код показан автоматически (демо-режим)'); }
      });
    };
    $('#resendCode').onclick = () => $('#btnSendCode').click();
    $('#btnCheckCode').onclick = async () => {
      authBtnBusy($('#btnCheckCode'), async () => {
        const r = await Net.Auth.loginPhone(authPhone, $('#regCode').value, $('#regNamePh').value.trim());
        if (r.ok) afterAuth(r); else authError(r.error || 'Ошибка подтверждения');
      });
    };

    installPrompt();
  }
  function formatPhone(p) { const d = String(p).replace(/\D/g, '').slice(-10); return '+7 ' + d.replace(/(\d{3})(\d{3})(\d{2})(\d{2})/, '($1) $2-$3-$4'); }
  function authBtnBusy(btn, fn) { btn.disabled = true; btn.classList.add('busy'); fn().finally(() => { btn.disabled = false; btn.classList.remove('busy'); }); }

  async function oauthFlow(prov) {
    const r = await Net.Auth.oauthLink(prov);
    if (r.ok && r.url) { location.href = r.url; return; }
    if (r.ok && r.demo && r.token) { afterAuth(r); return; }
    authError(r.error || 'Сервер недоступен');
  }
  function afterAuth(r) {
    Net.Auth.setToken(r.token);
    Store.setMe(Object.assign({}, r.user));
    enterApp();
    Net.connect();
    toast(`Добро пожаловать, ${r.user.name}! 🎉`);
  }

  /* ==================== LIVE MESSAGING ==================== */
  function dmChatId(peerUserId) { return 'dm:' + [Store.data.me.id, peerUserId].sort().join('|'); }

  function onNetMessage(d) {
    if (!d || !d.chatId) return;
    let c = Store.chat(d.chatId);
    if (!c) {
      // прилетело в неизвестную комнату (вас добавили) — создаём
      const name = d.chatId === 'room_global' ? '🌍 Общий чат' : (d.from || 'Новый чат');
      c = Store.newChat(name, { id: d.chatId, kind: d.chatId === 'room_global' ? 'global' : 'dm', peerId: d.fromId });
    }
    const mine = d.fromId && Store.data.me && d.fromId === Store.data.me.id;
    const m = {
      id: d.mid, from: mine ? 'me' : 'peer', senderName: d.from, text: d.text || '',
      ts: d.ts || Date.now(), status: mine ? 'read' : null,
      media: null, mediaUrl: d.mediaUrl || null,
      fileUrl: d.fileUrl || null, fileName: d.fileName || null,
      audioUrl: d.audioUrl || null, audioDur: d.audioDur || null, geo: d.geo || null,
      circleUrl: d.circleUrl || null, poster: d.poster || null, dur: d.dur || null,
      replyTo: d.replyTo || null, forwardedFrom: d.fwdFrom || null,
      edited: !!d.edited, deleted: !!d.deleted, starred: false,
    };
    const isOpen = currentChatId === c.id && document.visibilityState === 'visible';
    Store.addMessage(c.id, m);
    if (!isOpen && !mine) { c.unread = (c.unread || 0) + 1; Store.save(); }
    if (currentChatId === c.id) {
      renderMessages(c);
      if (isOpen) { scrollBottom(false); if (!mine) Net.markRead(c.id); }
      else { unreadBelow++; updateScrollBadge(); }
    }
    renderChatList($('#searchInput').value);
    updateDrawerCounts();
    if (!mine && !isOpen) { if (!c.muted) playPing(); notify(c, m); }
  }

  function mergeServerChats(chats) {
    if (!Array.isArray(chats)) return;
    for (const sc of chats) {
      let c = Store.chat(sc.chatId);
      if (!c) {
        const name = sc.chatId === 'room_global' ? '🌍 Общий чат' : 'Новый чат';
        c = Store.newChat(name, { id: sc.chatId, kind: sc.chatId === 'room_global' ? 'global' : 'dm' });
      }
      for (const sm of sc.messages || []) {
        if (c.messages.some(x => x.id === sm.mid)) continue;
        const mine = Store.data.me && sm.senderId === Store.data.me.id;
        c.messages.push({
          id: sm.mid, from: mine ? 'me' : 'peer', senderName: undefined, text: sm.text || '',
          ts: sm.ts, status: mine ? 'read' : null, media: null, mediaUrl: sm.mediaUrl || null,
          fileUrl: sm.fileUrl || null, fileName: sm.fileName || null,
          audioUrl: sm.audioUrl || null, audioDur: sm.audioDur || null, geo: sm.geo || null,
          circleUrl: sm.circleUrl || null, poster: sm.poster || null, dur: sm.dur || null,
          replyTo: sm.replyTo, forwardedFrom: sm.fwdFrom, edited: !!sm.edited, deleted: !!sm.deleted, starred: false,
        });
      }
      c.messages.sort((a, b) => a.ts - b.ts);
    }
    Store.save();
    renderChatList($('#searchInput').value);
    if (currentChatId) { const cur = Store.chat(currentChatId); if (cur) renderMessages(cur); }
  }

  function liveSend(c, m) {
    return Net.sendMessage({
      chatId: c.id, mid: m.id, text: m.text || '', ts: m.ts,
      mediaUrl: m.mediaUrl || null, fileUrl: m.fileUrl || null, fileName: m.fileName || null,
      audioUrl: m.audioUrl || null, audioDur: m.audioDur || null, geo: m.geo || null,
      circleUrl: m.circleUrl || null, poster: m.poster || null, dur: m.dur || null,
      replyTo: m.replyTo ? { id: m.replyTo.id, name: m.replyTo.name, text: m.replyTo.text } : null,
      fwdFrom: m.forwardedFrom || null,
    });
  }

  /* ==================== CHAT LIST ==================== */
  function effOnline(c) {
    if (isLiveRoom(c.id)) return Net.connected && (c.id === 'room_global' ? livePeers.length > 0 : livePeers.length > 0);
    return false;
  }
  function effLastSeen(c) {
    const st = Store.getStatus(c.id);
    return Math.max(c.lastSeen || 0, (st && st.lastSeen) || 0);
  }

  function renderChatList(query) {
    const list = $('#chatList');
    list.innerHTML = '';
    let chats = Store.data.chats.filter(c => !c.archived);
    if (query) {
      const q = query.toLowerCase();
      chats = chats.filter(c => c.name.toLowerCase().includes(q) || c.messages.some(m => (m.text || '').toLowerCase().includes(q)));
    }
    chats.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || lastTs(b) - lastTs(a));

    for (const c of chats) list.appendChild(chatItem(c));
    if (!chats.length) list.appendChild(el('div', 'empty-list', query ? 'Ничего не найдено' : 'Чатов пока нет — нажмите ＋ и найдите друзей'));
    updateDrawerCounts();
  }

  const lastTs = (c) => c.messages.length ? c.messages[c.messages.length - 1].ts : 0;

  function previewOf(c) {
    const m = [...c.messages].reverse().find(x => !x.deleted) || c.messages[c.messages.length - 1];
    if (!m) return { text: c.kind === 'global' ? 'Пишите первым!' : 'Напишите первое сообщение…', draft: '' };
    const draft = Store.getDraft(c.id);
    let text = m.deleted ? '🚫 Сообщение удалено' : (m.media || m.mediaUrl) && !m.text ? '📷 Фото' : (m.audioUrl ? '🎤 Голосовое' : m.text);
    const prefix = m.from === 'me' || m.from === 'self' ? 'Вы: ' : (c.kind === 'global' && m.senderName ? m.senderName + ': ' : '');
    return { text: prefix + text, draft };
  }

  function chatItem(c) {
    const item = el('div', 'chat-item' + (currentChatId === c.id ? ' active' : '') + (c.pinned ? ' pinned' : ''));
    const av = avatarNode(c, 'avatar');
    if (effOnline(c)) av.classList.add('online-dot');
    const body = el('div', 'ci-body');
    const top = el('div', 'ci-top');
    top.appendChild(el('div', 'ci-name', (c.pinned ? '<i class="bi bi-pin-fill pin-ic"></i> ' : '') + esc(c.name)));
    top.appendChild(el('div', 'ci-time', U.fmtTimeShort(lastTs(c))));
    const bot = el('div', 'ci-bottom');
    const p = previewOf(c);
    bot.appendChild(el('div', 'ci-preview' + (p.draft ? ' has-draft' : ''),
      (p.draft ? '<b>Черновик: </b>' + esc(U.trunc(p.draft, 48)) : esc(U.trunc(p.text, 60)))));
    if (c.muted) bot.appendChild(el('i', 'bi bi-bell-slash-fill ci-mute'));
    if (c.unread) bot.appendChild(el('div', 'ci-unread', String(c.unread)));
    body.append(top, bot);
    item.append(av, body);
    item.addEventListener('click', () => openChat(c.id));
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showCtxAt(e.clientX, e.clientY, chatMenuItems(c));
    });
    let lp;
    item.addEventListener('touchstart', () => { lp = setTimeout(() => { U.haptic(20); showCtxAt(window.innerWidth / 2, 120, chatMenuItems(c)); }, 550); }, { passive: true });
    item.addEventListener('touchend', () => clearTimeout(lp));
    item.addEventListener('touchmove', () => clearTimeout(lp));
    return item;
  }

  function chatMenuItems(c) {
    return [
      [c.pinned ? '📌 Открепить' : '📌 Закрепить', () => { Store.togglePin(c.id); renderChatList($('#searchInput').value); }],
      [c.muted ? '🔔 Включить звук' : '🔕 Без звука', () => { Store.toggleMute(c.id); renderChatList($('#searchInput').value); }],
      [c.archived ? '📥 Из архива' : '📦 В архив', () => { Store.toggleArchive(c.id); renderChatList($('#searchInput').value); renderArchive(); }],
      ['✏️ Переименовать', () => promptModal('Новое название', c.name, (v) => { Store.renameChat(c.id, v); renderChatList($('#searchInput').value); })],
      ['🗑 Удалить чат', () => confirmModal('Удалить чат «' + c.name + '» со всей историей?', () => {
        Store.removeChat(c.id);
        if (currentChatId === c.id) { currentChatId = null; $('#chatView').classList.add('hidden'); $('#chatEmpty').classList.remove('hidden'); $('#app').classList.remove('show-chat'); }
        renderChatList($('#searchInput').value);
      })],
    ];
  }

  function avatarNode(c, cls) {
    const d = el('div', cls);
    if (c.avatar) { d.style.backgroundImage = `url(${c.avatar})`; d.classList.add('avatar-img'); }
    else { d.style.background = c.color || 'var(--accent)'; d.textContent = U.firstLetter(c.name); }
    return d;
  }

  function updateDrawerCounts() {
    $('#savedCount').textContent = Store.allMessages().filter(x => x.msg.starred).length || '';
    const arch = Store.data.chats.filter(c => c.archived);
    $('#archiveCount').textContent = arch.length || '';
    $('#archiveCount2').textContent = arch.length || '';
    const n = totalUnread();
    document.title = (n ? `(${n}) ` : '') + 'Teleport';
    if (window.matchMedia('(display-mode: standalone)').matches) {
      if (navigator.setAppBadge) n ? navigator.setAppBadge(n).catch(() => {}) : navigator.clearAppBadge?.();
    }
  }

  function renderArchive() {
    const list = $('#archiveList');
    list.innerHTML = '';
    const chats = Store.data.chats.filter(c => c.archived);
    if (!chats.length) list.appendChild(el('div', 'empty-list', 'Архив пуст'));
    for (const c of chats) list.appendChild(chatItem(c));
  }

  /* ==================== SIDEBAR ==================== */
  function bindSidebar() {
    $('#searchInput').addEventListener('input', (e) => renderChatList(e.target.value.trim()));
    $('#newChatBtn').addEventListener('click', () => openFindPeople());

    $('#backBtn').addEventListener('click', closeChat);
    $('#callBtn').addEventListener('click', startCallFromChat);
    $('#videoBtn').addEventListener('click', () => startCallFromChat('video'));
    $('#infoBtn').addEventListener('click', () => {
      const c = Store.chat(currentChatId); if (!c) return;
      showCtxAt(window.innerWidth - 230, 60, [
        ['ℹ️ Информация о чате', () => showChatInfo(c)],
        ['⭐ Избранные сообщения', () => showStarred()],
        ['🖼 Изменить обои', () => openSettings('wallpaper')],
        ...(c.peerId ? [['👤 Профиль собеседника', () => showPeerProfile(c)]] : []),
        ['🗑 Очистить историю', () => confirmModal('Очистить всю историю?', () => { Store.clearChat(c.id); renderMessages(c); renderChatList($('#searchInput').value); })],
        ...chatMenuItems(c).slice(0, 3),
      ]);
    });
    $('#peerInfoBtn').addEventListener('click', () => {
      const c = Store.chat(currentChatId); if (c) showChatInfo(c);
    });

    $('#archiveBack').addEventListener('click', () => {
      showArchived = false;
      $('#archivePanel').classList.add('hidden');
      $('#chatList').classList.remove('hidden');
    });
  }

  /* ---------- поиск людей / новый чат ---------- */
  function openFindPeople() {
    const box = el('div', 'modal-body find-people');
    box.appendChild(el('div', 'modal-title', '👥 Найти людей')) ;
    const inp = el('input'); inp.placeholder = 'Имя или @username друга…'; inp.autocomplete = 'off';
    box.appendChild(inp);
    const results = el('div', 'fp-results');
    results.appendChild(el('div', 'fp-hint', 'Введите минимум 2 символа. Люди, зарегистрированные на этом сервере, появятся здесь.'));
    box.appendChild(results);

    let timer = null;
    inp.addEventListener('input', () => {
      clearTimeout(timer);
      const q = inp.value.trim();
      if (q.length < 2) { results.innerHTML = ''; results.appendChild(el('div', 'fp-hint', 'Введите минимум 2 символа…')); return; }
      timer = setTimeout(async () => {
        results.innerHTML = '';
        results.appendChild(el('div', 'fp-hint', 'Поиск…'));
        const r = await Net.Auth.searchUsers(q);
        results.innerHTML = '';
        if (!r.ok) { results.appendChild(el('div', 'fp-hint', r.error || 'Сервер недоступен')); return; }
        if (!r.users.length) { results.appendChild(el('div', 'fp-hint', 'Никого не нашли. Попросите друга зарегистрироваться в Teleport!')); return; }
        for (const u of r.users) {
          const it = el('div', 'fp-item');
          const av = el('div', 'fp-avatar');
          if (u.avatar) { av.style.backgroundImage = `url(${u.avatar})`; av.classList.add('avatar-img'); }
          else { av.style.background = Store.colors[(u.name.charCodeAt(0) || 0) % Store.colors.length]; av.textContent = U.firstLetter(u.name); }
          const info = el('div', 'fp-info');
          info.appendChild(el('div', 'fp-name', esc(u.name)));
          info.appendChild(el('div', 'fp-uname', esc(u.username || '')));
          const add = el('button', 'btn-primary sm', 'Написать');
          add.onclick = () => { closeModal(); startDM(u); };
          it.append(av, info, add);
          results.appendChild(it);
        }
      }, 350);
    });

    const btns = el('div', 'modal-btns');
    const cancel = el('button', 'btn-ghost', 'Закрыть');
    cancel.onclick = closeModal; btns.appendChild(cancel); box.appendChild(btns);
    openModal(box);
    setTimeout(() => inp.focus(), 40);
  }

  function startDM(u) {
    if (!Store.data.me || !Store.data.me.id) { toast('Сначала войдите в аккаунт'); return; }
    const chatId = dmChatId(u.id);
    let c = Store.chat(chatId);
    if (!c) c = Store.newChat(u.name, { id: chatId, kind: 'dm', peerId: u.id, avatar: u.avatar, bio: u.bio });
    Store.addContact(u, chatId);
    Net.addContact(u.id, chatId);
    renderChatList($('#searchInput').value);
    openChat(c.id);
    toast(`Чат с ${u.name} открыт ✨`);
  }

  /* ==================== OPEN CHAT ==================== */
  function lastSeenText(c) {
    if (effOnline(c)) return 'в сети';
    const d = Date.now() - effLastSeen(c);
    if (!effLastSeen(c) || d > 30 * 86400000) return c.kind === 'global' ? 'общий чат' : 'чат ещё без активности';
    if (d < 60000) return 'был(а) только что';
    if (d < 3600000) return 'был(а) ' + Math.round(d / 60000) + ' мин назад';
    if (d < 86400000) return 'был(а) ' + Math.round(d / 3600000) + ' ч назад';
    return 'был(а) ' + new Date(effLastSeen(c)).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }

  function refreshHeader() {
    const c = Store.chat(currentChatId); if (!c) return;
    $('#peerName').textContent = c.name;
    const st = $('#peerStatus');
    const liveOn = isLiveRoom(c.id);
    if (liveOn && Net.connected && liveTypingWho) {
      st.textContent = liveTypingWho + ' печатает…';
      st.classList.remove('offline'); st.classList.add('typing');
    } else if (liveOn && Net.connected && livePeers.length) {
      st.textContent = livePeers.length === 1 ? livePeers[0].name + ' в сети' : livePeers.length + ' в сети';
      st.classList.remove('offline', 'typing');
    } else {
      st.classList.remove('typing');
      if (c.id === 'c_saved') st.textContent = 'личный блокнот';
      else if (!Net.live) st.textContent = 'войдите, чтобы писать людям';
      else if (liveOn && !Net.connected) st.textContent = 'нет соединения…';
      else st.textContent = lastSeenText(c);
      st.classList.toggle('offline', !(liveOn && Net.connected && livePeers.length));
    }
    const pa = $('#peerAvatar');
    pa.className = 'peer-avatar';
    if (c.avatar) { pa.style.backgroundImage = `url(${c.avatar})`; pa.classList.add('avatar-img'); pa.textContent = ''; }
    else { pa.style.background = c.color; pa.textContent = U.firstLetter(c.name); }
    // микрофон для голосовых — только в живых чатах
    $('#micBtn').classList.toggle('hidden', !isLiveRoom(c.id) || c.id === 'c_saved');
  }

  /* закрытие чата (кнопка «назад», свайп вправо, аппаратная кнопка Android) */
  function closeChat() {
    if (!$('#app').classList.contains('show-chat')) return;
    if (currentChatId) Store.setDraft(currentChatId, $('#msgInput').value.trim());
    $('#msgInput').blur();
    $('#emojiPanel').classList.add('hidden');
    $('#attachPanel').classList.add('hidden');
    $('#app').classList.remove('show-chat');
    const cur = $('#chatList .chat-item.active');
    if (cur && U.isMobile()) cur.scrollIntoView({ block: 'nearest' });
  }

  function openChat(id) {
    currentChatId = id;
    const c = Store.chat(id); if (!c) return;
    Store.markRead(id);
    unreadBelow = 0; updateScrollBadge();
    if (U.isMobile()) pushChatHistory();

    $('#chatEmpty').classList.add('hidden');
    $('#chatView').classList.remove('hidden');
    $('#app').classList.add('show-chat');
    $('#archivePanel').classList.add('hidden');
    $('#chatList').classList.remove('hidden');
    $('#emojiPanel').classList.add('hidden');
    $('#attachPanel').classList.add('hidden');

    if (prevChatId && prevChatId !== id) Store.setDraft(prevChatId, $('#msgInput').value.trim());
    prevChatId = id;

    closeMsgSearch();
    replyTo = null; editingId = null; pendingMedia = null; pendingUrl = null; updateReplyHint();
    $('#msgInput').value = Store.getDraft(id);
    autoResize();
    refreshHeader();
    renderMessages(c);
    renderChatList($('#searchInput').value);
    scrollBottom(true);
    if (isLiveRoom(id)) { Net.join(id); Net.markRead(id); livePeers = []; }
    if (!U.isMobile()) $('#msgInput').focus();
  }

  /* ==================== MESSAGES ==================== */
  function renderMessages(c) {
    const box = $('#messages');
    box.classList.remove('chat-enter'); void box.offsetWidth; box.classList.add('chat-enter');
    box.innerHTML = '';
    let lastDate = '';
    for (const m of c.messages) {
      const day = new Date(m.ts).toDateString();
      if (day !== lastDate) {
        lastDate = day;
        const div = el('div', 'date-divider');
        div.appendChild(el('span', '', U.fmtDateLabel(m.ts)));
        box.appendChild(div);
      }
      box.appendChild(renderBubble(c, m));
    }
    applySearchHighlight();
  }

  function ticks(status) {
    if (status === 'read') return '<i class="bi bi-check-all read"></i>';
    if (status === 'delivered') return '<i class="bi bi-check-all"></i>';
    return '<i class="bi bi-check"></i>';
  }

  function renderBubble(c, m) {
    const row = el('div', 'msg-row ' + (m.from === 'me' || m.from === 'self' ? 'out' : 'in'));
    row.dataset.mid = m.id;
    const b = el('div', 'bubble' + (m.deleted ? ' deleted' : ''));

    if (m.replyTo) {
      const r = el('div', 'reply-ref', `<b>${esc(m.replyTo.name)}</b>${esc(U.trunc(m.replyTo.text, 60))}`);
      r.addEventListener('click', () => jumpToMessage(m.replyTo.id));
      b.appendChild(r);
    }
    if (m.forwardedFrom) b.appendChild(el('div', 'fwd-label', `<i class="bi bi-share-fill"></i> Переслано от <b>${esc(m.forwardedFrom)}</b>`));
    if (m.from === 'peer' && m.senderName && c.kind === 'global') b.appendChild(el('div', 'sender-name', esc(m.senderName)));

    const mediaSrc = m.media || m.mediaUrl;
    if (m.circleUrl && !m.deleted) b.appendChild(circleBubble(m));
    else if (mediaSrc && !m.deleted) {
      const img = el('img', 'media');
      img.src = mediaSrc; img.alt = 'фото'; img.loading = 'lazy';
      img.addEventListener('click', () => lightbox(mediaSrc));
      b.appendChild(img);
    }
    if (m.fileUrl && !m.deleted) {
      const f = el('a', 'file-chip');
      f.href = m.fileUrl; f.download = m.fileName || 'файл'; f.target = '_blank';
      f.innerHTML = `<i class="bi bi-file-earmark-arrow-down"></i><span>${esc(m.fileName || 'Файл')}</span>`;
      b.appendChild(f);
    }
    if (m.geo && !m.deleted) {
      const g = el('a', 'geo-chip');
      g.href = 'https://maps.google.com/?q=' + m.geo; g.target = '_blank';
      g.innerHTML = `<i class="bi bi-geo-alt-fill"></i><span>Моя геопозиция</span>`;
      b.appendChild(g);
    }
    if (m.audioUrl && !m.deleted) b.appendChild(audioBubble(m));
    if (m.deleted) b.appendChild(document.createTextNode('🚫 Сообщение удалено'));
    else if (m.text) b.appendChild(el('span', 'text', U.linkifyBr(esc(m.text))));

    const meta = el('div', 'meta');
    meta.innerHTML = `${m.starred ? '<i class="bi bi-star-fill star"></i>' : ''}${m.edited ? '<span class="edited">изменено</span>' : ''}
      <span>${new Date(m.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
      ${m.from === 'me' ? `<span class="ticks">${ticks(m.status)}</span>` : ''}`;
    b.appendChild(meta);

    if (!m.deleted && m.from !== 'self') {
      const acts = el('div', 'actions');
      acts.appendChild(iconAct(m.starred ? '⭐' : '☆', 'Избранное', () => {
        Store.toggleStar(c.id, m.id); renderMessages(c); updateDrawerCounts();
      }));
      if (m.from === 'me') acts.appendChild(iconAct('✏️', 'Изменить', () => startEdit(m)));
      acts.appendChild(iconAct('↩️', 'Ответить', () => setReply(m, c)));
      acts.appendChild(iconAct('➡️', 'Переслать', () => forwardMessage(c, m)));
      acts.appendChild(iconAct('🗑', 'Удалить', () => deleteMsg(c, m)));
      b.appendChild(acts);

      b.addEventListener('contextmenu', e => {
        e.preventDefault(); showCtxAt(e.clientX, e.clientY, msgMenuItems(c, m));
      });
      let lp;
      b.addEventListener('touchstart', e => {
        lp = setTimeout(() => { U.haptic(20); const t = e.touches[0]; showCtxAt(t.clientX, t.clientY, msgMenuItems(c, m)); }, 550);
      }, { passive: true });
      b.addEventListener('touchend', () => clearTimeout(lp));
      b.addEventListener('touchmove', () => clearTimeout(lp));
    }
    row.appendChild(b);
    return row;
  }

  function audioBubble(m) {
    const wrap = el('div', 'audio-msg');
    const btn = el('button', 'am-play', '<i class="bi bi-play-fill"></i>');
    const dur = el('span', 'am-dur', m.audioDur ? fmtDur(m.audioDur) : '');
    const wave = el('div', 'am-wave');
    for (let i = 0; i < 14; i++) {
      const bar = el('i');
      bar.style.height = Math.round(25 + Math.abs(Math.sin(i * 2.3 + ((m.id || 'x').charCodeAt(0) || i))) * 70) + '%';
      wave.appendChild(bar);
    }
    wrap.append(btn, wave, dur);
    let a = null, playing = false;
    btn.onclick = () => {
      if (!a) { a = new Audio(m.audioUrl); a.ondurationchange = () => { if (isFinite(a.duration)) dur.textContent = fmtDur(a.duration); }; a.onended = () => { playing = false; btn.innerHTML = '<i class="bi bi-play-fill"></i>'; wrap.classList.remove('playing'); }; }
      if (playing) { a.pause(); playing = false; btn.innerHTML = '<i class="bi bi-play-fill"></i>'; wrap.classList.remove('playing'); }
      else { a.play(); playing = true; btn.innerHTML = '<i class="bi bi-pause-fill"></i>'; wrap.classList.add('playing'); }
    };
    return wrap;
  }
  const fmtDur = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

  /* ---------- видеокружок («видеосообщение») ---------- */
  function circleBubble(m) {
    const wrap = el('div', 'circle-msg' + (m.from === 'me' ? ' out' : ''));
    let played = false;
    if (m.poster) {
      const img = el('img', 'cm-poster'); img.src = m.poster; img.alt = '';
      wrap.appendChild(img);
    } else {
      wrap.appendChild(el('div', 'cm-placeholder', '<i class="bi bi-camera-video-fill"></i>'));
    }
    const ring = el('div', 'cm-ring');
    for (let i = 0; i < 12; i++) ring.appendChild(el('i'));
    wrap.appendChild(ring);
    const play = el('div', 'cm-play', '<i class="bi bi-play-fill"></i>');
    wrap.appendChild(play);
    if (m.dur) wrap.appendChild(el('span', 'cm-dur', fmtDur(m.dur)));
    wrap.addEventListener('click', () => {
      U.haptic(8);
      let v = wrap.querySelector('video');
      if (!v) {
        v = el('video', 'cm-video');
        v.src = m.circleUrl; v.playsInline = true; v.loop = true;
        v.muted = !played; // первый тап — со звуком разрешает только жест пользователя
        v.addEventListener('play', () => { played = true; wrap.classList.add('playing'); play.style.opacity = '0'; });
        v.addEventListener('pause', () => { wrap.classList.remove('playing'); play.style.opacity = '1'; });
        wrap.insertBefore(v, ring);
      }
      if (wrap.classList.contains('playing')) { v.pause(); }
      else { v.currentTime = 0; v.play().catch(() => {}); }
    });
    return wrap;
  }

  /* ---------- запись видеокружка ---------- */
  let circleUI = null;
  async function startCircle() {
    if (typeof CircleRecorder === 'undefined') { toast('Браузер не поддерживает запись видео'); return; }
    if (circleUI) return;
    const ov = el('div', 'circle-overlay');
    ov.innerHTML = `
      <video class="co-video" playsinline muted></video>
      <div class="co-ring"><svg viewBox="0 0 96 96">
        <circle cx="48" cy="48" r="44" class="co-track"/><circle cx="48" cy="48" r="44" class="co-prog"/>
      </svg></div>
      <div class="co-time">0:00</div>
      <button class="co-flip" title="Перевернуть камеру"><i class="bi bi-camera-reels"></i></button>
      <button class="co-cancel" title="Отмена"><i class="bi bi-x-lg"></i></button>
      <button class="co-rec" title="Начать запись"></button>
      <button class="co-send hidden" title="Отправить"><i class="bi bi-check-lg"></i></button>`;
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('show'));
    circleUI = ov;
    const vid = ov.querySelector('.co-video'), recBtn = ov.querySelector('.co-rec'),
      sendBtn = ov.querySelector('.co-send'), cancelBtn = ov.querySelector('.co-cancel'),
      flipBtn = ov.querySelector('.co-flip'), prog = ov.querySelector('.co-prog'), timeEl = ov.querySelector('.co-time');
    const CIRC = 2 * Math.PI * 44;
    prog.style.strokeDasharray = CIRC; prog.style.strokeDashoffset = CIRC;
    let result = null, recording = false;
    const close = () => { ov.classList.remove('show'); setTimeout(() => ov.remove(), 220); circleUI = null; };
    try {
      await CircleRecorder.start(vid);
    } catch (e) { close(); toast('⚠️ Нет доступа к камере'); return; }
    CircleRecorder.onTick = (s) => {
      timeEl.textContent = fmtDur(s);
      prog.style.strokeDashoffset = CIRC * (1 - Math.min(s, 60) / 60);
    };
    recBtn.onclick = async () => {
      if (!recording) { recording = true; recBtn.classList.add('recording'); U.haptic(15); return; }
      recording = false;
      result = await CircleRecorder.stop();
      if (!result || !result.blob) { close(); return; }
      vid.srcObject = null; vid.src = URL.createObjectURL(result.blob); vid.loop = true; vid.muted = false;
      vid.play().catch(() => {});
      recBtn.classList.add('hidden'); sendBtn.classList.remove('hidden'); flipBtn.classList.add('hidden');
    };
    flipBtn.onclick = () => CircleRecorder.flip();
    cancelBtn.onclick = () => { CircleRecorder.cancel(); close(); };
    sendBtn.onclick = async () => {
      if (!result) return;
      sendBtn.disabled = true; sendBtn.innerHTML = '<span class="spinner"></span>';
      const url = await uploadBlob(result.blob, result.blob.type || 'video/webm');
      close();
      if (!url) { toast('⚠️ Не удалось отправить кружок'); return; }
      const c = Store.chat(currentChatId); if (!c) return;
      const m = { id: Store.uid(), from: 'me', text: '', ts: Date.now(), status: 'sent',
        circleUrl: url, poster: result.poster || null, dur: result.duration || 0,
        replyTo, edited: false, deleted: false, starred: false };
      Store.addMessage(c.id, m); liveSend(c, m);
      replyTo = null; updateReplyHint();
      renderMessages(c); renderChatList($('#searchInput').value); scrollBottom(true);
      U.haptic(10);
    };
  }

  function deleteMsg(c, m) {
    confirmModal('Удалить сообщение?', () => {
      Store.deleteMessage(c.id, m.id);
      if (isLiveRoom(c.id)) Net.delMsg(c.id, m.id);
      renderMessages(c); renderChatList($('#searchInput').value);
    });
  }

  function forwardMessage(srcChat, m) {
    const chats = Store.data.chats.filter(x => x.id !== srcChat.id && !x.archived);
    if (!chats.length) { toast('Нет чатов для пересылки'); return; }
    const box = el('div', 'modal-body');
    box.appendChild(el('div', 'modal-title', '➡️ Переслать в…'));
    box.appendChild(el('div', 'modal-text', U.trunc(m.text || '📷 Фото', 120)));
    const list = el('div', 'fwd-list');
    for (const t of chats) {
      const it = el('div', 'fwd-item');
      it.append(avatarNode(t, 'fwd-avatar'), el('div', 'fwd-name', esc(t.name)));
      it.addEventListener('click', () => {
        closeModal();
        const copy = Object.assign({}, m, {
          id: Store.uid(), from: 'me', ts: Date.now(), status: isLiveRoom(t.id) ? 'sent' : 'read',
          replyTo: null, edited: false, starred: false, forwardedFrom: srcChat.name,
        });
        Store.addMessage(t.id, copy);
        if (isLiveRoom(t.id)) {
          const sent = liveSend(t, copy);
          Store.updateMessage(t.id, copy.id, { status: sent ? 'delivered' : 'sent' });
        }
        renderChatList($('#searchInput').value);
        if (currentChatId === t.id) { renderMessages(t); scrollBottom(true); }
        toast(`➡️ Переслано в «${t.name}»`);
      });
      list.appendChild(it);
    }
    box.appendChild(list);
    const btns = el('div', 'modal-btns');
    const cancel = el('button', 'btn-ghost', 'Отмена');
    cancel.onclick = closeModal; btns.appendChild(cancel); box.appendChild(btns);
    openModal(box);
  }

  function msgMenuItems(c, m) {
    const items = [
      ['↩️ Ответить', () => setReply(m, c)],
      ['➡️ Переслать', () => forwardMessage(c, m)],
      [m.starred ? '⭐ Убрать из избранного' : '☆ В избранное', () => { Store.toggleStar(c.id, m.id); renderMessages(c); updateDrawerCounts(); }],
    ];
    if (m.from === 'me' && !m.deleted) items.push(['✏️ Изменить', () => startEdit(m)]);
    if (m.text) items.push(['📋 Копировать текст', () => copyText(m.text)]);
    if (mediaSrcOf(m)) items.push(['⬇️ Скачать фото', () => downloadMedia(m)]);
    items.push(['🗑 Удалить', () => deleteMsg(c, m)]);
    return items;
  }

  function jumpToMessage(mid) {
    const node = document.querySelector(`.msg-row[data-mid="${mid}"]`);
    if (!node) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    node.classList.add('flash');
    setTimeout(() => node.classList.remove('flash'), 1200);
  }

  function iconAct(txt, title, fn) {
    const btn = el('button', '', txt); btn.title = title;
    btn.addEventListener('click', e => { e.stopPropagation(); fn(); });
    return btn;
  }

  function scrollBottom(force) {
    const box = $('#messages');
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 150;
    if (force || nearBottom) {
      if (box.scrollTo) box.scrollTo({ top: box.scrollHeight, behavior: force ? 'auto' : 'smooth' });
      else box.scrollTop = box.scrollHeight;
    }
  }
  function updateScrollBadge() {
    const badge = $('#scrollBadge');
    if (unreadBelow > 0) { badge.textContent = unreadBelow; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');
  }

  /* ==================== COMPOSER ==================== */
  function bindComposer() {
    const input = $('#msgInput');
    input.addEventListener('input', () => {
      autoResize();
      if (currentChatId && !editingId) Store.setDraft(currentChatId, input.value.trim());
      if (isLiveRoom(currentChatId) && input.value.trim()) {
        const now = Date.now();
        if (now - typingThrottle > 1000) { typingThrottle = now; Net.typing(true); }
      }
    });
    input.addEventListener('blur', () => { if (currentChatId && !editingId) Store.setDraft(currentChatId, input.value.trim()); });
    input.addEventListener('keydown', e => {
      const enterSend = Store.data.enterToSend !== false;
      if (e.key === 'Enter' && (enterSend ? !e.shiftKey : false)) { e.preventDefault(); send(); }
      if (e.key === 'Escape') { cancelEdit(); replyTo = null; updateReplyHint(); }
    });

    $('#sendBtn').addEventListener('click', send);
    $('#attachBtn').addEventListener('click', (e) => { e.stopPropagation(); $('#attachPanel').classList.toggle('hidden'); });
    $('#attPhoto').addEventListener('click', () => { $('#attachPanel').classList.add('hidden'); $('#fileInput').click(); });
    $('#attVoice').addEventListener('click', () => { $('#attachPanel').classList.add('hidden'); startRec(); });
    $('#attCircle').addEventListener('click', () => { $('#attachPanel').classList.add('hidden'); startCircle(); });
    $('#attFile').addEventListener('click', () => { $('#attachPanel').classList.add('hidden'); $('#anyFileInput').click(); });
    $('#attLoc').addEventListener('click', () => { $('#attachPanel').classList.add('hidden'); sendLocation(); });
    $('#fileInput').addEventListener('change', onPickImage);
    $('#anyFileInput').addEventListener('change', onPickFile);
    $('#emojiBtn').addEventListener('click', toggleEmoji);
    $('#rhCancel').addEventListener('click', () => { replyTo = null; cancelEdit(); updateReplyHint(); });
    $('#micBtn').addEventListener('click', startRec);

    $('#messages').addEventListener('scroll', () => {
      const box = $('#messages');
      const far = box.scrollHeight - box.scrollTop - box.clientHeight > 120;
      $('#scrollBottomBtn').classList.toggle('hidden', !far);
      if (!far) { unreadBelow = 0; updateScrollBadge(); }

      /* индикатор прогресса прокрутки (тонкая линия у верхнего края) */
      const sp = $('#scrollProgress');
      if (sp) {
        const max = box.scrollHeight - box.clientHeight;
        const p = max > 40 ? Math.min(1, Math.max(0, box.scrollTop / max)) : 0;
        sp.style.setProperty('--sp', p.toFixed(3));
        sp.style.setProperty('--spo', p > 0.01 && p < 0.995 ? '.7' : '0');
      }

      /* плавающая дата как в Telegram: показываем дату под верхним краем экрана */
      const hd = $('#hoverDate');
      if (hd) {
        const divs = box.querySelectorAll('.date-divider');
        let label = '';
        for (const d of divs) {
          if (d.offsetTop <= box.scrollTop + 8) label = d.textContent.trim();
          else break;
        }
        if (label && far) { hd.textContent = label; hd.classList.add('show'); }
        else hd.classList.remove('show');
        clearTimeout(hd._t); hd._t = setTimeout(() => hd.classList.remove('show'), 1400);
      }
    }, { passive: true });
    $('#scrollBottomBtn').addEventListener('click', () => scrollBottom(true));
    document.addEventListener('click', (e) => {
      const ap = $('#attachPanel');
      if (!ap.classList.contains('hidden') && !ap.contains(e.target) && e.target.closest('#attachBtn') === null) ap.classList.add('hidden');
    });

    buildEmojiPanel();
  }

  function autoResize() {
    const input = $('#msgInput');
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  }

  function send() {
    const input = $('#msgInput');
    const text = input.value.trim();
    if (!text && !pendingMedia) return;
    if (!currentChatId) return;
    const c = Store.chat(currentChatId);

    if (editingId) {
      const old = c.messages.find(x => x.id === editingId);
      if (old && old.text === text) { cancelEdit(); updateReplyHint(); return; }
      Store.updateMessage(c.id, editingId, { text, edited: true });
      if (isLiveRoom(c.id)) Net.edit(c.id, editingId, text);
      editingId = null; pendingMedia = null;
      resetSendBtn(); input.value = ''; autoResize(); updateReplyHint();
      renderMessages(c); renderChatList($('#searchInput').value); scrollBottom(true);
      toast('✏️ Сообщение изменено');
      return;
    }

    if (!Net.live && c.id !== 'c_saved') { toast('Войдите в аккаунт, чтобы писать — меню слева'); return; }

    const m = {
      id: Store.uid(), from: 'me', text, ts: Date.now(),
      status: c.id === 'c_saved' ? 'read' : 'sent',
      media: pendingMedia, mediaUrl: pendingUrl, replyTo,
      forwardedFrom: null, edited: false, deleted: false, starred: false,
    };
    Store.addMessage(c.id, m);
    pendingMedia = null; pendingUrl = null; replyTo = null;
    input.value = ''; autoResize(); updateReplyHint();
    Store.setDraft(c.id, ''); renderChatList($('#searchInput').value);
    renderMessages(c); scrollBottom(true);
    playSend(); U.haptic(10);

    if (isLiveRoom(c.id)) {
      const sent = liveSend(c, m);
      Store.updateMessage(c.id, m.id, { status: sent ? 'delivered' : 'sent' }); refreshTick(m.id);
      if (!sent) toast('⚠️ Нет связи с сервером — сохранено локально');
    }
  }

  function refreshTick(mid) {
    const node = document.querySelector(`.msg-row[data-mid="${mid}"] .ticks`);
    const c = Store.chat(currentChatId);
    const m = c && c.messages.find(x => x.id === mid);
    if (node && m) node.innerHTML = ticks(m.status);
  }
  function resetSendBtn() {
    $('#sendBtn').classList.remove('edit-mode');
    $('#sendBtn').innerHTML = '<i class="bi bi-send-fill"></i>';
  }

  /* ---------- reply / edit ---------- */
  function setReply(m, c) {
    replyTo = { id: m.id, name: m.from === 'me' ? 'Вы' : (m.senderName || c.name), text: m.text || '📷 Фото' };
    updateReplyHint(); $('#msgInput').focus();
  }
  function startEdit(m) {
    editingId = m.id; replyTo = null;
    $('#msgInput').value = m.text;
    $('#sendBtn').classList.add('edit-mode');
    $('#sendBtn').innerHTML = '<i class="bi bi-check-lg"></i>';
    updateReplyHint(); $('#msgInput').focus(); autoResize();
  }
  function updateReplyHint() {
    const hint = $('#replyHint');
    if (replyTo || editingId) {
      $('#rhTitle').textContent = editingId ? 'Редактирование' : 'Ответ ' + replyTo.name;
      $('#rhText').textContent = editingId ? 'Измените текст и нажмите ✓' : U.trunc(replyTo.text, 90);
      hint.classList.remove('hidden');
    } else hint.classList.add('hidden');
  }
  function cancelEdit() {
    if (!editingId) return;
    editingId = null; resetSendBtn(); $('#msgInput').value = '';
  }

  /* ---------- attachments ---------- */
  async function uploadDataUrl(dataUrl, mime) {
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const r = await fetch('/upload', { method: 'POST', headers: { 'Content-Type': mime || blob.type || 'image/jpeg' }, body: blob });
      const j = await r.json();
      return j && j.ok ? j.url : null;
    } catch (e) { return null; }
  }

  async function onPickImage(e) {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f || !currentChatId) return;
    try {
      pendingMedia = await U.compressImage(f, 1280, 0.8);
      if (isLiveRoom(currentChatId)) pendingUrl = await uploadDataUrl(pendingMedia, f.type || 'image/jpeg');
      send();
    } catch (err) { toast('⚠️ Не удалось обработать изображение'); }
  }

  async function onPickFile(e) {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f || !currentChatId) return;
    if (!Net.live) { toast('Файлы отправляются в живых чатах'); return; }
    if (f.size > 8 * 1024 * 1024) { toast('⚠️ Файл больше 8 МБ'); return; }
    toast('📤 Загрузка файла…');
    try {
      const r = await fetch('/upload?name=' + encodeURIComponent(f.name), { method: 'POST', headers: { 'Content-Type': f.type || 'application/octet-stream' }, body: f });
      const urlMatch = /\.(jpe?g|png|webp|gif)$/i.test(f.name);
      const j = await r.json().catch(() => null);
      if (!j || !j.ok) { toast('⚠️ Сервер не принял файл (' + (j && j.error || 'тип не поддерживается') + ')'); return; }
      const c = Store.chat(currentChatId);
      const m = { id: Store.uid(), from: 'me', text: '', ts: Date.now(), status: 'sent', media: null, mediaUrl: urlMatch ? j.url : null, fileUrl: urlMatch ? null : j.url, fileName: f.name, replyTo, edited: false, deleted: false, starred: false };
      Store.addMessage(c.id, m); liveSend(c, m);
      replyTo = null; updateReplyHint();
      renderMessages(c); renderChatList($('#searchInput').value); scrollBottom(true);
    } catch (err) { toast('⚠️ Ошибка загрузки'); }
  }

  function sendLocation() {
    if (!navigator.geolocation) { toast('Геолокация недоступна'); return; }
    if (!Net.live) { toast('Гео отправляется в живых чатах'); return; }
    navigator.geolocation.getCurrentPosition(pos => {
      const c = Store.chat(currentChatId); if (!c) return;
      const geo = pos.coords.latitude.toFixed(6) + ',' + pos.coords.longitude.toFixed(6);
      const m = { id: Store.uid(), from: 'me', text: '', ts: Date.now(), status: 'sent', geo, replyTo, edited: false, deleted: false, starred: false };
      Store.addMessage(c.id, m); liveSend(c, m);
      replyTo = null; updateReplyHint();
      renderMessages(c); scrollBottom(true);
    }, () => toast('⚠️ Не удалось определить местоположение'), { timeout: 8000 });
  }

  /* ---------- голосовые сообщения ---------- */
  let rec = null, recChunks = [], recStream = null, recTimer = null, recStart = 0;
  async function startRec() {
    if (rec) return;
    if (!navigator.mediaDevices || !window.MediaRecorder) { toast('Запись не поддерживается браузером'); return; }
    try { recStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { toast('⚠️ Доступ к микрофону запрещён'); return; }
    recChunks = [];
    const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '');
    rec = mime ? new MediaRecorder(recStream, { mimeType: mime }) : new MediaRecorder(recStream);
    rec.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
    rec.start();
    recStart = Date.now();
    $('#recBar').classList.remove('hidden');
    recTimer = setInterval(() => { $('#recTime').textContent = fmtDur((Date.now() - recStart) / 1000); }, 250);
    U.haptic(15);
  }
  function stopRec(sendIt) {
    if (!rec) return;
    clearInterval(recTimer);
    rec.onstop = async () => {
      recStream.getTracks().forEach(t => t.stop());
      if (!sendIt) return;
      const blob = new Blob(recChunks, { type: rec.mimeType || 'audio/webm' });
      const dur = (Date.now() - recStart) / 1000;
      if (dur < 0.7) { toast('Слишком короткое сообщение'); return; }
      const url = await uploadBlob(blob, rec.mimeType || 'audio/webm');
      if (!url) { toast('⚠️ Не удалось отправить голосовое'); return; }
      const c = Store.chat(currentChatId); if (!c) return;
      const m = { id: Store.uid(), from: 'me', text: '', ts: Date.now(), status: 'sent', audioUrl: url, audioDur: dur, replyTo, edited: false, deleted: false, starred: false };
      Store.addMessage(c.id, m); liveSend(c, Object.assign({}, m, { mediaUrl: url, audio: true }));
      replyTo = null; updateReplyHint();
      renderMessages(c); renderChatList($('#searchInput').value); scrollBottom(true);
    };
    rec.stop(); rec = null;
    $('#recBar').classList.add('hidden');
  }
  async function uploadBlob(blob, mime) {
    try {
      const r = await fetch('/upload', { method: 'POST', headers: { 'Content-Type': mime }, body: blob });
      const j = await r.json();
      return j && j.ok ? j.url : null;
    } catch (e) { return null; }
  }

  /* ---------- emoji ---------- */
  const EMOJI_GROUPS = {
    '😀': ['😀','😂','🥹','😍','😎','🤔','😅','🙃','😉','😊','😇','🥳','😢','😡','🤯','😴','🤗','😱','🤣','😋'],
    '👍': ['👍','👎','👏','🙏','💪','🤝','✌️','🤞','👌','🫶','🖐','☝️','🫡','🤙'],
    '❤️': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','❣️','💯','💢','💤','💫'],
    '🎉': ['🎉','🎊','🥂','🍕','☕','🍰','🎮','⚽','🚀','🔥','✨','⭐','🌙','☀️','🌈','🎵','🎧','📸'],
  };
  function buildEmojiPanel() {
    const p = $('#emojiPanel');
    p.innerHTML = '';
    for (const key in EMOJI_GROUPS)
      for (const e of EMOJI_GROUPS[key]) {
        const b = el('button', '', e);
        b.addEventListener('click', () => { const i = $('#msgInput'); i.value += e; i.focus(); autoResize(); });
        p.appendChild(b);
      }
  }
  function toggleEmoji() { $('#emojiPanel').classList.toggle('hidden'); $('#attachPanel').classList.add('hidden'); }

  const mediaSrcOf = (m) => m.media || m.mediaUrl;

  /* ==================== SEARCH IN CHAT ==================== */
  function bindMsgSearch() {
    $('#searchMsgBtn').addEventListener('click', () => {
      if (!currentChatId) return;
      $('#msgSearchBar').classList.remove('hidden');
      $('#msgSearchInput').focus();
    });
    $('#msgSearchClose').addEventListener('click', closeMsgSearch);
    $('#msgSearchInput').addEventListener('input', runMsgSearch);
    $('#msgSearchInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); navMsgSearch(e.shiftKey ? -1 : 1); }
      if (e.key === 'Escape') closeMsgSearch();
    });
    $('#msgSearchPrev').addEventListener('click', () => navMsgSearch(-1));
    $('#msgSearchNext').addEventListener('click', () => navMsgSearch(1));
  }
  function closeMsgSearch() {
    $('#msgSearchBar').classList.add('hidden');
    $('#msgSearchInput').value = '';
    searchHits = []; searchIdx = -1;
    $('#msgSearchCount').textContent = '';
    document.querySelectorAll('.msg-row.hl-active').forEach(n => n.classList.remove('hl-active'));
    if (currentChatId) renderMessages(Store.chat(currentChatId));
  }
  function runMsgSearch() {
    const q = $('#msgSearchInput').value.trim().toLowerCase();
    searchHits = []; searchIdx = -1;
    document.querySelectorAll('.msg-row mark').forEach(mm => mm.replaceWith(mm.textContent));
    if (!q || !currentChatId) { $('#msgSearchCount').textContent = ''; return; }
    const c = Store.chat(currentChatId);
    for (const row of $('#messages').querySelectorAll('.msg-row')) {
      const m = c.messages.find(x => x.id === row.dataset.mid);
      if (m && !m.deleted && (m.text || '').toLowerCase().includes(q)) {
        searchHits.push(row);
        const t = row.querySelector('.text');
        if (t) t.innerHTML = U.linkifyBr(highlightEsc(m.text, q));
      }
    }
    $('#msgSearchCount').textContent = searchHits.length ? `${searchHits.length}` : 'нет';
    if (searchHits.length) navMsgSearch(1);
  }
  function highlightEsc(text, q) {
    const safe = esc(text);
    const qs = esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return safe.replace(new RegExp(qs, 'gi'), mm => `<mark>${mm}</mark>`);
  }
  function navMsgSearch(dir) {
    if (!searchHits.length) return;
    document.querySelectorAll('.msg-row.hl-active').forEach(n => n.classList.remove('hl-active'));
    searchIdx = (searchIdx + dir + searchHits.length) % searchHits.length;
    const row = searchHits[searchIdx];
    row.classList.add('hl-active');
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('#msgSearchCount').textContent = `${searchIdx + 1}/${searchHits.length}`;
  }
  function applySearchHighlight() {
    if ($('#msgSearchBar').classList.contains('hidden')) return;
    runMsgSearch();
  }

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
        if (a === 'toggle-theme') { const order = ['light', 'dark']; const t = order[(order.indexOf(Store.data.theme) + 1) % order.length] || 'dark'; Store.setTheme(t); applyTheme(t); }
        if (a === 'settings') openSettings();
        if (a === 'new') openFindPeople();
        if (a === 'saved') showStarred();
        if (a === 'archive') {
          showArchived = true; renderArchive();
          $('#archivePanel').classList.remove('hidden');
          $('#chatList').classList.add('hidden');
        }
        if (a === 'export') exportData();
        if (a === 'import') $('#importInput').click();
        if (a === 'clear-all') confirmModal('Очистить ВСЕ чаты? Это действие необратимо.', () => {
          Store.clearAll(); renderChatList(); if (currentChatId) renderMessages(Store.chat(currentChatId));
          toast('Все чаты очищены');
        });
        if (a === 'logout') confirmModal('Выйти из аккаунта?', () => { Net.Auth.logout(); Store.logout(); location.reload(); });
        $('#drawer').classList.add('hidden');
      });
    });
    $('#importInput').addEventListener('change', importData);
  }

  const DARK_THEMES = ['dark', 'midnight', 'noir', 'amoled', 'ocean'];
  function applyTheme(t) {
    t = t || 'light';
    if (t === 'auto') {
      const dark = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
      t = dark ? 'midnight' : 'system';
    }
    document.documentElement.setAttribute('data-theme', t);
    document.body.classList.toggle('dark', DARK_THEMES.includes(t));
    const metas = document.querySelectorAll('meta[name="theme-color"]');
    if (metas[0]) metas[0].content = DARK_THEMES.includes(t) ? '#0f1320' : '#5b6cff';
  }
  function applyFont(v) { document.documentElement.style.fontSize = (16 * (v || 100) / 100) + 'px'; }
  function applyWallpaper(w) {
    const box = $('#messages'); if (!box) return;
    box.className = 'messages wp-' + (w || 'pattern');
    if (w === 'custom' && Store.data.customWp) {
      box.style.backgroundImage = 'url(' + Store.data.customWp + ')';
      document.documentElement.style.setProperty('--wp-tint', (Store.data.wpTint ?? 38) / 100);
      box.classList.add('is-tinted');
    } else {
      box.style.backgroundImage = '';
    }
  }
  function updateLiveBadge(on) {
    const b = $('#liveBadge');
    if (!Net.live) { b.classList.add('hidden'); return; }
    b.classList.remove('hidden');
    b.textContent = on ? 'LIVE' : '…';
    b.classList.toggle('off', !on);
    b.title = on ? 'Соединение с сервером установлено' : 'Переподключение…';
  }

  /* ==================== MODALS ==================== */
  function bindModals() {
    $('#modalOverlay').addEventListener('click', e => { if (e.target === $('#modalOverlay')) closeModal(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !$('#modalOverlay').classList.contains('hidden')) closeModal();
    });
  }
  function openModal(node) { $('#modalBox').innerHTML = ''; $('#modalBox').appendChild(node); $('#modalOverlay').classList.remove('hidden'); }
  function closeModal() { $('#modalOverlay').classList.add('hidden'); }

  function confirmModal(text, onOk) {
    const box = el('div', 'modal-body');
    box.appendChild(el('div', 'modal-text', esc(text)));
    const btns = el('div', 'modal-btns');
    const no = el('button', 'btn-ghost', 'Отмена');
    const yes = el('button', 'btn-danger', 'ОК');
    no.onclick = closeModal; yes.onclick = () => { closeModal(); onOk(); };
    btns.append(no, yes); box.appendChild(btns);
    openModal(box);
  }
  function promptModal(title, value, onOk) {
    const box = el('div', 'modal-body');
    box.appendChild(el('div', 'modal-title', esc(title)));
    const inp = el('input'); inp.value = value || ''; inp.maxLength = 48;
    box.appendChild(inp);
    const btns = el('div', 'modal-btns');
    const no = el('button', 'btn-ghost', 'Отмена');
    const yes = el('button', 'btn-primary sm', 'Сохранить');
    no.onclick = closeModal;
    const ok = () => { const v = inp.value.trim(); if (v) { closeModal(); onOk(v); } };
    yes.onclick = ok;
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
    btns.append(no, yes); box.appendChild(btns);
    openModal(box);
    setTimeout(() => inp.focus(), 30);
  }

  /* ==================== SETTINGS ==================== */
  function section(label) {
    const s = el('div', 'set-section');
    s.appendChild(el('div', 'set-head', label));
    return s;
  }
  function mkSwitch(checked, onChange) {
    const s = el('label', 'switch');
    const i = el('input'); i.type = 'checkbox'; i.checked = checked;
    const sl = el('span', 'slider');
    s.append(i, sl);
    i.onchange = () => onChange(i.checked);
    return s;
  }
  function addRow(parent, label, control, hint) {
    const d = el('div', 'set-row');
    const l = el('div', 'set-label-wrap');
    l.appendChild(el('div', 'set-label', label));
    if (hint) l.appendChild(el('div', 'set-hint', hint));
    d.appendChild(l);
    const ctl = el('div', 'set-ctl');
    ctl.appendChild(control);
    d.appendChild(ctl);
    parent.appendChild(d);
    return d;
  }

  function openSettings(sectionName) {
    const box = el('div', 'modal-body settings');
    box.appendChild(el('div', 'modal-title', '⚙️ Настройки'));

    /* ---- профиль ---- */
    const profSec = section('Профиль');
    const prof = el('div', 'profile-row');
    const pAv = avatarNodeMe('prof-avatar');
    pAv.title = 'Изменить фото';
    pAv.addEventListener('click', () => $('#myAvatarInput').click());
    const pInfo = el('div', 'prof-info');
    const nameInp = el('input'); nameInp.value = Store.data.me?.name || ''; nameInp.maxLength = 32; nameInp.placeholder = 'Ваше имя';
    const unameInp = el('input'); unameInp.value = (Store.data.me?.username || '').replace(/^@/, ''); unameInp.maxLength = 24; unameInp.placeholder = '@username';
    const bioInp = el('input'); bioInp.value = Store.data.me?.bio || ''; bioInp.maxLength = 80; bioInp.placeholder = 'О себе…';
    const saveProf = el('button', 'btn-primary sm', 'Сохранить профиль');
    saveProf.onclick = async () => {
      const patch = { name: nameInp.value.trim(), username: unameInp.value.trim(), bio: bioInp.value.trim() };
      if (!patch.name) return toast('Имя не может быть пустым');
      const r = await Net.Auth.profile(patch);
      if (r.ok) {
        Store.setMe(r.user);
        $('#drawerName').textContent = r.user.name;
        $('#drawerUsername').textContent = r.user.username || '';
        toast('Профиль сохранён ✅');
      } else toast('⚠️ ' + (r.error || 'Сервер недоступен'));
    };
    pInfo.append(nameInp, unameInp, bioInp, saveProf);
    prof.append(pAv, pInfo);
    profSec.appendChild(prof);
    box.appendChild(profSec);

    /* ---- оформление ---- */
    const lookSec = section('Оформление');
    const themeSel = el('select');
    for (const [v, l] of [['light', '☀️ Классическая светлая'], ['dark', '🌙 Тёмная'], ['midnight', '🌌 Полночь'], ['amoled', '⚫ AMOLED (чисто чёрная)'], ['ocean', '🌊 Океан'], ['sunset', '🌅 Закат'], ['emerald', '🍃 Изумруд'], ['noir', '🖤 Нуар'], ['auto', '🌗 Авто (по системе)']]) {
      const o = el('option'); o.value = v; o.textContent = l; if (Store.data.theme === v) o.selected = true; themeSel.appendChild(o);
    }
    themeSel.onchange = () => { Store.setTheme(themeSel.value); applyTheme(themeSel.value); };
    addRow(lookSec, 'Тема', themeSel);

    /* палитра Material You — 8 акцентов */
    const palWrap = el('div', 'pal-row');
    const PAL = [['blue', 'Синий'], ['violet', 'Фиолет'], ['pink', 'Розовый'], ['orange', 'Оранжевый'], ['green', 'Зелёный'], ['teal', 'Бирюзовый'], ['cyan', 'Голубой'], ['slate', 'Индиго']];
    for (const [p, name] of PAL) {
      const b = el('button', 'pal-dot pal-' + p);
      b.title = name;
      if ((Store.data.palette || 'blue') === p) b.classList.add('active');
      b.onclick = () => {
        Store.data.palette = p; Store.save();
        if (p === 'blue') document.documentElement.removeAttribute('data-pal');
        else document.documentElement.setAttribute('data-pal', p);
        palWrap.querySelectorAll('.pal-dot').forEach(x => x.classList.remove('active'));
        b.classList.add('active'); U.haptic(6);
      };
      palWrap.appendChild(b);
    }
    addRow(lookSec, 'Цветовой акцент', palWrap, 'Material You — цвет по всему приложению');

    const fsWrap = el('div', 'font-ctl');
    const minus = el('button', 'btn-ghost sm', '−');
    const val = el('span', 'font-val', (Store.data.fontScale || 100) + '%');
    const plus = el('button', 'btn-ghost sm', '+');
    const chFont = (d) => { const v = Math.max(85, Math.min(135, (Store.data.fontScale || 100) + d)); Store.setFont(v); applyFont(v); val.textContent = v + '%'; };
    minus.onclick = () => chFont(-5); plus.onclick = () => chFont(5);
    fsWrap.append(minus, val, plus);
    addRow(lookSec, 'Размер шрифта', fsWrap);

    const wpSel = el('select');
    const WP_NAMES = { pattern: 'Классические (узор)', ocean: 'Океан', sunset: 'Закат', forest: 'Лес', dark: 'Тёмные', none: 'Без фона', custom: '🖼 Своё фото' };
    for (const w of Store.WALLPAPERS) {
      if (w === 'custom' && !Store.data.customWp) continue;
      const o = el('option'); o.value = w; o.textContent = WP_NAMES[w] || w;
      if ((Store.data.wallpaper || 'pattern') === w) o.selected = true;
      wpSel.appendChild(o);
    }
    wpSel.onchange = () => { Store.setWallpaper(wpSel.value); applyWallpaper(wpSel.value); };
    addRow(lookSec, 'Обои чата', wpSel);

    /* --- свои обои: загрузка + затемнение под читаемость --- */
    const wpBox = el('div', 'wp-upload-row');
    const wpFile = el('input'); wpFile.type = 'file'; wpFile.accept = 'image/*'; wpFile.className = 'hidden';
    const wpBtn = el('button', 'btn-ghost sm', '📁 Загрузить изображение');
    wpBtn.onclick = () => wpFile.click();
    wpFile.onchange = async () => {
      const f = wpFile.files[0]; if (!f) return;
      try {
        const url = await new Promise((res, rej) => {   // сжатие до разумного размера
          const r = new FileReader();
          r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f);
        });
        Store.setCustomWp(url); applyWallpaper('custom');
        toast('Обои установлены ✨');
        const opt = [...wpSel.options].find(o => o.value === 'custom');
        if (!opt) { const o = el('option'); o.value = 'custom'; o.textContent = WP_NAMES.custom; wpSel.appendChild(o); }
        wpSel.value = 'custom';
      } catch (e) { toast('⚠️ Не удалось прочитать файл'); }
      wpFile.value = '';
    };
    const tintWrap = el('div', 'font-ctl');
    const tMinus = el('button', 'btn-ghost sm', '−');
    const tVal = el('span', 'font-val', (Store.data.wpTint ?? 38) + '%');
    const tPlus = el('button', 'btn-ghost sm', '＋');
    const chTint = (d) => {
      const v = Math.max(0, Math.min(80, (Store.data.wpTint ?? 38) + d));
      Store.setWpTint(v); tVal.textContent = v + '%';
      document.documentElement.style.setProperty('--wp-tint', v / 100);
    };
    tMinus.onclick = () => chTint(-5); tPlus.onclick = () => chTint(5);
    tintWrap.append(tMinus, tVal, tPlus);
    wpBox.append(wpBtn, wpFile);
    addRow(lookSec, 'Свои обои', wpBox, 'Фото автоматически затемняется для читаемости текста');
    addRow(lookSec, 'Затемнение обоев', tintWrap);
    box.appendChild(lookSec);

    /* ---- уведомления и звук ---- */
    const notifSec = section('Уведомления и звук');
    addRow(notifSec, 'Push-уведомления', mkSwitch(Store.data.notif !== false, v => {
      Store.setNotif(v);
      if (v && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    }), 'Баннер при новых сообщениях');
    const sndSel = el('select');
    for (const [v, l] of [['melody', '🎵 Мелодия (новая)'], ['marimba', '🎶 Маримба'], ['chime', '🔔 Колокольчик'], ['pop', '💧 Лёгкий поп']]) {
      const o = el('option'); o.value = v; o.textContent = l; if ((Store.data.soundKind || 'melody') === v) o.selected = true; sndSel.appendChild(o);
    }
    sndSel.onchange = () => { Store.data.soundKind = sndSel.value; Store.setSound(true); applySoundMode(); playPing(); Store.save(); };
    addRow(notifSec, 'Звук сообщений', sndSel);
    addRow(notifSec, 'Звук включён', mkSwitch(Store.data.sound !== false, v => { Store.setSound(v); if (v) playPing(); }));
    box.appendChild(notifSec);

    /* ---- приватность ---- */
    const privSec = section('Приватность');
    addRow(privSec, 'Отчёты о прочтении', mkSwitch(Store.data.sendReadReceipts !== false, v => Store.setReadReceipts(v)), 'Собеседник видит синие галочки');
    addRow(privSec, 'Показывать «в сети»', mkSwitch(Store.data.showOnline !== false, v => Store.setShowOnline(v)));
    box.appendChild(privSec);

    /* ---- поведение ---- */
    const behSec = section('Поведение');
    addRow(behSec, 'Enter — отправка', mkSwitch(Store.data.enterToSend !== false, v => Store.setEnterToSend(v)), 'Иначе отправка по Ctrl+Enter');
    box.appendChild(behSec);

    /* ---- данные ---- */
    const dataSec = section('Данные');
    const expBtn = el('button', 'btn-ghost sm', '💾 Экспорт');
    expBtn.onclick = exportData;
    const impBtn = el('button', 'btn-ghost sm', '📂 Импорт');
    impBtn.onclick = () => $('#importInput').click();
    const clrBtn = el('button', 'btn-ghost sm danger', '🗑 Очистить всё');
    clrBtn.onclick = () => confirmModal('Очистить ВСЕ чаты?', () => { Store.clearAll(); renderChatList(); toast('Очищено'); });
    const pack = el('div', 'btn-pack'); pack.append(expBtn, impBtn, clrBtn);
    addRow(dataSec, 'Резервные копии', pack);
    box.appendChild(dataSec);

    /* ---- о приложении ---- */
    const aboutSec = section('О приложении');
    addRow(aboutSec, 'Teleport PRO', el('div', 'set-static', 'v1.0 · ' + (Net.live ? 'аккаунт ' + (Store.data.me?.username || '') : 'без аккаунта')));
    box.appendChild(aboutSec);

    const btns = el('div', 'modal-btns');
    const ok = el('button', 'btn-primary sm', 'Готово');
    ok.onclick = closeModal; btns.appendChild(ok); box.appendChild(btns);
    openModal(box);
    if (sectionName === 'wallpaper') wpSel.focus();

    $('#myAvatarInput').onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try {
        const url = await U.compressImage(f, 256, 0.85);
        Store.setMyAvatar(url);
        applyMeAvatar();
        pAv.style.backgroundImage = `url(${url})`; pAv.classList.add('avatar-img'); pAv.textContent = '';
        if (Net.live) await Net.Auth.profile({ avatar: url });
        toast('Фото профиля обновлено ✅');
      } catch (err) { toast('⚠️ Ошибка обработки изображения'); }
    };
  }

  function avatarNodeMe(cls) {
    const me = Store.data.me || {};
    if (me.avatar) {
      const d = el('div', cls + ' avatar-img');
      d.style.backgroundImage = `url(${me.avatar})`;
      return d;
    }
    const d = el('div', cls, esc(U.firstLetter(me.name || 'Я')));
    d.style.background = 'var(--accent-grad)';
    return d;
  }

  /* ---------- информация о чате / профиле ---------- */
  function showChatInfo(c) {
    const box = el('div', 'modal-body chat-info');
    const head = el('div', 'ci-head');
    head.appendChild(avatarNode(c, 'ci-avatar'));
    const nm = el('div');
    nm.appendChild(el('div', 'ci-name', esc(c.name)));
    nm.appendChild(el('div', 'ci-status', c.id === 'c_saved' ? 'личный блокнот' : (isLiveRoom(c.id) ? (Net.connected ? 'живой чат · ' + (livePeers.length || 0) + ' в сети' : 'ожидание соединения') : lastSeenText(c))));
    head.appendChild(nm);
    box.appendChild(head);

    const bio = el('div', 'ci-bio');
    bio.appendChild(el('div', 'ci-label', 'Описание'));
    const bioInp = el('input'); bioInp.value = c.bio || ''; bioInp.placeholder = 'Короткое описание…';
    bioInp.onchange = () => Store.setBio(c.id, bioInp.value.trim());
    bio.appendChild(bioInp);
    box.appendChild(bio);

    const stats = el('div', 'ci-stats');
    const cnt = c.messages.filter(m => !m.deleted).length;
    const photos = c.messages.filter(m => mediaSrcOf(m) && !m.deleted).length;
    stats.innerHTML = `<span>💬 ${cnt} сообщ.</span><span>📷 ${photos} фото</span>`;
    box.appendChild(stats);

    const btns = el('div', 'modal-btns');
    const avBtn = el('button', 'btn-ghost', '🖼 Аватар');
    avBtn.onclick = () => $('#avatarInput').click();
    const del = el('button', 'btn-ghost danger', '🗑 Очистить');
    del.onclick = () => confirmModal('Очистить историю?', () => { Store.clearChat(c.id); renderMessages(c); renderChatList(); closeModal(); });
    const close = el('button', 'btn-primary sm', 'Закрыть');
    close.onclick = closeModal;
    btns.append(avBtn, del, close);
    box.appendChild(btns);
    openModal(box);

    $('#avatarInput').onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try {
        const url = await U.compressImage(f, 256, 0.85);
        Store.setAvatar(c.id, url);
        refreshHeader(); renderChatList($('#searchInput').value); closeModal();
        toast('Аватар обновлён ✅');
      } catch (err) { toast('⚠️ Ошибка обработки изображения'); }
    };
  }

  function showPeerProfile(c) {
    const contact = Object.values(Store.data.contacts).find(x => x.chatId === c.id);
    const box = el('div', 'modal-body chat-info');
    const head = el('div', 'ci-head');
    head.appendChild(avatarNode(c, 'ci-avatar'));
    const nm = el('div');
    nm.appendChild(el('div', 'ci-name', esc(c.name)));
    nm.appendChild(el('div', 'ci-status', esc((contact && contact.username) || '')));
    head.appendChild(nm);
    box.appendChild(head);
    if (c.bio) box.appendChild(el('div', 'ci-bio-text', esc(c.bio)));
    const btns = el('div', 'modal-btns');
    const call = el('button', 'btn-ghost', '📞 Позвонить');
    call.onclick = () => { closeModal(); doCall(c.peerId, 'audio'); };
    const vid = el('button', 'btn-ghost', '🎥 Видеозвонок');
    vid.onclick = () => { closeModal(); doCall(c.peerId, 'video'); };
    const rm = el('button', 'btn-ghost danger', '🚫 Удалить контакт');
    rm.onclick = () => confirmModal('Удалить контакт?', () => { if (contact) Store.removeContact(contact.id); closeModal(); renderChatList(); });
    const close = el('button', 'btn-primary sm', 'Закрыть');
    close.onclick = closeModal;
    btns.append(call, vid, rm, close);
    box.appendChild(btns);
    openModal(box);
  }

  function showStarred() {
    const hits = Store.allMessages().filter(x => x.msg.starred);
    const box = el('div', 'modal-body');
    box.appendChild(el('div', 'modal-title', '⭐ Избранные сообщения'));
    if (!hits.length) box.appendChild(el('p', 'modal-text', 'Пока ничего не отмечено звёздочкой. Нажмите ☆ на любом сообщении.'));
    const list = el('div', 'star-list');
    for (const { chat, msg } of hits.slice(0, 100)) {
      const it = el('div', 'star-item');
      it.innerHTML = `<div class="si-chat" style="color:${esc(chat.color)}">${esc(chat.name)}</div>
        <div class="si-text">${esc(U.trunc(msg.text || '📷 Фото', 90))}</div>
        <div class="si-time">${U.fmtTime(msg.ts)}</div>`;
      it.onclick = () => { closeModal(); openChat(chat.id); setTimeout(() => jumpToMessage(msg.id), 150); };
      list.appendChild(it);
    }
    box.appendChild(list);
    const btns = el('div', 'modal-btns');
    const close = el('button', 'btn-primary sm', 'Закрыть');
    close.onclick = closeModal; btns.appendChild(close); box.appendChild(btns);
    openModal(box);
  }

  /* ==================== EXPORT / IMPORT ==================== */
  function exportData() {
    const payload = JSON.stringify({ app: 'teleport', version: 3, exportedAt: new Date().toISOString(), data: Store.data }, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'teleport-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('💾 Экспорт готов');
  }
  function importData(e) {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const obj = JSON.parse(fr.result);
        if (!obj || obj.app !== 'teleport' || !Array.isArray(obj.data?.chats)) throw new Error('bad format');
        confirmModal('Заменить текущие данные из файла? Чатов: ' + obj.data.chats.length, () => {
          localStorage.setItem(Store.KEY, JSON.stringify(Object.assign({}, obj.data)));
          location.reload();
        });
      } catch (err) {
        toast('⚠️ Файл повреждён или не является экспортом Teleport');
      }
    };
    fr.readAsText(f);
  }

  /* ==================== NOTIFICATIONS & SOUND ==================== */
  function notify(chat, msg) {
    if (Store.data.notif === false) return;
    if (chat.muted) return;
    if (document.visibilityState === 'visible' && currentChatId === chat.id) return;
    if (msg.from === 'me' || msg.from === 'self') return;
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification(chat.name, { body: (msg.senderName ? msg.senderName + ': ' : '') + (msg.text || '📷 Фото').slice(0, 120), icon: 'icons/icon-192.png', tag: chat.id }); } catch (e) {}
    }
  }

  let audioCtx;
  function ctx() {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
  }
  function tone(freq, dur, gain, delay, type = 'sine', glideTo = null) {
    if (Store.data.sound === false) return;
    try {
      const ac = ctx();
      const t = ac.currentTime + (delay || 0);
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ac.destination);
      o.start(t); o.stop(t + dur + 0.05);
    } catch (e) {}
  }
  /* новые мелодичные звуки (не «писк») */
  const SOUNDS = {
    melody:  () => { tone(523.25, .16, .07, 0, 'triangle'); tone(659.25, .16, .07, .09, 'triangle'); tone(783.99, .3, .08, .18, 'triangle'); },
    marimba: () => { tone(587.33, .22, .09, 0, 'sine'); tone(880, .3, .07, .08, 'sine'); tone(440, .18, .05, .02, 'triangle'); },
    chime:   () => { tone(1046.5, .5, .05, 0, 'sine'); tone(1318.5, .45, .04, .07, 'sine'); tone(1568, .6, .035, .14, 'sine'); },
    pop:     () => { tone(420, .12, .09, 0, 'sine', 620); },
  };
  function applySoundMode() { /* выбор хранится в Store.data.soundKind */ }
  function playSend() { tone(660, .09, .05, 0, 'sine', 880); }
  function playPing() { (SOUNDS[Store.data.soundKind || 'melody'] || SOUNDS.melody)(); }
  function playCallRing() { tone(440, .35, .06, 0, 'sine'); tone(554, .35, .06, .4, 'sine'); }

  /* ==================== CALLS UI ==================== */
  let callTimerInt = null;
  function startCallFromChat(k) {
    const c = Store.chat(currentChatId);
    if (!c) return;
    if (!c.peerId) { toast('Звонки доступны в личных чатах с людьми'); return; }
    doCall(c.peerId, k || 'audio');
  }
  function doCall(peerUserId, k) {
    if (!Net.connected) { toast('⚠️ Нет соединения с сервером'); return; }
    const contact = Store.data.contacts[peerUserId] || { id: peerUserId, name: 'Собеседник' };
    Calls.start(contact, k);
  }

  function bindCallsUI() {
    $('#cbHangup').onclick = () => Calls.hangup();
    $('#cbAccept').onclick = () => Calls.accept();
    $('#cbDecline').onclick = () => Calls.decline();
    $('#cbMute').onclick = () => {
      const on = Calls.toggleMute();
      $('#cbMute').innerHTML = on === false ? '<i class="bi bi-mic-mute-fill"></i>' : '<i class="bi bi-mic-fill"></i>';
      $('#cbMute').classList.toggle('active', on === false);
    };
    $('#cbCam').onclick = () => {
      const on = Calls.toggleCam();
      $('#cbCam').innerHTML = on === false ? '<i class="bi bi-video-camera-slash-fill"></i>' : '<i class="bi bi-video-camera-fill"></i>';
      $('#cbCam').classList.toggle('active', on === false);
    };
  }

  function callUI(peer, k, mode) {
    const ov = $('#callOverlay');
    ov.classList.remove('hidden');
    ov.classList.toggle('video-mode', k === 'video' && mode === 'connected');
    $('#callName').textContent = peer.name || 'Звонок';
    const av = $('#callAvatar');
    if (peer.avatar) { av.style.backgroundImage = `url(${peer.avatar})`; av.classList.add('avatar-img'); av.textContent = ''; }
    else { av.style.backgroundImage = ''; av.classList.remove('avatar-img'); av.textContent = U.firstLetter(peer.name || '?'); }
    $('#cbCam').classList.toggle('hidden', k !== 'video');
    $('#localVideo').classList.toggle('hidden', k !== 'video');
    $('#remoteVideo').classList.toggle('hidden', k !== 'video');
    $('#cbAccept').classList.add('hidden'); $('#cbDecline').classList.add('hidden');
    return ov;
  }
  function hideCallUI() {
    $('#callOverlay').classList.add('hidden');
    $('#remoteVideo').srcObject = null; $('#localVideo').srcObject = null;
    clearInterval(callTimerInt); $('#callTimer').textContent = '';
    $('#cbMute').classList.remove('active'); $('#cbMute').innerHTML = '<i class="bi bi-mic-fill"></i>';
  }

  const callUICallbacks = {
    toast: (t) => toast(t),
    denied: () => toast('⚠️ Браузер запретил доступ к микрофону/камере'),
    onOutgoing: (peer, k) => {
      const ov = callUI(peer, k, 'ringing');
      $('#callStatus').textContent = k === 'video' ? 'Видеовызов…' : 'Вызов…';
      void ov;
    },
    onIncoming: (peer, k) => {
      callUI(peer, k, 'incoming');
      $('#callOverlay').classList.remove('hidden');
      $('#cbAccept').classList.remove('hidden'); $('#cbDecline').classList.remove('hidden');
      $('#callStatus').textContent = 'Входящий ' + (k === 'video' ? 'видеозвонок' : 'звонок');
      playCallRing(); U.haptic([80, 60, 80]);
    },
    onConnectedUI: (peer, k) => {
      callUI(peer || Calls.peerInfo || {}, k || Calls.callKind, 'connected');
      $('#callStatus').textContent = 'Соединение…';
      const t0 = Date.now();
      clearInterval(callTimerInt);
      callTimerInt = setInterval(() => { $('#callTimer').textContent = fmtDur((Date.now() - t0) / 1000); }, 1000);
    },
    onRemote: (stream, k) => {
      if (k === 'video') $('#remoteVideo').srcObject = stream;
      $('#remoteAudio').srcObject = stream;
      $('#callStatus').textContent = 'В разговоре';
    },
    onState: (s) => { if (s === 'connected') $('#callStatus').textContent = 'В разговоре'; },
    onEnded: () => { hideCallUI(); },
    localVideoReady: (stream) => { $('#localVideo').srcObject = stream; },
  };

  /* ==================== HELPERS ==================== */
  let toastTimer;
  function toast(text) {
    const t = $('#toast'); t.textContent = text; t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 2400);
  }

  function lightbox(src) {
    const lb = el('div', 'lightbox');
    const img = el('img'); img.src = src;
    lb.appendChild(img);
    const dl = el('button', 'lb-dl', '<i class="bi bi-download"></i>');
    dl.title = 'Скачать';
    dl.addEventListener('click', e => {
      e.stopPropagation();
      const a = document.createElement('a'); a.href = src; a.download = 'photo.jpg'; a.click();
    });
    lb.appendChild(dl);
    lb.addEventListener('click', () => lb.remove());
    document.body.appendChild(lb);
  }

  function copyText(t) {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(t).then(() => toast('📋 Скопировано')).catch(() => fallbackCopy(t));
    else fallbackCopy(t);
  }
  function fallbackCopy(t) {
    const ta = el('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;left:-999px';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('📋 Скопировано'); } catch (e) { toast('⚠️ Не удалось скопировать'); }
    ta.remove();
  }
  function downloadMedia(m) {
    const a = document.createElement('a');
    a.href = mediaSrcOf(m); a.download = 'photo-' + m.ts + '.jpg'; a.click();
  }

  function showCtxAt(x, y, items) {
    document.querySelector('.ctx-menu')?.remove();
    const menu = el('div', 'ctx-menu');
    for (const [label, fn] of items) {
      const it = el('div', '', label);
      it.addEventListener('click', () => { menu.remove(); fn(); });
      menu.appendChild(it);
    }
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 6)) + 'px';
    menu.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 6)) + 'px';
  }

  function bindGlobalKeys() {
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); $('#searchInput').focus(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && currentChatId) { e.preventDefault(); $('#searchMsgBtn').click(); }
      if (e.key === 'Escape') {
        if (!$('#msgSearchBar').classList.contains('hidden')) closeMsgSearch();
        document.querySelector('.lightbox')?.remove();
        $('#emojiPanel')?.classList.add('hidden');
        $('#attachPanel')?.classList.add('hidden');
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && Store.data.enterToSend === false && document.activeElement === $('#msgInput')) { e.preventDefault(); send(); }
    });
  }

  function registerSW() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  function installPrompt() {
    let deferred = null;
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; $('#installBtn').classList.remove('hidden'); });
    $('#installBtn').addEventListener('click', async () => {
      if (!deferred) return;
      deferred.prompt();
      await deferred.userChoice;
      deferred = null; $('#installBtn').classList.add('hidden');
    });
  }

  /* ripple-эффект Material You: делегирование по document */
  function bindRipple() {
    const SEL = 'button:not(.no-ripple):not(.co-rec):not(.co-send), .chat-item, .attach-opt';
    document.addEventListener('pointerdown', (e) => {
      const t = e.target.closest && e.target.closest(SEL);
      if (!t || !t.isConnected) return;
      if (getComputedStyle(t).position === 'static') t.classList.add('ripple-host');
      else if (!t.classList.contains('ripple-host') && getComputedStyle(t).overflow !== 'hidden') return;
      const r = t.getBoundingClientRect();
      const size = Math.max(r.width, r.height) * 1.15;
      const sp = el('span', 'ripple');
      sp.style.width = sp.style.height = size + 'px';
      sp.style.left = (e.clientX - r.left - size / 2) + 'px';
      sp.style.top = (e.clientY - r.top - size / 2) + 'px';
      t.appendChild(sp);
      setTimeout(() => sp.remove(), 600);
    }, { passive: true });
  }

  function bindResize() {
    const update = () => {
      const w = window.innerWidth;
      let pad = 0;
      if (w >= 1800) { const chatW = Math.min(1600, w) - 380; pad = Math.max(0, (chatW - 940) / 2); }
      else if (w >= 1400) pad = Math.max(0, (w - 380 - 1060) / 2);
      document.documentElement.style.setProperty('--center-pad', Math.round(pad) + 'px');
    };
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    update();

    /* ===== мягкая адаптация под мобильную клавиатуру (Android + iOS) ===== */
    const setKbInset = (h) => {
      h = Math.max(0, Math.round(h));
      document.documentElement.classList.toggle('kb-open', h > 60);
      const cur = parseInt(document.documentElement.style.getPropertyValue('--kb') || '0', 10);
      if (Math.abs(cur - h) < 4) return;
      document.documentElement.style.setProperty('--kb', h + 'px');
      const box = $('#messages');
      if (box && box.scrollHeight) box.scrollTop = box.scrollHeight; // прилипаем к последнему сообщению
    };
    if (window.visualViewport) {
      const onVV = () => {
        const overlap = window.innerHeight - visualViewport.height - visualViewport.offsetTop;
        setKbInset(overlap > 60 ? overlap : 0);
      };
      visualViewport.addEventListener('resize', onVV);
      visualViewport.addEventListener('scroll', onVV);
    } else {
      const input = $('#msgInput');
      input.addEventListener('focus', () => setTimeout(() => setKbInset(window.innerHeight * 0.38), 350));
      input.addEventListener('blur', () => setKbInset(0));
    }

    /* ===== свайп вправо = «назад» (как нативные жесты Android/iOS) ===== */
    const cvEl = $('#chatView');
    let sx = 0, sy = 0, tracking = false, edge = false;
    cvEl.addEventListener('touchstart', (e) => {
      if (!U.isMobile()) return;
      const t = e.touches[0];
      sx = t.clientX; sy = t.clientY;
      edge = sx <= 26;               // старт у левого края — гарантированный жест
      tracking = true;
    }, { passive: true });
    cvEl.addEventListener('touchmove', (e) => {
      if (!tracking) return;
      const t = e.touches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (dy > 44 || dx < 12) { tracking = false; cvEl.classList.remove('swipe-ghost'); cvEl.classList.add('swiping'); cvEl.style.transform = ''; return; }
      const limit = edge ? 240 : 130;
      if (dx > limit) { tracking = false; cvEl.classList.remove('swipe-ghost'); cvEl.classList.add('swiping'); cvEl.style.transform = ''; return; }
      cvEl.classList.add('swiping');
      cvEl.style.transform = `translateX(${Math.min(dx, 300)}px)`;
      cvEl.classList.toggle('swipe-ghost', dx > 70);
    }, { passive: true });
    const endSwipe = (e) => {
      if (!tracking) { cvEl.classList.remove('swiping'); return; }
      tracking = false;
      const t = (e.changedTouches && e.changedTouches[0]) || null;
      const dx = t ? t.clientX - sx : 0;
      cvEl.classList.remove('swipe-ghost');
      cvEl.classList.add('swipe-return');
      cvEl.style.transform = '';
      setTimeout(() => cvEl.classList.remove('swipe-return'), 240);
      if (dx > (edge ? 110 : 170)) { U.haptic(10); closeChat(); }
    };
    cvEl.addEventListener('touchend', endSwipe, { passive: true });
    cvEl.addEventListener('touchcancel', () => {
      tracking = false;
      cvEl.classList.remove('swiping', 'swipe-ghost');
      cvEl.style.transform = '';
    }, { passive: true });

    /* ===== аппаратная/системная кнопка «назад» на Android ===== */
    history.scrollRestoration = 'manual';
  }

  /* история для системной кнопки «Назад» Android: один уровень на открытый чат */
  let chatDepth = 0;
  function pushChatHistory() {
    if (chatDepth === 0) {
      try { history.pushState({ tpChat: 1 }, ''); } catch (e) {}
    }
    chatDepth++;
  }
  window.addEventListener('popstate', () => {
    if (chatDepth > 0) chatDepth--;
    closeChat();
  });

  document.addEventListener('DOMContentLoaded', init);
})();
