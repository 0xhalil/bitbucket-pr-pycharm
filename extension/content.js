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

  // --- branch tespiti ---

  function autoBranches() {
    // 1) data-qa/testid (eski seciciler)
    const q = (s) => document.querySelector(s);
    let source = '', dest = '';
    const srcEl = q('[data-qa*="source-branch"]') || q('[data-testid*="source-branch"]');
    const dstEl = q('[data-qa*="destination-branch"]') || q('[data-testid*="destination-branch"]');
    if (srcEl) source = (srcEl.textContent || '').trim().split(/\s+/)[0];
    if (dstEl) dest = (dstEl.textContent || '').trim().split(/\s+/)[0];
    if (source && dest) return { source, dest };

    // 2b) chip'lerin title/aria-label'indeki TAM isim (ekranda "..." ile kesik gorunebilir)
    // + ok sonrasindaki hedef
    const seenTitles = [];
    const titled = document.querySelectorAll('[title],[aria-label]');
    let scanned = 0;
    for (const el of titled) {
      if (scanned++ > 3000) break;
      const t = ((el.getAttribute && (el.getAttribute('title') || el.getAttribute('aria-label'))) || '').trim();
      if (t && t.length < 250 && /^[\w\-.~]+(\/[\w\-.~]+)+$/.test(t) && !seenTitles.includes(t)) seenTitles.push(t);
      if (seenTitles.length >= 4) break;
    }
    const bodyTxt = (document.body?.innerText || '').slice(0, 20000);
    const arrowDest = bodyTxt.match(/→\s*([\w\-./…]+)/) || bodyTxt.match(/(?:into|to)\s+([\w\-./…]+)/i);
    if (seenTitles.length && arrowDest) return { source: seenTitles[0], dest: arrowDest[1] };

    // 2c) sayfadaki branch linkleri: /<ws>/<repo>/branch/<isim> (PR header'da kaynak once, hedef sonra)
    const c = ctx();
    const seen = [];
    const anchors = document.querySelectorAll('a[href*="/branch/"]');
    for (const a of anchors) {
      const href = (a.getAttribute && a.getAttribute('href')) || a.href || '';
      try {
        const u = new URL(href, location.origin);
        const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/branch\/(.+)$/);
        if (!m || m[1] !== c.workspace || m[2] !== c.repo) continue;
        const name = decodeURIComponent(m[3]);
        if (name && !seen.includes(name)) seen.push(name);
      } catch { /* yoksay */ }
      if (seen.length >= 2) break;
    }
    if (seen.length >= 2) return { source: seen[0], dest: seen[1] };

    // 3) header metnindeki "X → Y" / "from X into Y" kalibi
    const txt = (document.body?.innerText || '').slice(0, 20000);
    let m = txt.match(/from\s+([\w\-./]+)\s+(?:into|to|→)\s+([\w\-./]+)/i)
         || txt.match(/([\w\-./]+)\s+→\s+([\w\-./]+)/);
    if (m) return { source: m[1], dest: m[2] };

    return { source, dest };
  }

  function storageKey(c) {
    return `bb-branches:${c.workspace}/${c.repo}/${c.pr}`;
  }

  function askBranches(auto) {
    // Otomatik tespit basarisizsa sayfada mini form goster, bir kez sor, hatirla.
    return new Promise((resolve, reject) => {
      const old = document.getElementById('bb-pycharm-form');
      if (old) old.remove();
      const box = document.createElement('div');
      box.id = 'bb-pycharm-form';
      box.style.cssText = 'position:fixed;bottom:70px;right:20px;z-index:100000;background:#fff;color:#172b4d;border:1px solid #dfe1e6;border-radius:8px;padding:12px;font-size:13px;box-shadow:0 4px 14px rgba(0,0,0,.3);display:flex;flex-direction:column;gap:8px;width:280px';
      box.innerHTML = `<b>Branch'ler okunamadı</b>
        <span style="color:#5e6c84">PR sayfasının üstünde yazan kaynak ve hedef branch'i bir kez gir, bu PR için hatırlayayım.</span>`;
      const mkInput = (label, value) => {
        const l = document.createElement('label');
        l.style.cssText = 'display:flex;flex-direction:column;gap:4px;font-weight:600';
        l.textContent = label;
        const inp = document.createElement('input');
        inp.value = value || '';
        inp.style.cssText = 'border:1px solid #dfe1e6;border-radius:4px;padding:6px 8px;font-size:13px';
        l.appendChild(inp);
        return { l, inp };
      };
      const s = mkInput('Kaynak (PR\'ın dalı)', auto.source);
      const d = mkInput('Hedef (merge edilecek dal)', auto.dest);
      box.appendChild(s.l);
      box.appendChild(d.l);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
      const cancel = document.createElement('button');
      cancel.textContent = 'Vazgeç';
      const ok = document.createElement('button');
      ok.textContent = 'Aç';
      ok.style.cssText = 'background:#0052cc;color:#fff;border:0;border-radius:4px;padding:6px 14px;cursor:pointer';
      cancel.style.cssText = 'background:transparent;border:0;cursor:pointer;color:#5e6c84';
      cancel.onclick = () => { box.remove(); reject(new Error('cancel')); };
      ok.onclick = () => {
        const v = { source: s.inp.value.trim(), dest: d.inp.value.trim() };
        if (!v.source || !v.dest) return;
        box.remove();
        const c = ctx();
        chrome.storage.local.set({ [storageKey(c)]: v });
        resolve(v);
      };
      row.appendChild(cancel);
      row.appendChild(ok);
      box.appendChild(row);
      document.body.appendChild(box);
      // input yaratamayan test ortaminda asili kalma
      if (!s.inp || typeof s.inp.focus !== 'function') { box.remove(); reject(new Error('no-dom')); }
    });
  }

  async function getBranches() {
    const auto = autoBranches();
    if (auto.source && auto.dest) return auto;
    const c = ctx();
    try {
      const stored = await chrome.storage.local.get(storageKey(c));
      const v = stored[storageKey(c)];
      if (v?.source && v?.dest) return v;
    } catch { /* storage yoksa forma dus */ }
    return askBranches(auto);
  }

  // --- helper cagrisi ---

  function callHelper(params, needFile) {
    const c = ctx();
    if (!c) return toast('Repo/PR parse edilemedi');
    if (needFile && !params.file) return toast('Once bir dosyaya tikla (URL hash inde dosya yok)');
    toast('PyCharm\u2019a gonderiliyor...');
    chrome.runtime.sendMessage(
      { type: 'bb-pycharm-open', params: { workspace: c.workspace, repo: c.repo, pr: c.pr, ...params } },
      (res) => {
        if (chrome.runtime.lastError) return toast('Extension hatasi: ' + chrome.runtime.lastError.message);
        if (!res || res.httpStatus === 0) return toast('Helper calismiyor! Terminalde: ~/bb-pycharm icin ./install.sh');
        const j = res.body || {};
        toast(j.ok ? `Acildi: ${j.note ? j.note + ' — ' : ''}${j.file || j.project}${j.line ? ':' + j.line : ''}`
                   : `Hata: ${j.error || res.httpStatus}`);
      }
    );
  }

  async function openFile() {
    try {
      const { file, line } = fileFromHash();
      if (!file) return toast('Once bir dosyaya tikla (URL hash inde dosya yok)');
      const { source, dest } = await getBranches();
      toast(`${source} → ${dest}`);
      callHelper({ file, line: String(line), source, dest }, true);
    } catch { /* vazgecildi */ }
  }

  async function openProject() {
    try {
      const { source, dest } = await getBranches();
      toast(`${source} → ${dest}`);
      callHelper({ source, dest }, false);
    } catch { /* vazgecildi */ }
  }

  async function openDiff() {
    try {
      const { file, line } = fileFromHash();
      const { source, dest } = await getBranches();
      toast(`${source} → ${dest}`);
      // file varsa dosya diff'i, yoksa tum PR'in klasor diff'i
      callHelper({ view: 'diff', file, line: String(line), source, dest }, false);
    } catch { /* vazgecildi */ }
  }

  function domDump() {
    // Branch chip'lerinin gercek isaretlemesini teshis icin topla (t tam isim icerebilir).
    const links = [...document.querySelectorAll('a[href*="/branch/"]')].map((a) => a.outerHTML.slice(0, 500));
    const titles = [...new Set([...document.querySelectorAll('[title],[aria-label]')]
      .map((e) => e.getAttribute('title') || e.getAttribute('aria-label'))
      .filter((t) => t && t.length < 200))].slice(0, 60);
    const txt = document.body?.innerText || '';
    const mi = txt.indexOf('→');
    const around = mi >= 0 ? txt.slice(Math.max(0, mi - 300), mi + 300) : txt.slice(0, 2000);
    let container = '';
    try {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n, g = 0;
      while ((n = w.nextNode()) && g++ < 20000) {
        if ((n.nodeValue || '').includes('→')) {
          let p = n.parentElement;
          for (let i = 0; i < 4 && p; i++) p = p.parentElement;
          container = ((p || n.parentElement)?.outerHTML || '').slice(0, 6000);
          break;
        }
      }
    } catch { /* yoksay */ }
    return JSON.stringify({ url: location.href, links, titles, around, container }, null, 1);
  }

  async function copyDom() {
    try {
      await navigator.clipboard.writeText(domDump());
      toast('Kopyalandi! Sohbete yapistir, selector yazayim.');
    } catch {
      toast('Kopyalanamadi (pano izni yok)');
    }
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
    bar.appendChild(mk('DOM Kopyala', 'Branch chip lerinin HTML ini panoya kopyala (teshis icin)', copyDom));
    document.body.appendChild(bar);
  }

  mount();
  setInterval(mount, 3000); // Bitbucket SPA navigasyonunda butonlari koru
})();
