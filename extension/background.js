// Bitbucket PR sayfasindan local helper'a istek gonderir.
// (https sayfadan http://127.0.0.1'e fetch'i service worker yapar.)
const HELPER = 'http://127.0.0.1:8765';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'bb-pycharm-open') return;
  const url = HELPER + '/open?' + new URLSearchParams(msg.params).toString();
  fetch(url)
    .then(async (r) => {
      let body = null;
      try { body = await r.json(); } catch { /* hata mesaji asagida */ }
      sendResponse({ httpStatus: r.status, body });
    })
    .catch((e) => sendResponse({ httpStatus: 0, error: String(e) }));
  return true; // async cevap
});
