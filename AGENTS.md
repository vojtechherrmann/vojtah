# vojtah

> **The single instruction source for every coding agent** (Claude Code via `CLAUDE.md`, Codex,
> Cursor, …).

The PUBLIC repository of the start page of **vojtah.cz**: static HTML/CSS/JS only (GitHub Pages,
manual workflow `homepage-pages.yml`). The InBody app is its own public repository
(`inbody-aggregator`); the login API, the user accounts and the list of private projects live in a
PRIVATE repository and in a database, never here.

| Path | What |
|---|---|
| `homepage/` | the page: `index.html`, `style.css`, `script.js` (wakes the InBody app on click), `login.js` (optional sign-in against the site API), `cimrmani/`, `euforie/` (contact-only pages), `CNAME` |
| `tests/` | node tests (`node --test tests`) |
| `.github/workflows/` | `homepage-test.yml` (on push), `homepage-pages.yml` (manual publish) |
| `.claude/` | Claude Code settings and the git-guard hook |

## Rules for the whole repository

- ⛔ **Everything here is public.** Never commit: names or descriptions of private projects, user
  names, passwords, tokens, internal URLs other than the public API host, health data, anything
  from `samples/`. The page may show only projects that are public or "on request"; any other
  project comes from the API after sign-in.
- Chat in **Czech, informal (tykání)**; code, comments and commit messages in **English**.
- Work on `master`; **ask the user before committing and before pushing**. A commit is ONE command
  with named paths and the `--`: `git add <paths> && git commit -m "…" -- <paths>`. Never
  `git reset --hard`, `git checkout .`, `git restore .`, whole-tree `git stash`, `git clean -fd`,
  amend / rebase of pushed commits, force push. End the message with the agent + model trailer.
- Strict CSP: no inline script or style; every external host the page talks to is named in the
  `<meta http-equiv="Content-Security-Policy">` of `index.html` (a test checks it).
- Local clones live in `/Users/vherrmann/SRC/vojtechherrmann/<repo>`.
