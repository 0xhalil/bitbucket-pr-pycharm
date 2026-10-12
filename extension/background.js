// Forwards extension requests to the local helper.
// The service worker performs the fetch to http://127.0.0.1 so the
// https Bitbucket page never has to call an insecure origin directly.
const HELPER = 'http://127.0.0.1:8765';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'bb-pycharm-open') return;
  const path = msg.path || '/open';
  const url = HELPER + path + '?' + new URLSearchParams(msg.params).toString();
  fetch(url)
    .then(async (r) => {
      let body = null;
      try { body = await r.json(); } catch { /* error reported below */ }
      sendResponse({ httpStatus: r.status, body });
    })
    .catch((e) => sendResponse({ httpStatus: 0, error: String(e) }));
  return true; // async response
});
