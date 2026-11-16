@AGENTS.md

# Claude Code specifics

> The shared instructions for every agent are in **`AGENTS.md`** (imported above). Put anything
> that applies to all agents THERE, not here. This file holds only what is Claude Code–specific.

- **Profiles** come from `.claude/settings.local.json` (`env`: `GH_CONFIG_DIR` → the personal one).
  The file is gitignored and is not hot-reloaded — a change needs a new session.
- **Hooks** (`.claude/settings.json`, PreToolUse): `.claude/hooks/git-guard.py` (escape hatch
  `#multi-agent-ok`).
- **Permissions** (`.claude/settings.json`): GitHub reads allowed; `gh secret set`,
  `gh workflow run` denied; `git commit` / `git push` ask.
