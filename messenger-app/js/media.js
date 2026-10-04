/* ============ media.js — запись видеосообщений («кружков») ============
   API: MediaRecorderCircle.start({ onFrame, onStop }) / .stop() / .cancel() */
const CircleRecorder = (() => {
  let stream = null, recorder = null, chunks = [], timer = null, t0 = 0, raf = 0;
  let videoEl = null, canvas = null, ctx = null, facing = 'user';

  const pickMime = () => {
    const list = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    for (const m of list) if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
    return '';
  };

  async function start(previewVideo) {
    stopAll();
    facing = 'user';
    videoEl = previewVideo;
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'user' }, width: { ideal: 720 }, height: { ideal: 720 } },
      audio: true,
    });
    videoEl.srcObject = stream;
    await videoEl.play().catch(() => {});

    const mime = pickMime();
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 1_200_000 } : undefined);
    chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.start(250);
    t0 = Date.now();
    timer = setInterval(() => {
      const s = (Date.now() - t0) / 1000;
      if (typeof CircleRecorder.onTick === 'function') CircleRecorder.onTick(s);
      if (s >= 60) stop(); // жёсткий лимит — 60 секунд
    }, 250);
    return { kind: mime || 'video/webm' };
  }

  function flip() {
    if (!stream) return;
    facing = facing === 'user' ? 'environment' : 'user';
    const vs = stream.getVideoTracks();
    if (vs[0] && vs[0].applyConstraints) {
      vs[0].applyConstraints({ advanced: [{ facingMode: facing }] }).catch(() => {});
    }
    return facing;
  }

  function stop() {
    return new Promise((resolve) => {
      if (!recorder || recorder.state === 'inactive') { resolve(null); return; }
      recorder.onstop = () => {
        const type = (recorder.mimeType || 'video/webm').split(';')[0];
        const blob = new Blob(chunks, { type });
        cleanup();
        resolve({ blob, duration: Math.round((Date.now() - t0) / 1000 * 10) / 10, poster: snapshot() });
      };
      try { recorder.stop(); } catch (e) { cleanup(); resolve(null); }
    });
  }

  function cancel() { stopAll(); }

  function snapshot() {
    try {
      if (!videoEl || !videoEl.videoWidth) return null;
      if (!canvas) { canvas = document.createElement('canvas'); ctx = canvas.getContext('2d'); }
      const size = Math.min(videoEl.videoWidth, videoEl.videoHeight);
      canvas.width = 168; canvas.height = 168;
      ctx.drawImage(videoEl, (videoEl.videoWidth - size) / 2, (videoEl.videoHeight - size) / 2, size, size, 0, 0, 168, 168);
      return canvas.toDataURL('image/jpeg', 0.7);
    } catch (e) { return null; }
  }

  function cleanup() {
    clearInterval(timer); cancelAnimationFrame(raf); timer = null;
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    if (videoEl) { try { videoEl.pause(); } catch (e) {} videoEl.srcObject = null; }
    recorder = null; chunks = [];
  }
  function stopAll() { if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch (e) {} } cleanup(); }

  return { start, stop, cancel, flip, get recording() { return !!recorder && recorder.state === 'recording'; }, onTick: null };
})();
