/* ============ calls.js — аудио/видеозвонки (WebRTC, сигнализация через Net) ============
   Звонки работают между двумя пользователями одного сервера:
   • вызывающий собирает RTCPeerConnection и шлёт offer через WebSocket;
   • принимающий видит входящий звонок с кнопками «Ответить / Отклонить»;
   • media-потоки идут напрямую P2P (STUN: Google public). */
const Calls = (() => {
  const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

  let pc = null, localStream = null, remoteStream = null;
  let peer = null;            // { id, name, avatar }
  let kind = 'audio';         // audio | video
  let incoming = false;
  let ringingTimer = null;
  let ui = null;              // колбэки от app.js

  function cleanup() {
    clearTimeout(ringingTimer);
    try { if (pc) pc.close(); } catch (e) {}
    try { if (localStream) localStream.getTracks().forEach(t => t.stop()); } catch (e) {}
    pc = null; localStream = null; remoteStream = null; peer = null; incoming = false;
    if (ui && ui.onEnded) ui.onEnded();
  }

  async function getMedia(k) {
    const constraints = k === 'video'
      ? { audio: true, video: { width: { ideal: 640 }, height: { ideal: 480 } } }
      : { audio: true, video: false };
    return await navigator.mediaDevices.getUserMedia(constraints);
  }

  function makePC() {
    pc = new RTCPeerConnection(ICE);
    pc.onicecandidate = (ev) => { if (ev.candidate) Net.signal(peer.id, 'ice', ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate); };
    pc.ontrack = (ev) => {
      remoteStream = ev.streams[0];
      if (ui && ui.onRemote) ui.onRemote(remoteStream, kind);
    };
    pc.onconnectionstatechange = () => {
      if (!pc) return;
      if (ui && ui.onState) ui.onState(pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') cleanup();
    };
    return pc;
  }

  /* ---------- исходящий ---------- */
  async function start(targetUser, k) {
    if (pc) { ui && ui.toast && ui.toast('Вы уже в звонке'); return; }
    kind = k || 'audio';
    try { localStream = await getMedia(kind); }
    catch (e) { ui && ui.denied && ui.denied(); cleanupHard(); return; }
    peer = targetUser; incoming = false;
    makePC();
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    ui && ui.onOutgoing && ui.onOutgoing(peer, kind, localStream);
    Net.call(peer.id, kind);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    Net.signal(peer.id, 'offer', { sdp: offer.sdp, kind });
    // если абонент не ответит за 35 сек — завершаем
    ringingTimer = setTimeout(() => { Net.endCall(peer.id); cleanup(); }, 35000);
  }

  /* ---------- входящий ---------- */
  function onIncoming(from, pendingOfferData) {
    peer = from; incoming = true;
    ui && ui.onIncoming && ui.onIncoming(peer, (pendingOfferData && pendingOfferData.kind) || 'audio');
  }

  async function accept() {
    if (!peer) return;
    try { localStream = await getMedia(kind); }
    catch (e) { decline(); return; }
    makePC();
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    Net.acceptCall(peer.id);
    ui && ui.onConnectedUI && ui.onConnectedUI(peer, kind, localStream);
  }

  function decline() {
    if (peer) Net.declineCall(peer.id);
    cleanup();
  }
  function hangup() {
    if (peer) Net.endCall(peer.id);
    cleanup();
  }
  /* удалённые события */
  function endRemote() { cleanup(); }
  function declineRemote() { cleanup(); }
  function cleanupHard() { pc = null; localStream = null; }

  /* ---------- обработка сигналов от Net ---------- */
  async function handleSignal(from, sKind, data) {
    if (!pc && sKind !== 'offer') return;
    try {
      if (sKind === 'offer') {
        kind = (data && data.kind) || 'audio';
        if (!incoming) return;                 // игнор без состояния входящего
        if (!pc) makePC();
        await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        Net.signal(from.id, 'answer', { sdp: answer.sdp });
      } else if (sKind === 'answer') {
        await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        clearTimeout(ringingTimer);
        ui && ui.onConnectedUI && ui.onConnectedUI(peer, kind, localStream);
      } else if (sKind === 'ice') {
        await pc.addIceCandidate(new RTCIceCandidate(data));
      }
    } catch (e) { console.warn('signal error', e); }
  }

  /* ---------- управление во время звонка ---------- */
  function toggleMute() {
    if (!localStream) return false;
    const a = localStream.getAudioTracks()[0]; if (!a) return false;
    a.enabled = !a.enabled; return a.enabled;
  }
  function toggleCam() {
    if (!localStream) return false;
    const v = localStream.getVideoTracks()[0]; if (!v) return false;
    v.enabled = !v.enabled; return v.enabled;
  }
  function speaker(on) {
    const el = document.querySelector('#remoteAudio');
    if (el && el.setSinkId && window.AudioContext) { /* best-effort */ }
  }

  return {
    init(callbacks) { ui = callbacks; },
    start, accept, decline, hangup, onIncoming, handleSignal,
    endRemote, declineRemote,
    toggleMute, toggleCam, speaker,
    get active() { return !!pc; },
    get peerInfo() { return peer; },
    get callKind() { return kind; },
  };
})();
