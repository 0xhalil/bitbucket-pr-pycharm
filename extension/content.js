(() => {
  'use strict';

  function ctx() {
    // /<workspace>/<repo>/pull-requests/<id>/...
    const p = location.pathname.split('/').filter(Boolean);
    const i = p.indexOf('pull-requests');
    if (i < 2) return null;
    return { workspace: p[i - 2], repo: p[i - 1], pr: p[i + 1] || '' };
  }

  function fileFromHash() {
    // #chg-src/modules/... (Bitbucket diff anchor formati)
    const h = location.hash || '';
    const m = h.match(/chg-([^#?]+)/);
    if (!m) return { file: '', line: 1 };
    let rest = decodeURIComponent(m[1]);
    let line = 1;
    const lm = rest.match(/[#:]L?ines?-(\d+)|[#:]L(\d+)$/i);
    if (lm) { line = parseInt(lm[1] || lm[2], 10) || 1; rest = rest.slice(0, lm.index); }
    return { file: rest.replace(/:\d+.*$/, ''), line };
  }

  function branches() {
    // best-effort: PR header'indan source/dest branch; bulunamazsa helper mevcut branch'i acar
    let source = '', dest = '';
    const q = (s) => document.querySelector(s);
    const srcEl = q('[data-qa*="source-branch"]') || q('[data-testid*="source-branch"]');
    const dstEl = q('[data-qa*="destination-branch"]') || q('[data-testid*="destination-branch"]');
    if (srcEl) source = srcEl.textContent.trim().split(/\s+/)[0];
    if (dstEl) dest = dstEl.textContent.trim().split(/\s+/)[0];
    if (!source) {
      const txt = (document.body?.innerText || '').slice(0, 20000);
      const m = txt.match(/from\s+([\w\-./]+)\s+(?:into|to|→)\s+([\w\-./]+)/i);
      if (m) { source = m[1]; dest = m[2]; }
    }
    return { source, dest };
  }

  function callHelper(params, needFile) {
    const c = ctx();
    if (!c) return toast('Repo/PR parse edilemedi');
    if (needFile && !params.file) return toast('Once bir dosyaya tikla (URL hash inde dosya yok)');
    toast('PyCharm\u2019a gonderiliyor...');
    chrome.runtime.sendMessage(
      { type: 'bb-pycharm-open', params: { workspace: c.workspace, repo: c.repo, pr: c.pr, ...params } },
      (res) => {
        if (chrome.runtime.lastError) return toast('Extension hatasi: ' + chrome.runtime.lastError.message);
        if (!res || res.httpStatus === 0) return toast('Helper calismiyor! Terminalde: python3 pycharm-pr-helper.py');
        const j = res.body || {};
        toast(j.ok ? `Acildi: ${j.note ? j.note + ' — ' : ''}${j.file || j.project}${j.line ? ':' + j.line : ''}`
                   : `Hata: ${j.error || res.httpStatus}`);
      }
    );
  }

  function openFile() {
    const { file, line } = fileFromHash();
    const { source, dest } = branches();
    callHelper({ file, line: String(line), source, dest }, true);
  }

  function openDiff() {
    const { file, line } = fileFromHash();
    const { source, dest } = branches();
    // file varsa dosya diff'i, yoksa tum PR'in klasor diff'i
    callHelper({ view: 'diff', file, line: String(line), source, dest }, false);
  }

  function openProject() {
    const { source, dest } = branches();
    callHelper({ source, dest }, false); // file yok -> helper tum projeyi acar
  }

  function toast(msg) {
    let el = document.getElementById('bb-pycharm-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'bb-pycharm-toast';
      el.style.cssText = 'position:fixed;bottom:120px;right:20px;z-index:99999;background:#172b4d;color:#fff;padding:10px 14px;border-radius:8px;font-size:13px;max-width:340px;box-shadow:0 4px 14px rgba(0,0,0,.3)';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.style.display = 'none'), 4000);
  }

  function mount() {
    if (document.getElementById('bb-pycharm-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'bb-pycharm-bar';
    bar.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:99999;display:flex;gap:8px';
    const mk = (label, title, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = title;
      b.style.cssText = 'background:#0052cc;color:#fff;border:0;border-radius:8px;padding:10px 14px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.3)';
      b.onclick = fn;
      return b;
    };
    bar.appendChild(mk('\u25B6 Dosyayı PyCharm\u2019da Aç', 'Diff teki dosyayi PR branch inde PyCharm da acar', openFile));
    bar.appendChild(mk('\u25B6 Projeyi Aç', 'PR branch ini worktree olarak acip tum projeyi PyCharm da acar', openProject));
    bar.appendChild(mk('\u25B6 Diff\u2019i Aç', 'PyCharm diff penceresinde once/sonra karsilastirmasi acar (dosyadaysan dosya, degilsen tum PR)', openDiff));
    document.body.appendChild(bar);
  }

  mount();
  setInterval(mount, 3000); // Bitbucket SPA navigasyonunda butonlari koru
})();
