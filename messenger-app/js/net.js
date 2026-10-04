/* ============ net.js — сетевой слой: аккаунты + живые чаты (WebSocket) ============
   Всё общение с реальными людьми и сервером концентрируется здесь.
   Если сервер недоступен — приложение остаётся локальным, ничего не ломается. */
const Net = (() => {
  let ws = null;
  let connected = false;
  let reconnectTimer = null;
  let reconnectDelay = 1000;
  let joinedChat = null;
  let typingStopTimer = null;
  let token = localStorage.getItem('teleport_token') || null;

  const handlers = {
    onMessage: null,     // (data) => void — входящее сообщение от живого человека
    onEdit: null,        // ({chatId, mid, text})
    onDelete: null,      // ({chatId, mid})
    onPeers: null,       // (list:[{name,id}])
    onTyping: null,      // (on, who, whoId)
    onRead: null,        // (byId, byName)
    onConn: null,        // (connected)
    onAuth: null,        // (user|null) — результат авторизации/сброса сессии
    onSync: null,        // (chats:[{chatId,messages:[...]}]) — история с сервера при входе
    onContactAdded: null,// ({from, chatId}) — вас добавили в контакты
    onCallIncoming: null,// ({from}) — входящий звонок
    onCallAccepted: null,// ({from})
    onCallDeclined: null,// ({from})
    onCallEnded: null,   // ({from})
    onSignal: null,      // ({from, kind, data}) — WebRTC-сигналы
  };

  function emit(name, ...args) {
    const fn = handlers[name];
    if (fn) try { fn(...args); } catch (e) { console.warn('net handler', e); }
  }

  /* ---------- REST API ---------- */
  async function api(pathname, opts = {}) {
    const headers = Object.assign({}, opts.headers);
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (opts.body && typeof opts.body !== 'string') {
      opts.body = JSON.stringify(opts.body);
      headers['Content-Type'] = 'application/json';
    }
    const r = await fetch(pathname, Object.assign({ headers }, opts));
    return await r.json().catch(() => ({ ok: false, error: 'Сервер недоступен' }));
  }

  const Auth = {
    get token() { return token; },
    setToken(t) {
      token = t || null;
      if (t) localStorage.setItem('teleport_token', t); else localStorage.removeItem('teleport_token');
    },
    codePhone: (phone) => api('/api/code_phone', { method: 'POST', body: { phone } }),
    loginPhone: (phone, code, name) => api('/api/login_phone', { method: 'POST', body: { phone, code, name } }),
    signupEmail: (b) => api('/api/signup_email', { method: 'POST', body: b }),
    loginEmail: (email, password) => api('/api/login_email', { method: 'POST', body: { email, password } }),
    forgotPassword: (b) => api('/api/forgot_password', { method: 'POST', body: b }),
    oauthLink: (prov) => api('/api/oauth/' + prov),            // {url} или {demo, token, user}
    me: () => api('/api/me'),
    profile: (patch) => api('/api/profile', { method: 'POST', body: patch }),
    searchUsers: (q) => api('/api/search_users?q=' + encodeURIComponent(q)),
    logout() { Auth.setToken(null); },
  };

  /* ---------- WebSocket ---------- */
  function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }
  function send(obj) {
    if (connected && ws && ws.readyState === 1) {
      try { ws.send(JSON.stringify(obj)); return true; } catch (e) {}
    }
    return false;
  }
  function connect() {
    if (!token) return;                 // без аккаунта live-функции не нужны
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    if (!('WebSocket' in window)) return;
    try { ws = new WebSocket(wsUrl()); } catch (e) { scheduleReconnect(); return; }

    ws.onopen = () => {
      connected = true;
      reconnectDelay = 1000;
      send({ t: 'auth', token });
      if (joinedChat) send({ t: 'join', chatId: joinedChat });
      emit('onConn', true);
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      switch (m.t) {
        case 'auth_ok':   emit('onAuth', m.me); break;
        case 'auth_fail': Auth.setToken(null); emit('onAuth', null); break;
        case 'sync':      emit('onSync', m.chats || []); break;
        case 'msg':       emit('onMessage', m); break;
        case 'edit':      emit('onEdit', m); break;
        case 'del':       emit('onDelete', m); break;
        case 'peers':     emit('onPeers', Array.isArray(m.online) ? m.online : []); break;
        case 'typing':    emit('onTyping', !!m.on, m.who || 'Собеседник', m.whoId); break;
        case 'read':      emit('onRead', m.by, m.byName); break;
        case 'contact_added': emit('onContactAdded', { from: m.from, chatId: m.chatId }); break;
        case 'call-incoming': emit('onCallIncoming', { from: m.from }); break;
        case 'call-accepted': emit('onCallAccepted', { from: m.from }); break;
        case 'call-declined': emit('onCallDeclined', { from: m.from }); break;
        case 'call-ended':    emit('onCallEnded', { from: m.from }); break;
        case 'signal':        emit('onSignal', { from: m.from, kind: m.kind, data: m.data }); break;
      }
    };
    ws.onclose = () => { connected = false; emit('onConn', false); scheduleReconnect(); };
    ws.onerror = () => { try { ws.close(); } catch (e) {} };
  }
  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => connect(), Math.min(reconnectDelay, 15000));
    reconnectDelay = Math.min(reconnectDelay * 1.7, 15000);
  }

  /* ---------- публичный API ---------- */
  return {
    handlers, Auth,
    get connected() { return connected; },
    get live() { return !!token; },
    connect,

    join(chatId) { joinedChat = chatId; send({ t: 'join', chatId }); },
    sendMessage(data) { return send(Object.assign({ t: 'msg' }, data)); },
    edit(chatId, mid, text) { return send({ t: 'edit', chatId, mid, text }); },
    delMsg(chatId, mid) { return send({ t: 'del', chatId, mid }); },
    markRead(chatId) { send({ t: 'read', chatId }); },
    addContact(peerUserId, chatId) { send({ t: 'contacts:add', peerUserId, chatId }); },

    typing(on) {
      if (!joinedChat) return;
      send({ t: 'typing', chatId: joinedChat, on });
      clearTimeout(typingStopTimer);
      if (on) typingStopTimer = setTimeout(() => this.typing(false), 2500);
    },

    /* --- звонки (WebRTC-сигнализация через сервер) --- */
    call(to, kind) { send({ t: 'call', to, kind: kind || 'audio' }); },
    acceptCall(to) { send({ t: 'call-accept', to }); },
    declineCall(to) { send({ t: 'call-decline', to }); },
    endCall(to) { send({ t: 'call-end', to }); },
    signal(to, kind, data) { send({ t: 'signal', to, kind, data }); },
  };
})();
