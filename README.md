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
   git clone <REPO-URL> && cd bitbucket-pr && ./install.sh
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

## Uninstall

```bash
cd <bitbucket-pr-clone> && ./uninstall.sh
```

and Remove the extension in `chrome://extensions`.
