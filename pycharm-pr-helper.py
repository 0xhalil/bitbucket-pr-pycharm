#!/usr/bin/env python3
"""Bitbucket -> PyCharm one-click helper (no token needed).

The browser extension sends requests like this from Bitbucket PR diff pages:
  http://127.0.0.1:8765/open?workspace=...&repo=...&file=...&line=...&pr=...&source=...&dest=...

This server:
  1. Finds the repo locally (anywhere on the computer, matched by bitbucket remote).
     Clones via SSH when missing (uses existing SSH access, no API token needed).
  2. Materializes the PR source branch as a git worktree under /tmp
     (never touches the current checkout).
  3. Opens the file in PyCharm with project context + line number.

Run:
  python3 pycharm-pr-helper.py [--port 8765]

Env:
  BB_PR_PORT, BB_PR_ROOTS (":" separated), BB_PR_WORKTREE_BASE, DRY_RUN=1 (no PyCharm in tests)
"""

import json
import os
import re
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

PYCHARM_BIN = "/Applications/PyCharm.app/Contents/MacOS/pycharm"
HOME = Path.home()
CONFIG_DIR = HOME / ".config" / "bb-pycharm-helper"
MAPPING_FILE = CONFIG_DIR / "repos.json"

DEFAULT_ROOTS = [
    HOME / "developer",
    HOME / "Developer",
    HOME / "projects",
    HOME / "code",
    HOME / "src",
]
WORKTREE_BASE = Path(os.environ.get("BB_PR_WORKTREE_BASE", "/tmp/bb-pr"))
DRY_RUN = os.environ.get("DRY_RUN") == "1"

RE_WS = re.compile(r"^[A-Za-z0-9_.\-]{1,100}$")
RE_REPO = re.compile(r"^[A-Za-z0-9_.\-]{1,200}$")
RE_PR = re.compile(r"^\d{1,10}$")
RE_BRANCH = re.compile(r"^[A-Za-z0-9_.\-/]{1,250}$")
MAX_FILE_LEN = 1000


def roots():
    env = os.environ.get("BB_PR_ROOTS")
    if env:
        return [Path(p).expanduser() for p in env.split(":") if p.strip()]
    return [p for p in DEFAULT_ROOTS if p.is_dir()] or [HOME / "developer"]


def load_mapping():
    try:
        return json.loads(MAPPING_FILE.read_text())
    except (OSError, ValueError):
        return {}


def save_mapping(m):
    try:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        MAPPING_FILE.write_text(json.dumps(m, indent=2))
    except OSError:
        pass


def remote_matches(repo_dir, workspace, repo):
    try:
        out = subprocess.run(
            ["git", "-C", str(repo_dir), "remote", "-v"],
            capture_output=True, text=True, timeout=10,
        ).stdout.lower()
    except (subprocess.SubprocessError, OSError):
        return False
    for sep in (f"bitbucket.org:{workspace.lower()}/{repo.lower()}",
                f"bitbucket.org/{workspace.lower()}/{repo.lower()}"):
        if sep in out:
            return True
    return False


SKIP_DIRS = {"Library", "Applications", ".Trash", ".docker", ".cache",
             "node_modules", "__pycache__", ".git"}


def is_excluded(path):
    """Keep our own worktree cache out of search results."""
    try:
        Path(path).resolve().relative_to(WORKTREE_BASE.resolve())
        return True
    except ValueError:
        return False


def check_candidate(cand, workspace, repo):
    p = Path(cand)
    if p.name.lower() != repo.lower() or not p.is_dir() or is_excluded(p):
        return False
    if not (p / ".git").exists():
        return False
    return remote_matches(str(p), workspace, repo)


def via_mdfind(repo):
    """Fast whole-computer name search via Spotlight (macOS)."""
    try:
        r = subprocess.run(["mdfind", f'kMDItemFSName == "{repo}"'],
                           capture_output=True, text=True, timeout=25)
    except (subprocess.SubprocessError, OSError, FileNotFoundError):
        return []
    return [ln.strip() for ln in r.stdout.splitlines() if ln.strip()]


def walk_roots():
    seen = set()
    for root in roots() + [HOME]:
        if root.is_dir() and str(root) not in seen:
            seen.add(str(root))
            yield root


def find_repo(workspace, repo):
    mapping = load_mapping()
    key = f"{workspace}/{repo}".lower()
    if key in mapping:
        p = Path(mapping[key])
        if p.is_dir() and not is_excluded(p) and remote_matches(str(p), workspace, repo):
            return p
    # 1) whole computer (Spotlight)
    for cand in via_mdfind(repo):
        if check_candidate(cand, workspace, repo):
            mapping[key] = cand
            save_mapping(mapping)
            return Path(cand)
    # 2) fallback: walk roots
    for root in walk_roots():
        for dirpath, dirnames, _ in os.walk(root, topdown=True):
            depth = len(Path(dirpath).relative_to(root).parts)
            dirnames[:] = [d for d in dirnames
                           if not d.startswith(".") and d not in SKIP_DIRS]
            if depth > 5 or is_excluded(dirpath):
                dirnames[:] = []
                continue
            if check_candidate(dirpath, workspace, repo):
                mapping[key] = dirpath
                save_mapping(mapping)
                return Path(dirpath)
    return None


def ensure_clone(workspace, repo):
    """Clone via SSH when the repo is not local (uses existing SSH access, no token)."""
    target = roots()[0] / repo
    if target.exists():
        return None
    try:
        r = subprocess.run(
            ["git", "clone", "--filter=blob:none",
             f"git@bitbucket.org:{workspace}/{repo}.git", str(target)],
            capture_output=True, text=True, timeout=180,
        )
        if r.returncode == 0:
            m = load_mapping()
            m[f"{workspace}/{repo}".lower()] = str(target)
            save_mapping(m)
            return target
    except (subprocess.SubprocessError, OSError):
        pass
    return None


def clean_file_param(f):
    if not f or len(f) > MAX_FILE_LEN or f.startswith("/") or "\\" in f or "\x00" in f:
        return None
    parts = [p for p in f.split("/") if p not in ("", ".")]
    if not parts or ".." in parts:
        return None
    return "/".join(parts)


def ensure_worktree(repo_dir, source, pr):
    """Materialize the PR branch as a worktree under /tmp; never touches the checkout."""
    tag = re.sub(r"[^A-Za-z0-9_.\-]", "-", source) if source else f"pr-{pr or 'x'}"
    wt = WORKTREE_BASE / repo_dir.name / tag[:120]
    if worktree_exists(wt):
        return wt  # reuse if already created
    ref = f"origin/{source}" if source else "HEAD"
    if source:
        subprocess.run(["git", "-C", str(repo_dir), "fetch", "origin", source],
                       capture_output=True, timeout=120)
    r = subprocess.run(["git", "-C", str(repo_dir), "worktree", "add", "--detach",
                        str(wt), ref], capture_output=True, text=True, timeout=180)
    if r.returncode != 0:
        # if fetch failed, try the local ref
        if source:
            r = subprocess.run(["git", "-C", str(repo_dir), "worktree", "add", "--detach",
                                str(wt), source], capture_output=True, text=True, timeout=180)
        if r.returncode != 0:
            return None
    return wt


def worktree_exists(wt):
    return (wt / ".git").exists() or (wt.exists() and (wt / ".git").is_file())


def git_out(repo_dir, *args, timeout=60):
    try:
        r = subprocess.run(["git", "-C", str(repo_dir), *args],
                           capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip() if r.returncode == 0 else None
    except (subprocess.SubprocessError, OSError):
        return None


class AmbiguousBranch(Exception):
    def __init__(self, prefix, candidates):
        self.prefix, self.candidates = prefix, candidates


def resolve_branch(repo_dir, name):
    """Complete a truncated branch name via the remote ("feature/CORE-1..." -> full name).

    Bitbucket chips truncate long names with "..."; the prefix is resolved with ls-remote.
    Returns the full name on a single match, raises AmbiguousBranch on several."""
    name = (name or "").strip()
    if not name:
        return ""
    if git_out(repo_dir, "rev-parse", "--verify", f"origin/{name}") or \
       git_out(repo_dir, "rev-parse", "--verify", name):
        return name  # exact name already known
    if name.endswith("..."):
        prefix = name[:-3]
        out = git_out(repo_dir, "ls-remote", "--heads", "origin", prefix + "*", timeout=60)
        refs = [ln.split("\t")[1].replace("refs/heads/", "")
                for ln in (out or "").splitlines() if "refs/heads/" in ln]
        if len(refs) == 1:
            return refs[0]
        if len(refs) > 1:
            raise AmbiguousBranch(prefix, sorted(refs))
    return name  # unresolved; fetch will produce a clear error


def diff_base_worktree(repo_dir, source, dest, pr):
    """Left side of the diff: merge-base of source and dest (where the PR branched off).

    Bitbucket PR diffs work the same way (three-dot diff)."""
    tag = (re.sub(r"[^A-Za-z0-9_.\-]", "-", source) if source else f"pr-{pr or 'x'}")[:120]
    wt = WORKTREE_BASE / repo_dir.name / f"{tag}-base"
    if worktree_exists(wt):
        return wt
    subprocess.run(["git", "-C", str(repo_dir), "fetch", "origin", source, dest],
                   capture_output=True, timeout=120)
    mb = git_out(repo_dir, "merge-base", f"origin/{source}", f"origin/{dest}")
    if not mb:
        mb = git_out(repo_dir, "merge-base", source, dest)
    if not mb:  # last resort: tip of dest
        mb = git_out(repo_dir, "rev-parse", "--verify", f"origin/{dest}") or \
             git_out(repo_dir, "rev-parse", "--verify", dest)
    if not mb:
        return None
    r = subprocess.run(["git", "-C", str(repo_dir), "worktree", "add", "--detach",
                        str(wt), mb], capture_output=True, text=True, timeout=180)
    return wt if r.returncode == 0 else None


MAX_AI_DIFF = 200_000  # upper character limit for AI-copied diffs


def open_diff(left, right):
    cmd = [PYCHARM_BIN, "diff", str(left), str(right)]
    if DRY_RUN:
        return cmd
    subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return cmd


def open_in_pycharm(project_dir, filepath=None, line=1):
    cmd = [PYCHARM_BIN, str(project_dir)] if filepath is None else \
          [PYCHARM_BIN, str(project_dir), "--line", str(line), str(filepath)]
    if DRY_RUN:
        return cmd
    subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return cmd


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send_json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def ai_diff(self, q):
        """Produce a unified diff for AI review (single file when on a file, whole PR otherwise).

        Never opens the IDE; returns diff text for the extension to copy."""
        g = lambda k: (q.get(k, [""])[0] or "").strip()
        workspace, repo, pr = g("workspace"), g("repo"), g("pr")
        source, dest = g("source").replace("…", "..."), g("dest").replace("…", "...")

        if not (RE_WS.match(workspace) and RE_REPO.match(repo)):
            return self.send_json(400, {"ok": False, "error": "bad workspace/repo"})
        if pr and not RE_PR.match(pr):
            return self.send_json(400, {"ok": False, "error": "bad pr"})
        for b in (source, dest):
            if b and (not RE_BRANCH.match(b) or b.startswith(("-", "/", ".")) or ".." in b):
                return self.send_json(400, {"ok": False, "error": "bad branch"})
        if not source or not dest:
            return self.send_json(400, {"ok": False,
                "error": "AI diff needs source and destination branches"})
        raw_file = g("file")
        f = clean_file_param(raw_file) if raw_file else None
        if raw_file and not f:
            return self.send_json(400, {"ok": False, "error": "bad file"})

        repo_dir = find_repo(workspace, repo) or ensure_clone(workspace, repo)
        if not repo_dir:
            return self.send_json(404, {"ok": False,
                "error": f"repo not found: {workspace}/{repo}"})
        try:
            source = resolve_branch(repo_dir, source)
            dest = resolve_branch(repo_dir, dest)
        except AmbiguousBranch as a:
            return self.send_json(400, {"ok": False,
                "error": f"'{a.prefix}...' matches multiple branches: {', '.join(a.candidates[:8])}"})
        bdir = diff_base_worktree(repo_dir, source, dest, pr)
        pdir = ensure_worktree(repo_dir, source, pr)
        if not bdir or not pdir:
            return self.send_json(502, {"ok": False,
                "error": "could not prepare branches (check access/name)"})
        base_sha = git_out(bdir, "rev-parse", "HEAD")
        pr_sha = git_out(pdir, "rev-parse", "HEAD")
        if not base_sha or not pr_sha:
            return self.send_json(502, {"ok": False, "error": "could not resolve commit"})
        paths = ["--", f] if f else []
        try:
            stat = subprocess.run(["git", "-C", str(repo_dir), "diff", "--stat",
                                   base_sha, pr_sha, *paths],
                                  capture_output=True, text=True, timeout=60).stdout
            diff = subprocess.run(["git", "-C", str(repo_dir), "diff", "--no-color",
                                   "--no-ext-diff", "-U3", base_sha, pr_sha, *paths],
                                  capture_output=True, text=True, timeout=60).stdout
        except (subprocess.SubprocessError, OSError):
            return self.send_json(502, {"ok": False, "error": "could not produce diff"})

        scope = f"file: {f}" if f else "whole PR"
        header = (f"# {workspace}/{repo} PR #{pr or '?'} ({scope})\n"
                  f"# {source} -> {dest}\n\n")
        text = header + (stat or "") + ("\n" if stat else "") + (diff or "(no changes)\n")
        truncated = False
        if len(text) > MAX_AI_DIFF:
            text = text[:MAX_AI_DIFF] + f"\n\n... [truncated: {len(text)} chars total]"
            truncated = True
        return self.send_json(200, {"ok": True, "text": text,
                             "chars": len(text), "truncated": truncated})

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/health":
            return self.send_json(200, {"ok": True})
        if u.path == "/ai-diff":
            return self.ai_diff(parse_qs(u.query))
        if u.path != "/open":
            return self.send_json(404, {"ok": False, "error": "unknown endpoint"})
        q = parse_qs(u.query)
        g = lambda k: (q.get(k, [""])[0] or "").strip()
        workspace, repo, pr = g("workspace"), g("repo"), g("pr")
        source, dest, line = g("source"), g("dest"), g("line") or "1"
        view = g("view")  # "" or "diff"
        # Bitbucket chips may truncate names with "..." ("…")
        source, dest = source.replace("…", "..."), dest.replace("…", "...")

        if not (RE_WS.match(workspace) and RE_REPO.match(repo)):
            return self.send_json(400, {"ok": False, "error": "bad workspace/repo"})
        if pr and not RE_PR.match(pr):
            return self.send_json(400, {"ok": False, "error": "bad pr"})
        for b in (source, dest):
            if b and (not RE_BRANCH.match(b) or b.startswith(("-", "/", ".")) or ".." in b):
                return self.send_json(400, {"ok": False, "error": "bad branch"})
        try:
            line = max(1, min(int(line), 10_000_000))
        except ValueError:
            line = 1
        raw_file = g("file")
        project_mode = not raw_file  # no file given means open the whole project
        f = clean_file_param(raw_file) if raw_file else None
        if raw_file and not f:
            return self.send_json(400, {"ok": False, "error": "bad file"})

        repo_dir = find_repo(workspace, repo) or ensure_clone(workspace, repo)
        if not repo_dir:
            return self.send_json(404, {"ok": False,
                "error": f"repo not found: {workspace}/{repo} (not on this computer and could not be cloned)"})

        # complete truncated names ("feature/CORE-1...") via the remote
        try:
            if source:
                source = resolve_branch(repo_dir, source)
            if dest:
                dest = resolve_branch(repo_dir, dest)
        except AmbiguousBranch as a:
            return self.send_json(400, {"ok": False,
                "error": f"'{a.prefix}...' matches multiple branches: {', '.join(a.candidates[:8])}. Please enter the full name."})
        base = ensure_worktree(repo_dir, source, pr) if source else None
        proj = base or repo_dir
        if source and base is None and not DRY_RUN:
            # fail loudly instead of silently opening the wrong branch
            return self.send_json(502, {"ok": False,
                "error": f"could not fetch branch '{source}' (check access/name)"})
        if view == "diff":
            if not source:
                return self.send_json(400, {"ok": False,
                    "error": "diff needs the source branch (could not read it from the page)"})
            if not dest:
                return self.send_json(400, {"ok": False,
                    "error": "diff needs the destination branch (could not read it from the page)"})
            bdir = diff_base_worktree(repo_dir, source, dest, pr)
            if not bdir:
                return self.send_json(502, {"ok": False,
                    "error": "could not prepare base revision (merge-base not found)"})
            if project_mode:
                cmd = open_diff(bdir, proj)
                return self.send_json(200, {"ok": True, "view": "diff",
                                     "project": str(proj), "base": str(bdir),
                                     "source": source, "dest": dest,
                                     "worktree": True, "cmd": cmd})
            left, right = (bdir / f), (proj / f)
            if left.exists() and right.exists() and not left.is_dir() and not right.is_dir():
                cmd = open_diff(left.resolve(), right.resolve())
                return self.send_json(200, {"ok": True, "view": "diff",
                                     "file": str(right.resolve()), "line": line,
                                     "source": source, "dest": dest, "cmd": cmd})
            # new file / deleted file: only one side of the diff exists, open the file
            note = "new file (not in base)" if right.exists() else \
                   "deleted file (not in PR, showing base)" if left.exists() else None
            if note is None:
                return self.send_json(404, {"ok": False,
                    "error": "file found neither in base nor in PR"})
            side = right.resolve() if right.exists() else left.resolve()
            cmd = open_in_pycharm(proj if right.exists() else bdir, side, line)
            return self.send_json(200, {"ok": True, "view": "diff", "note": note,
                                 "file": str(side), "line": line, "cmd": cmd})
        if project_mode:
            cmd = open_in_pycharm(proj)
            return self.send_json(200, {"ok": True, "project": str(proj),
                                 "source": source or None, "worktree": bool(base),
                                 "cmd": cmd})
        target = (proj / f).resolve()
        try:
            target.relative_to(proj.resolve())
        except ValueError:
            return self.send_json(400, {"ok": False, "error": "bad file"})
        if not target.exists() and not DRY_RUN:
            # if the file is not in this branch (deleted/moved), try the main checkout
            alt = (repo_dir / f)
            if alt.exists():
                proj, target = repo_dir, alt

        cmd = open_in_pycharm(proj, target, line)
        self.send_json(200, {"ok": True, "project": str(proj), "file": str(target),
                             "line": line, "source": source or None,
                             "worktree": bool(base), "cmd": cmd})


def main():
    port = int(sys.argv[sys.argv.index("--port") + 1]) if "--port" in sys.argv else int(os.environ.get("BB_PR_PORT", "8765"))
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"bb-pycharm-helper: http://127.0.0.1:{port} (roots={[str(r) for r in roots()]})", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
