/* ============ utils.js — общие утилиты (globalThis.U) ============ */
(function () {
  const U = {};

  U.esc = function (s) {
    return (s == null ? '' : String(s)).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  };

  U.trunc = (s, n) => { s = s || ''; return s.length > n ? s.slice(0, n) + '…' : s; };

  U.firstLetter = (name) => (name || '?').trim().charAt(0).toUpperCase();

  U.fmtTime = function (ts) {
    const d = new Date(ts), now = new Date();
    if (d.toDateString() === now.toDateString())
      return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const y = new Date(now); y.setDate(y.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'вчера';
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  };

  U.fmtDateLabel = function (ts) {
    const d = new Date(ts), now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Сегодня';
    const y = new Date(now); y.setDate(y.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Вчера';
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  };

  U.fmtBytes = function (n) {
    if (n < 1024) return n + ' Б';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' КБ';
    return (n / 1048576).toFixed(1) + ' МБ';
  };

  /* авто-ссылки + перенос строк; вход уже экранирован */
  U.linkifyBr = function (safeHtml) {
    return safeHtml
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
      .replace(/\n/g, '<br>');
  };

  /* сжатие изображения в dataURL (JPEG/PNG для прозрачных) */
  U.compressImage = function (file, maxDim, quality) {
    maxDim = maxDim || 1280; quality = quality || 0.8;
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = reject;
      fr.onload = () => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          const k = Math.min(1, maxDim / Math.max(img.width, img.height));
          const cv = document.createElement('canvas');
          cv.width = Math.round(img.width * k);
          cv.height = Math.round(img.height * k);
          const ctx = cv.getContext('2d');
          const isPng = /png|webp|gif|svg/i.test(file.type || '');
          if (!isPng) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); }
          ctx.drawImage(img, 0, 0, cv.width, cv.height);
          resolve(isPng ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', quality));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  };

  /* определение мобильного устройства (Android / iOS / Windows Phone / Kindle) */
  U.isMobile = function () {
    return /android|iphone|ipad|ipod|windows phone|blackberry|bb10|opera mini|iemobile|kindel|silk/i.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS 13+
  };

  /* тактильный отклик (вибрация) — Android WebView/Chrome; на iOS безопасно игнорируется */
  U.haptic = function (ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms || 8); } catch (e) {}
  };

  window.U = U;
})();
