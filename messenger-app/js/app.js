/* ============ app.js — UI controller v2 ============ */
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
  let replyTo = null;      // { id, name, text }
  let editingId = null;    // сообщение в режиме редактирования
  let pendingMedia = null; // dataURL фото для отправки
  let showArchived = false;
  let unreadBelow = 0;     // непрочитанные под линией скролла
  let ctxTargetMsg = null; // id сообщения для контекстного меню
  let searchHits = [];     // результаты поиска в чате
  let searchIdx = -1;

  /* ==================== INIT ==================== */
  function init() {
    Store.seedIfEmpty();
    applyTheme(Store.data.theme);
    applyFont(Store.data.fontScale);
    applyWallpaper(Store.data.wallpaper);

    if (Store.data.me && Store.data.me.name) showApp();
    else $('#loginScreen').classList.remove('hidden');

    bindLogin();
    bindSidebar();
    bindComposer();
    bindDrawer();
    bindModals();
    bindMsgSearch();
    bindGlobalKeys();
    bindResize();
    renderChatList();

    Bot.scheduleAmbient(
      () => currentChatId,
      (chat, msg, isOpen) => {
        renderChatList($('#searchInput').value);
        updateDrawerCounts();
        if (isOpen) { renderMessages(chat); scrollBottom(true); }
        else if (!chat.muted) { playPing(); }
        notify(chat, msg);
      }
    );

    registerSW();
    updateDrawerCounts();
    handleHashRoute();
    window.addEventListener('hashchange', handleHashRoute);
  }

  function handleHashRoute() {
    const h = location.hash.replace(/^#/, '');
    if (h === 'saved') { setTimeout(() => showStarred(), 200); history.replaceState(null, '', location.pathname + location.search); }
    else if (h.startsWith('c_')) { setTimeout(() => openChat(h), 150); }
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

    // кнопка «Установить как приложение» (Android Chrome / Desktop)
    let deferredPrompt = null;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      $('#installBtn').classList.remove('hidden');
    });
    $('#installBtn').addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      $('#installBtn').classList.add('hidden');
    });
    window.addEventListener('appinstalled', () => $('#installBtn').classList.add('hidden'));
  }

  function showApp() {
    $('#loginScreen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#drawerName').textContent = Store.data.me?.name || 'Гость';
    const dAv = $('#drawerAvatar');
    if (Store.data.me?.avatar) { dAv.style.backgroundImage = `url(${Store.data.me.avatar})`; dAv.classList.add('avatar-img'); dAv.textContent = ''; }
    else { dAv.textContent = U.firstLetter(Store.data.me?.name || 'Я'); }
    renderChatList();
    updateDrawerCounts();
    if (window.innerWidth > 760) openChat('c_saved');
  }

  /* ==================== SIDEBAR / CHAT LIST ==================== */
  /* эффективный статус с учётом «живых» статусов ботов */
  function effOnline(c) {
    const st = Store.getStatus(c.id);
    return st ? !!st.online : !!c.online;
  }
  function effLastSeen(c) {
    const st = Store.getStatus(c.id);
    if (st && st.lastSeen) return Math.max(st.lastSeen, c.lastSeen || 0);
    return c.lastSeen || 0;
  }

  function previewText(m) {
    if (!m) return '';
    if (m.deleted) return 'Сообщение удалено';
    const who = m.from === 'me' ? 'Вы: ' : '';
    if (m.media && !m.text) return who + '📷 Фото';
    return who + m.text.replace(/\n/g, ' ');
  }

  function sortChats(chats) {
    return [...chats].sort((a, b) => {
      if (!!b.pinned !== !!a.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
      const la = a.messages.at(-1)?.ts || 0, lb = b.messages.at(-1)?.ts || 0;
      return lb - la;
    });
  }

  function chatItemNode(c, q) {
    const last = c.messages.filter(m => !m.deleted).at(-1) || c.messages.at(-1);

    const item = el('div', 'chat-item' + (c.id === currentChatId ? ' active' : ''));
    item.dataset.id = c.id;

    const av = avatarNode(c, 'avatar' + (effOnline(c) ? ' online' : ''));

    const meta = el('div', 'chat-meta');
    const top = el('div', 'chat-top');
    const nameEl = el('div', 'chat-name');
    if (c.pinned) nameEl.prepend(el('i', 'bi bi-geo-alt-fill pin-ico'));
    nameEl.appendChild(document.createTextNode(c.name));
    if (c.muted) nameEl.appendChild(el('i', 'bi bi-bell-slash mute-ico'));
    top.append(nameEl, el('div', 'chat-time', last ? U.fmtTime(last.ts) : ''));

    const bottom = el('div', 'chat-bottom');
    const draft = Store.getDraft(c.id);
    const prev = el('div', 'chat-preview');
    if (draft) {
      prev.innerHTML = `Черновик: <span class="draft-label">${esc(U.trunc(draft.replace(/\n/g, ' '), 60))}</span>`;
    } else {
      prev.textContent = previewText(last);
    }
    bottom.appendChild(prev);
    if (c.unread > 0) bottom.appendChild(el('div', 'badge' + (c.muted ? ' badge-muted' : ''), String(c.unread)));

    meta.append(top, bottom);
    item.append(av, meta);
    item.addEventListener('click', () => openChat(c.id));

    // правый клик (ПК) / долгое нажатие (моб.) — действия с чатом
    item.addEventListener('contextmenu', e => {
      e.preventDefault();
      showCtxAt(e.clientX, e.clientY, chatMenuItems(c));
    });
    let lpTimer;
    item.addEventListener('touchstart', e => {
      lpTimer = setTimeout(() => {
        U.haptic(20);
        const t = e.touches[0];
        showCtxAt(t.clientX, t.clientY, chatMenuItems(c));
      }, 550);
    }, { passive: true });
    item.addEventListener('touchend', () => clearTimeout(lpTimer));
    item.addEventListener('touchmove', () => clearTimeout(lpTimer));

    return item;
  }

  function avatarNode(c, cls) {
    if (c.avatar) {
      const d = el('div', cls + ' avatar-img');
      d.style.backgroundImage = `url(${c.avatar})`;
      if (c.online) d.classList.add('online');
      return d;
    }
    const av = el('div', cls, esc(U.firstLetter(c.name)));
    av.style.background = c.color;
    return av;
  }

  function chatMenuItems(c) {
    return [
      [`📌 ${c.pinned ? 'Открепить' : 'Закрепить'}`, () => { Store.togglePin(c.id); renderChatList($('#searchInput').value); }],
      [`🔇 ${c.muted ? 'Включить звук' : 'Заглушить'}`, () => { Store.toggleMute(c.id); renderChatList($('#searchInput').value); toast(c.muted ? 'Звук включён' : 'Чат заглушён'); }],
      [`📥 ${c.archived ? 'Вернуть из архива' : 'В архив'}`, () => { Store.toggleArchive(c.id); renderChatList($('#searchInput').value); renderArchive(); updateDrawerCounts(); }],
      ['✏️ Переименовать', () => promptModal('Новое имя', c.name, (v) => { Store.renameChat(c.id, v); renderChatList($('#searchInput').value); if (currentChatId === c.id) refreshHeader(); })],
      ['🗑 Удалить чат', () => confirmModal(`Удалить чат «${c.name}»?`, () => {
        Store.removeChat(c.id);
        if (currentChatId === c.id) { currentChatId = null; $('#chatView').classList.add('hidden'); $('#chatEmpty').classList.remove('hidden'); $('#app').classList.remove('show-chat'); }
        renderChatList($('#searchInput').value); renderArchive();
      })],
    ];
  }

  function renderChatList(filter = '') {
    const list = $('#chatList');
    list.innerHTML = '';
    const q = filter.toLowerCase();
    const chats = sortChats(Store.data.chats.filter(c => !c.archived));

    for (const c of chats) {
      if (q && !c.name.toLowerCase().includes(q) &&
          !c.messages.some(m => !m.deleted && (m.text || '').toLowerCase().includes(q))) continue;
      list.appendChild(chatItemNode(c, q));
    }
    if (!list.children.length) {
      list.appendChild(el('div', '', '<p style="padding:20px;color:var(--text-secondary);text-align:center">Ничего не найдено</p>'));
    }
  }

  function renderArchive() {
    const list = $('#archiveList');
    list.innerHTML = '';
    const arch = sortChats(Store.data.chats.filter(c => c.archived));
    for (const c of arch) list.appendChild(chatItemNode(c));
    if (!arch.length) list.appendChild(el('p', 'archive-empty', 'Архив пуст'));
    $('#archiveCount').textContent = arch.length || '';
    $('#archiveCount2').textContent = arch.length ? `— ${arch.length}` : '';
  }

  function updateDrawerCounts() {
    const starred = Store.allMessages().filter(x => x.msg.starred).length;
    $('#savedCount').textContent = starred || '';
    $('#archiveCount').textContent = Store.data.chats.filter(c => c.archived).length || '';
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
      if (currentChatId) Store.setDraft(currentChatId, $('#msgInput').value.trim());
      $('#app').classList.remove('show-chat');
    });
    $('#callBtn').addEventListener('click', () => toast('📞 Звонки появятся в следующей версии!'));
    $('#infoBtn').addEventListener('click', () => {
      const c = Store.chat(currentChatId); if (!c) return;
      showCtxAt(window.innerWidth - 210, 60, [
        ['ℹ️ Информация о чате', () => showChatInfo(c)],
        ['⭐ Избранные сообщения', () => showStarred()],
        ['🖼 Изменить обои', () => openSettings('wallpaper')],
        ['🗑 Очистить историю', () => confirmModal('Очистить всю историю?', () => { Store.clearChat(c.id); renderMessages(c); renderChatList($('#searchInput').value); })],
        ...chatMenuItems(c).slice(0, 3),
      ]);
    });
    $('#peerInfoBtn').addEventListener('click', () => {
      const c = Store.chat(currentChatId); if (c) showChatInfo(c);
    });

    // архив
    $('#archiveBack').addEventListener('click', () => {
      showArchived = false;
      $('#archivePanel').classList.add('hidden');
      $('#chatList').classList.remove('hidden');
    });
  }

  /* ==================== OPEN CHAT ==================== */
  function lastSeenText(c) {
    if (effOnline(c)) return 'в сети';
    const d = Date.now() - effLastSeen(c);
    if (d < 60000) return 'был(а) только что';
    if (d < 3600000) return 'был(а) ' + Math.round(d / 60000) + ' мин назад';
    if (d < 86400000) return 'был(а) ' + Math.round(d / 3600000) + ' ч назад';
    return 'был(а) ' + new Date(c.lastSeen).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }

  function refreshHeader() {
    const c = Store.chat(currentChatId); if (!c) return;
    $('#peerName').textContent = c.name;
    $('#peerStatus').textContent = lastSeenText(c);
    $('#peerStatus').classList.toggle('offline', !effOnline(c));
    const pa = $('#peerAvatar');
    pa.className = 'peer-avatar';
    if (c.avatar) { pa.style.backgroundImage = `url(${c.avatar})`; pa.classList.add('avatar-img'); pa.textContent = ''; }
    else { pa.style.background = c.color; pa.textContent = U.firstLetter(c.name); }
  }

  function openChat(id) {
    currentChatId = id;
    const c = Store.chat(id); if (!c) return;
    Store.markRead(id);
    unreadBelow = 0; updateScrollBadge();

    $('#chatEmpty').classList.add('hidden');
    $('#chatView').classList.remove('hidden');
    $('#app').classList.add('show-chat');
    $('#archivePanel').classList.add('hidden');
    $('#chatList').classList.remove('hidden');

    // сохранить черновик предыдущего чата
    if (prevChatId && prevChatId !== id) Store.setDraft(prevChatId, $('#msgInput').value.trim());
    prevChatId = id;

    closeMsgSearch();
    replyTo = null; editingId = null; pendingMedia = null; updateReplyHint();
    $('#msgInput').value = Store.getDraft(id);
    autoResize($('#msgInput'));
    refreshHeader();
    renderMessages(c);
    renderChatList($('#searchInput').value);
    scrollBottom(true);
    if (!U.isMobile()) $('#msgInput').focus();
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
    if (m.forwardedFrom) {
      b.appendChild(el('div', 'fwd-label', `<i class="bi bi-share-fill"></i> Переслано от <b>${esc(m.forwardedFrom)}</b>`));
    }
    if (m.media) {
      const img = el('img', 'media');
      img.src = m.media; img.alt = 'фото'; img.loading = 'lazy';
      img.addEventListener('click', () => lightbox(m.media));
      b.appendChild(img);
    }
    if (m.deleted) {
      b.appendChild(document.createTextNode('🚫 Сообщение удалено'));
    } else if (m.text) {
      b.appendChild(el('span', 'text', U.linkifyBr(esc(m.text))));
    }

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
      acts.appendChild(iconAct('🗑', 'Удалить', () => {
        Store.deleteMessage(c.id, m.id); renderMessages(c); renderChatList($('#searchInput').value);
      }));
      b.appendChild(acts);

      // контекстное меню: правый клик / долгое нажатие
      b.addEventListener('contextmenu', e => {
        e.preventDefault(); ctxTargetMsg = m.id;
        showCtxAt(e.clientX, e.clientY, msgMenuItems(c, m));
      });
      let lp;
      b.addEventListener('touchstart', e => {
        lp = setTimeout(() => {
          U.haptic(20);
          ctxTargetMsg = m.id;
          const t = e.touches[0];
          showCtxAt(t.clientX, t.clientY, msgMenuItems(c, m));
        }, 550);
      }, { passive: true });
      b.addEventListener('touchend', () => clearTimeout(lp));
      b.addEventListener('touchmove', () => clearTimeout(lp));
    }

    row.appendChild(b);
    return row;
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
      const av = avatarNode(t, 'fwd-avatar');
      it.append(av, el('div', 'fwd-name', esc(t.name)));
      it.addEventListener('click', () => {
        closeModal();
        const copy = Object.assign({}, m, {
          id: Store.uid(), from: 'me', ts: Date.now(), status: 'sent',
          replyTo: null, edited: false, starred: false,
          forwardedFrom: srcChat.name,
        });
        Store.addMessage(t.id, copy);
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
    if (m.media) items.push(['⬇️ Скачать фото', () => downloadMedia(m)]);
    items.push(['🗑 Удалить', () => confirmModal('Удалить сообщение?', () => {
      Store.deleteMessage(c.id, m.id); renderMessages(c); renderChatList($('#searchInput').value);
    })]);
    return items;
  }

  function jumpToMessage(mid) {
    const node = document.querySelector(`.msg-row[data-mid="${mid}"]`);
    if (!node) return;
    if (node.scrollIntoView) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
      else box.scrollTop = box.scrollHeight; // фолбэк для окружений без scrollTo
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
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 140) + 'px';
      if (currentChatId && !editingId) Store.setDraft(currentChatId, input.value.trim());
    });
    input.addEventListener('blur', () => {
      if (currentChatId && !editingId) Store.setDraft(currentChatId, input.value.trim());
    });
    input.addEventListener('keydown', e => {
      const enterSend = Store.data.enterToSend !== false;
      if (e.key === 'Enter' && (enterSend ? !e.shiftKey : false)) { e.preventDefault(); send(); }
      if (e.key === 'Escape') { cancelEdit(); replyTo = null; updateReplyHint(); }
    });

    $('#sendBtn').addEventListener('click', send);
    $('#attachBtn').addEventListener('click', () => $('#fileInput').click());
    $('#fileInput').addEventListener('change', onPickImage);
    $('#emojiBtn').addEventListener('click', toggleEmoji);
    $('#rhCancel').addEventListener('click', () => { replyTo = null; cancelEdit(); updateReplyHint(); });

    $('#messages').addEventListener('scroll', () => {
      const box = $('#messages');
      const far = box.scrollHeight - box.scrollTop - box.clientHeight > 120;
      $('#scrollBottomBtn').classList.toggle('hidden', !far);
      if (!far) { unreadBelow = 0; updateScrollBadge(); }
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

    if (editingId) { // режим редактирования
      const old = c.messages.find(x => x.id === editingId);
      if (old && old.text === text) { // ничего не изменили — просто выходим из режима
        cancelEdit(); updateReplyHint();
        return;
      }
      Store.updateMessage(c.id, editingId, { text, edited: true });
      editingId = null; pendingMedia = null;
      resetSendBtn(); input.value = ''; autoResize(input); updateReplyHint();
      renderMessages(c); renderChatList($('#searchInput').value); scrollBottom(true);
      toast('✏️ Сообщение изменено');
      return;
    }

    const m = {
      id: Store.uid(), from: 'me', text, ts: Date.now(),
      status: 'sent', media: pendingMedia, replyTo, edited: false, deleted: false, starred: false,
    };
    Store.addMessage(c.id, m);
    pendingMedia = null; replyTo = null;
    input.value = ''; autoResize(input); updateReplyHint();
    Store.setDraft(c.id, ''); renderChatList($('#searchInput').value);

    renderMessages(c); renderChatList($('#searchInput').value); scrollBottom(true);
    playSend(); U.haptic(10);

    if (c.id !== 'c_saved') {
      setTimeout(() => { Store.updateMessage(c.id, m.id, { status: 'delivered' }); refreshTick(m.id); }, 500);
      setTimeout(() => { Store.updateMessage(c.id, m.id, { status: 'read' }); refreshTick(m.id); }, 1300);

      Bot.respond(c.id, text, {
        onTyping: () => { $('#peerStatus').textContent = 'печатает…'; $('#peerStatus').classList.remove('offline'); },
        onStopTyping: () => refreshHeader(),
        onMessage: (ans) => {
          if (currentChatId === c.id) {
            Store.addMessage(c.id, ans);
            renderMessages(c);
            if ($('#messages').scrollHeight - $('#messages').scrollTop - $('#messages').clientHeight < 150) scrollBottom(true);
            else { unreadBelow++; updateScrollBadge(); }
            playPing();
          } else {
            Store.addMessage(c.id, ans);
            c.unread = (c.unread || 0) + 1; Store.save();
            if (!c.muted) playPing();
          }
          renderChatList($('#searchInput').value);
          notify(c, ans);
        },
      });
    }
  }

  function refreshTick(mid) {
    const node = document.querySelector(`.msg-row[data-mid="${mid}"] .ticks`);
    const c = Store.chat(currentChatId);
    const m = c && c.messages.find(x => x.id === mid);
    if (node && m) node.innerHTML = ticks(m.status);
  }

  function autoResize(input) { input.style.height = 'auto'; }
  function resetSendBtn() {
    $('#sendBtn').classList.remove('edit-mode');
    $('#sendBtn').innerHTML = '<i class="bi bi-send-fill"></i>';
  }

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
    updateReplyHint(); $('#msgInput').focus();
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
    editingId = null;
    resetSendBtn();
    $('#msgInput').value = '';
  }

  /* ---------- attachments ---------- */
  async function onPickImage(e) {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f || !currentChatId) return;
    try {
      pendingMedia = await U.compressImage(f, 1280, 0.8);
      send(); // автоотправка фото
    } catch (err) { toast('⚠️ Не удалось обработать изображение'); }
  }

  function downloadMedia(m) {
    const a = document.createElement('a');
    a.href = m.media;
    a.download = 'photo-' + m.ts + '.jpg';
    a.click();
  }

  function copyText(t) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(t).then(() => toast('📋 Скопировано')).catch(() => fallbackCopy(t));
    } else fallbackCopy(t);
  }
  function fallbackCopy(t) {
    const ta = el('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;left:-999px';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('📋 Скопировано'); } catch (e) { toast('⚠️ Не удалось скопировать'); }
    ta.remove();
  }

  /* ---------- emoji ---------- */
  const EMOJI_GROUPS = {
    '😀': ['😀','😂','🥹','😍','😎','🤔','😅','🙃','😉','😊','😇','🥳','😢','😡','🤯','😴','🤗','😱'],
    '👍': ['👍','👎','👏','🙏','💪','🤝','✌️','🤞','👌','🫶','🖐','☝️'],
    '❤️': ['❤️','🧡','💛','💚','💙','💜','🖤','💔','❣️','💯','💢','💤'],
    '🎉': ['🎉','🎊','🥂','🍕','☕','🍰','🎮','⚽','🚀','🔥','✨','⭐','🌙','☀️','🌈','🎵'],
  };
  function buildEmojiPanel() {
    const p = $('#emojiPanel');
    p.innerHTML = '';
    for (const key in EMOJI_GROUPS)
      for (const e of EMOJI_GROUPS[key]) {
        const b = el('button', '', e);
        b.addEventListener('click', () => { const i = $('#msgInput'); i.value += e; i.focus(); });
        p.appendChild(b);
      }
  }
  function toggleEmoji() { $('#emojiPanel').classList.toggle('hidden'); }

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
    document.querySelectorAll('.msg-row mark').forEach(m => m.replaceWith(m.textContent));
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
    if (row.scrollIntoView) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
        if (a === 'toggle-theme') {
          const t = Store.data.theme === 'dark' ? 'light' : 'dark';
          Store.setTheme(t); applyTheme(t);
        }
        if (a === 'settings') openSettings();
        if (a === 'saved') showStarred();
        if (a === 'archive') {
          showArchived = true;
          renderArchive();
          $('#archivePanel').classList.remove('hidden');
          $('#chatList').classList.add('hidden');
        }
        if (a === 'export') exportData();
        if (a === 'import') $('#importInput').click();
        if (a === 'clear-all') confirmModal('Очистить ВСЕ чаты? Это действие необратимо.', () => {
          Store.clearAll(); renderChatList(); if (currentChatId) renderMessages(Store.chat(currentChatId));
          toast('Все чаты очищены');
        });
        if (a === 'logout') { Store.logout(); location.reload(); }
        $('#drawer').classList.add('hidden');
      });
    });
    $('#importInput').addEventListener('change', importData);
  }

  function applyTheme(t) {
    document.body.classList.toggle('dark', t === 'dark');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = t === 'dark' ? '#181818' : '#0088cc';
  }
  function applyFont(v) {
    document.documentElement.style.fontSize = (16 * (v || 100) / 100) + 'px';
  }
  function applyWallpaper(w) {
    const box = $('#messages');
    box.className = 'messages wp-' + (w || 'pattern');
  }

  /* ==================== MODALS ==================== */
  function bindModals() {
    $('#modalOverlay').addEventListener('click', e => {
      if (e.target === $('#modalOverlay')) closeModal();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !$('#modalOverlay').classList.contains('hidden')) closeModal();
    });
  }
  function openModal(html) {
    $('#modalBox').innerHTML = '';
    $('#modalBox').appendChild(html);
    $('#modalOverlay').classList.remove('hidden');
  }
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

  function openSettings(section) {
    const box = el('div', 'modal-body settings');
    box.appendChild(el('div', 'modal-title', '⚙️ Настройки'));

    // ---- профиль ----
    const prof = el('div', 'profile-row');
    const pAv = avatarNodeMe('prof-avatar');
    pAv.title = 'Изменить фото';
    pAv.addEventListener('click', () => $('#myAvatarInput').click());
    const pInfo = el('div', 'prof-info');
    const nameInp = el('input'); nameInp.value = Store.data.me?.name || ''; nameInp.maxLength = 32; nameInp.placeholder = 'Ваше имя';
    nameInp.onchange = () => {
      const v = nameInp.value.trim();
      if (v) { Store.setMe(v); $('#drawerName').textContent = v; renderChatList(); toast('Имя обновлено ✅'); }
    };
    const bioInp = el('input'); bioInp.value = Store.data.me?.bio || ''; bioInp.maxLength = 80; bioInp.placeholder = 'О себе…';
    bioInp.onchange = () => { Store.setMyBio(bioInp.value.trim()); toast('Статус обновлён ✅'); };
    pInfo.append(nameInp, bioInp);
    prof.append(pAv, pInfo);
    box.appendChild(prof);

    const row = (label) => { const d = el('div', 'set-row'); d.appendChild(el('div', 'set-label', label)); const ctl = el('div', 'set-ctl'); d.appendChild(ctl); box.appendChild(d); return ctl; };

    // тема
    const themeSel = el('select');
    for (const [v, l] of [['light', 'Светлая'], ['dark', 'Тёмная']]) {
      const o = el('option'); o.value = v; o.textContent = l; if (Store.data.theme === v) o.selected = true; themeSel.appendChild(o);
    }
    themeSel.onchange = () => { Store.setTheme(themeSel.value); applyTheme(themeSel.value); };
    row('Оформление').appendChild(themeSel);

    // размер шрифта
    const fsWrap = el('div', 'font-ctl');
    const minus = el('button', 'btn-ghost sm', '−');
    const val = el('span', 'font-val', Store.data.fontScale + '%');
    const plus = el('button', 'btn-ghost sm', '+');
    const chFont = (d) => {
      const v = Math.max(85, Math.min(135, (Store.data.fontScale || 100) + d));
      Store.setFont(v); applyFont(v); val.textContent = v + '%';
    };
    minus.onclick = () => chFont(-5); plus.onclick = () => chFont(5);
    fsWrap.append(minus, val, plus);
    row('Размер шрифта').appendChild(fsWrap);

    // обои
    const wpSel = el('select');
    const WP_NAMES = { pattern: 'Классические (узор)', ocean: 'Океан', sunset: 'Закат', forest: 'Лес', dark: 'Тёмные', none: 'Без фона' };
    for (const w of Store.WALLPAPERS) {
      const o = el('option'); o.value = w; o.textContent = WP_NAMES[w] || w;
      if ((Store.data.wallpaper || 'pattern') === w) o.selected = true;
      wpSel.appendChild(o);
    }
    wpSel.onchange = () => { Store.setWallpaper(wpSel.value); applyWallpaper(wpSel.value); };
    row('Обои чата').appendChild(wpSel);

    // уведомления / звук / Enter
    const mkSwitch = (checked, onChange) => {
      const s = el('label', 'switch');
      const i = el('input'); i.type = 'checkbox'; i.checked = checked;
      const sl = el('span', 'slider');
      s.append(i, sl);
      i.onchange = () => onChange(i.checked);
      return s;
    };
    row('Уведомления').appendChild(mkSwitch(Store.data.notif !== false, v => {
      Store.setNotif(v);
      if (v && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    }));
    row('Звук сообщений').appendChild(mkSwitch(Store.data.sound !== false, v => Store.setSound(v)));
    row('Enter — отправка (иначе Shift+Enter)').appendChild(mkSwitch(Store.data.enterToSend !== false, v => Store.setEnterToSend(v)));

    const btns = el('div', 'modal-btns');
    const ok = el('button', 'btn-primary sm', 'Готово');
    ok.onclick = closeModal; btns.appendChild(ok); box.appendChild(btns);

    openModal(box);
    if (section === 'wallpaper') wpSel.focus();

    $('#myAvatarInput').onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try {
        const url = await U.compressImage(f, 256, 0.85);
        Store.setMyAvatar(url);
        const dAv = $('#drawerAvatar');
        dAv.style.backgroundImage = `url(${url})`; dAv.classList.add('avatar-img'); dAv.textContent = '';
        pAv.style.backgroundImage = `url(${url})`; pAv.classList.add('avatar-img'); pAv.textContent = '';
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
    d.style.background = 'var(--accent)';
    return d;
  }

  function showChatInfo(c) {
    const box = el('div', 'modal-body chat-info');
    const head = el('div', 'ci-head');
    const av = avatarNode(c, 'ci-avatar');
    head.appendChild(av);
    const nm = el('div');
    nm.appendChild(el('div', 'ci-name', esc(c.name)));
    nm.appendChild(el('div', 'ci-status', lastSeenText(c)));
    head.appendChild(nm);
    box.appendChild(head);

    const bio = el('div', 'ci-bio');
    bio.appendChild(el('div', 'ci-label', 'О себе'));
    const bioInp = el('input'); bioInp.value = c.bio || ''; bioInp.placeholder = 'Короткое описание…';
    bioInp.onchange = () => Store.setBio(c.id, bioInp.value.trim());
    bio.appendChild(bioInp);
    box.appendChild(bio);

    const stats = el('div', 'ci-stats');
    const cnt = c.messages.filter(m => !m.deleted).length;
    const photos = c.messages.filter(m => m.media && !m.deleted).length;
    stats.innerHTML = `<span>💬 ${cnt} сообщений</span><span>📷 ${photos} фото</span><span>🆔 ${esc(c.id)}</span>`;
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
    const payload = JSON.stringify({ app: 'teleport', version: 2, exportedAt: new Date().toISOString(), data: Store.data }, null, 2);
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
          localStorage.setItem('teleport_data_v3', JSON.stringify(Object.assign({}, obj.data)));
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
      try { new Notification(chat.name, { body: (msg.text || '📷 Фото').slice(0, 120), icon: 'icons/icon-192.png', tag: chat.id }); } catch (e) {}
    }
  }

  let audioCtx;
  function beep(freq, dur, gain, delay) {
    if (Store.data.sound === false) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const t = audioCtx.currentTime + (delay || 0);
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(audioCtx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) {}
  }
  function playSend() { beep(600, 0.08, 0.04); }
  function playPing() { beep(880, 0.12, 0.06); beep(1175, 0.14, 0.05, 0.1); }

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
      if (e.key === 'Escape' && !$('#msgSearchBar').classList.contains('hidden')) closeMsgSearch();
      if (e.key === 'Escape') document.querySelector('.lightbox')?.remove();
      if (e.key === 'Escape') $('#emojiPanel')?.classList.add('hidden');
    });
  }

  function registerSW() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  /* ==================== ADAPTIVE LAYOUT (Android / iOS / PC) ==================== */
  // Считаем боковой отступ для центрирования ленты на широких экранах и в «оконном» режиме.
  function bindResize() {
    const update = () => {
      const w = window.innerWidth;
      let pad = 0;
      if (w >= 1800) {                       // режим «окна»: контент центрируется внутри окна 1600px
        const chatW = Math.min(1600, w) - 380;
        pad = Math.max(0, (chatW - 940) / 2);
      } else if (w >= 1400) {                // обычный широкий десктоп
        pad = Math.max(0, (w - 380 - 1060) / 2);
      }
      document.documentElement.style.setProperty('--center-pad', Math.round(pad) + 'px');
    };
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    update();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
