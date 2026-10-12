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
    // #chg-src/modules/... (Bitbucket diff anchor format)
    const h = location.hash || '';
    const m = h.match(/chg-([^#?]+)/);
    if (!m) return { file: '', line: 1 };
    let rest = decodeURIComponent(m[1]);
    let line = 1;
    const lm = rest.match(/[#:]L?ines?-(\d+)|[#:]L(\d+)$/i);
    if (lm) { line = parseInt(lm[1] || lm[2], 10) || 1; rest = rest.slice(0, lm.index); }
    return { file: rest.replace(/:\d+.*$/, ''), line };
  }

  // --- branch detection ---

  function autoBranches() {
    // 0) "Branch: <name>" labels in the PR header (full names, untruncated) — primary method
    try {
      const labels = [...(document.body?.innerText || '').matchAll(/Branch:\s*([^\s]+)/g)].map((x) => x[1]);
      if (labels.length >= 2) return { source: labels[0], dest: labels[1] };
    } catch { /* ignore */ }

    // 1) data-qa/testid (older selectors)
    const q = (s) => document.querySelector(s);
    let source = '', dest = '';
    const srcEl = q('[data-qa*="source-branch"]') || q('[data-testid*="source-branch"]');
    const dstEl = q('[data-qa*="destination-branch"]') || q('[data-testid*="destination-branch"]');
    if (srcEl) source = (srcEl.textContent || '').trim().split(/\s+/)[0];
    if (dstEl) dest = (dstEl.textContent || '').trim().split(/\s+/)[0];
    if (source && dest) return { source, dest };

    // 2b) FULL name in chip title/aria-label (may render truncated with "..." on screen)
    // + destination after the arrow
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

    // 2c) branch links on the page: /<ws>/<repo>/branch/<name> (source first, dest second in PR header)
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
      } catch { /* ignore */ }
      if (seen.length >= 2) break;
    }
    if (seen.length >= 2) return { source: seen[0], dest: seen[1] };

    // 3) "X → Y" / "from X into Y" pattern in header text
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
    // Auto-detection failed: show a small inline form, ask once, remember it.
    return new Promise((resolve, reject) => {
      const old = document.getElementById('bb-pycharm-form');
      if (old) old.remove();
      const box = document.createElement('div');
      box.id = 'bb-pycharm-form';
      box.style.cssText = 'position:fixed;bottom:70px;right:20px;z-index:100000;background:#fff;color:#172b4d;border:1px solid #dfe1e6;border-radius:8px;padding:12px;font-size:13px;box-shadow:0 4px 14px rgba(0,0,0,.3);display:flex;flex-direction:column;gap:8px;width:280px';
      box.innerHTML = `<b>Could not read branches</b>
        <span style="color:#5e6c84">Enter the source and destination branches shown at the top of the PR page once — I'll remember them for this PR.</span>`;
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
      const s = mkInput('Source (PR branch)', auto.source);
      const d = mkInput('Destination (merge target)', auto.dest);
      box.appendChild(s.l);
      box.appendChild(d.l);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
      const cancel = document.createElement('button');
      cancel.textContent = 'Cancel';
      const ok = document.createElement('button');
      ok.textContent = 'Open';
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
      // don't hang in test envs that can't create inputs
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
    } catch { /* fall through to the form when storage is unavailable */ }
    return askBranches(auto);
  }

  // --- helper calls ---

  function callHelper(params, needFile) {
    const c = ctx();
    if (!c) return toast('Could not parse repo/PR');
    if (needFile && !params.file) return toast('Click a file first (no file in URL hash)');
    toast('Sending to PyCharm…');
    chrome.runtime.sendMessage(
      { type: 'bb-pycharm-open', params: { workspace: c.workspace, repo: c.repo, pr: c.pr, ...params } },
      (res) => {
        if (chrome.runtime.lastError) return toast('Extension error: ' + chrome.runtime.lastError.message);
        if (!res || res.httpStatus === 0) return toast('Helper is not running! Run ./install.sh in ~/bb-pycharm\'s source repo');
        const j = res.body || {};
        toast(j.ok ? `Opened: ${j.note ? j.note + ' — ' : ''}${j.file || j.project}${j.line ? ':' + j.line : ''}`
                   : `Error: ${j.error || res.httpStatus}`);
      }
    );
  }

  async function openFile() {
    try {
      const { file, line } = fileFromHash();
      if (!file) return toast('Click a file first (no file in URL hash)');
      const { source, dest } = await getBranches();
      toast(`${source} → ${dest}`);
      callHelper({ file, line: String(line), source, dest }, true);
    } catch { /* cancelled */ }
  }

  async function openProject() {
    try {
      const { source, dest } = await getBranches();
      toast(`${source} → ${dest}`);
      callHelper({ source, dest }, false);
    } catch { /* cancelled */ }
  }

  async function openDiff() {
    try {
      const { file, line } = fileFromHash();
      const { source, dest } = await getBranches();
      toast(`${source} → ${dest}`);
      // file diff when on a file, whole-PR directory diff otherwise
      callHelper({ view: 'diff', file, line: String(line), source, dest }, false);
    } catch { /* cancelled */ }
  }

  async function copyForAI() {
    try {
      const c = ctx();
      if (!c) return toast('Could not parse repo/PR');
      const { file } = fileFromHash();
      const { source, dest } = await getBranches();
      toast('Preparing AI diff…');
      // single-file diff when on a file, whole-PR diff otherwise
      chrome.runtime.sendMessage(
        { type: 'bb-pycharm-open', path: '/ai-diff',
          params: { workspace: c.workspace, repo: c.repo, pr: c.pr, file, source, dest } },
        async (res) => {
          if (chrome.runtime.lastError) return toast('Extension error: ' + chrome.runtime.lastError.message);
          if (!res || res.httpStatus === 0) return toast('Helper is not running!');
          const j = res.body || {};
          if (!j.ok) return toast(`Error: ${j.error || res.httpStatus}`);
          try {
            await navigator.clipboard.writeText(j.text);
            toast(`Copied (${j.chars} chars${j.truncated ? ', tail truncated' : ''}) — paste it into your AI.`);
          } catch {
            toast("Couldn't copy (no clipboard permission)");
          }
        }
      );
    } catch { /* cancelled */ }
  }

  async function copyDiagnose() {
    try {
      const c = ctx();
      if (!c) return toast('Could not parse repo/PR');
      const { file } = fileFromHash();
      const { source, dest } = await getBranches();
      toast('Collecting diagnostics…');
      chrome.runtime.sendMessage(
        { type: 'bb-pycharm-open', path: '/diagnose',
          params: { workspace: c.workspace, repo: c.repo, pr: c.pr, file, source, dest } },
        async (res) => {
          if (chrome.runtime.lastError) return toast('Extension error: ' + chrome.runtime.lastError.message);
          if (!res || res.httpStatus === 0) return toast('Helper is not running!');
          try {
            await navigator.clipboard.writeText(JSON.stringify(res.body, null, 1));
            toast('Diagnostics copied — paste it to support.');
          } catch {
            toast("Couldn't copy (no clipboard permission)");
          }
        }
      );
    } catch { /* cancelled */ }
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

  function isPRPage() {
    return /\/pull-requests\/\d+/.test(location.pathname);
  }

  function mount() {
    const existing = document.getElementById('bb-pycharm-bar');
    // Bitbucket SPA: PR disina gecince butonlari kaldir, PR'a donunce geri ekle
    if (!isPRPage()) {
      if (existing) existing.remove();
      const form = document.getElementById('bb-pycharm-form');
      if (form) form.remove();
      return;
    }
    if (existing) return;
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
    bar.appendChild(mk('▶ Open File in PyCharm', 'Open the diff file at its PR revision in PyCharm', openFile));
    bar.appendChild(mk('▶ Open Project', 'Check out the PR branch as a worktree and open the whole project in PyCharm', openProject));
    bar.appendChild(mk('▶ Open Diff', 'Before/after comparison in the PyCharm diff viewer (file when on a file, whole PR otherwise)', openDiff));
    bar.appendChild(mk('Copy for AI', 'Copy the diff to the clipboard for AI review (file when on a file, whole PR otherwise)', copyForAI));
    bar.appendChild(mk('Copy Diagnostics', 'Copy a step-by-step diagnostic report for troubleshooting', copyDiagnose));
    document.body.appendChild(bar);
  }

  mount();
  setInterval(mount, 3000); // keep buttons across Bitbucket SPA navigation
})();
