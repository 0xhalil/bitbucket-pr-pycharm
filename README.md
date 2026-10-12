# Bitbucket PR → PyCharm (one click, no token)

Review Bitbucket pull requests in your IDE instead of the web diff viewer.
A Chrome extension adds buttons to Bitbucket PR pages; a tiny local helper
does the git work and opens PyCharm. No Bitbucket API token needed — it uses
your existing git/SSH access. Your current checkout is never touched
(the PR branch is materialized as a git worktree under `/tmp/bb-pr`).

## Components

- `pycharm-pr-helper.py` — local server (`http://127.0.0.1:8765`, stdlib only)
- `extension/` — Chrome extension (Manifest V3, standalone, no Tampermonkey needed)
- `install.sh` / `uninstall.sh` — one-command setup / removal (macOS)

## Setup (2 minutes)

Requirements: macOS, Chrome, PyCharm (under `/Applications`), SSH access to Bitbucket.

1. Install the helper (single command — starts it now and on every login):

   ```bash
   git clone https://github.com/0xhalil/bitbucket-pr-pycharm.git && cd bitbucket-pr-pycharm && ./install.sh
   ```

   On success you will see `OK: helper is running (http://127.0.0.1:8765).`

2. In Chrome, once: open `chrome://extensions`, enable **Developer mode**,
   click **Load unpacked** and select `~/bb-pycharm/extension`.

## Usage

On any Bitbucket PR page, buttons appear at the bottom right:

- **Open File in PyCharm** — opens the diffed file at its PR revision, inside the
  full project context (whole file + whole repo browsable).
- **Open Project** — checks out the PR branch as a worktree and opens the project.
- **Open Diff** — before/after comparison in PyCharm's diff viewer (the file when
  on a file, the whole PR as a directory diff otherwise). The base side is the
  merge-base, i.e. the same three-dot semantics as Bitbucket's diff.
- **Copy for AI** — copies the diff (file or whole PR) as unified diff to the
  clipboard for AI review. Truncated at 200K chars.

How it works: the extension reads workspace/repo/PR/file/branches from the page
(no API calls), the helper finds the repo anywhere on the computer (Spotlight +
home directory, then caches it), clones via SSH if missing, prepares worktrees
for the PR branch and its merge-base, and invokes PyCharm.

## Security model

The helper listens on `127.0.0.1` only and accepts requests from Bitbucket pages
(via the extension) and local tools. Any other web origin gets `403 forbidden`,
so random websites cannot read your diffs through it. No Bitbucket credentials
or tokens are stored anywhere.

## Environment variables

- `BB_PR_PORT` (default `8765`), `BB_PR_ROOTS` (`:`-separated search roots),
  `BB_PR_WORKTREE_BASE` (default `/tmp/bb-pr`),
  `BB_PR_GC_DAYS` (worktrees older than this are auto-removed, default `7`, `0` disables),
  `BB_PYCHARM_BIN` (override PyCharm auto-detection), `DRY_RUN=1` (never launch PyCharm).
- `GET /diagnose?...` returns read-only step-by-step checks (repo, remote,
  branches, merge-base, PyCharm) — the extension's **Copy Diagnostics** button
  copies it for troubleshooting.

## Chrome Web Store publishing (optional, removes the Load-unpacked step)

1. Pay the one-time $5 developer fee at the Chrome Web Store console.
2. Upload `bitbucket-pr-pycharm-chrome-vX.Y.Z.zip` from this repo.
3. Fill in the listing (description + one screenshot of a PR page with the buttons).
4. After review, teammates install with one click and get auto-updates.

## Uninstall

```bash
cd <bitbucket-pr-clone> && ./uninstall.sh
```

and Remove the extension in `chrome://extensions`.
