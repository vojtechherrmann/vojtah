"""PreToolUse guard: keep one agent's git command out of another agent's work.

Copied from the monorepo (`vojtechherrmann/monorepo`, `.claude/hooks/git-guard.py`), where
several Claude sessions share one working tree and one index. The same can happen here (a
session + its subagents, Codex), and the guard costs nothing, so it travels with the convention.
In the monorepo a foreign commit swallowed staged work twice (2bcf0c0, b478bf1) while the rule
was already written down -- guidance you have to remember is not a guard rail.

Two failure classes, both silent:

  TAKING     a command that sweeps the whole index or tree into MY commit
             (`git add -A`, `git commit` with no pathspec, `git stash`)
  DESTROYING a command that throws away someone else's uncommitted work
             (`git reset --hard`, `git checkout -- .`, `git clean -fd`)

The safe form of a commit is PATH-LIMITED:

    git add <my paths> && git commit -m "..." -- <the same paths>

`git commit -- <paths>` commits those paths and ignores the rest of the index entirely --
that is what makes a concurrently-staged foreign file unable to ride along. `git add` alone
does NOT give you that: between your add and your commit, another session's `git add` lands
in the same index.

Escape hatch: put `#multi-agent-ok` anywhere in the command. Deliberate, visible, greppable
-- for the rare case where sweeping really is the intent. Check `git status --porcelain`
first.

Fails OPEN by design: a parse error, a missing interpreter or an unreadable payload must
never wedge the session. It denies only what it positively recognizes.
"""

import json
import re
import shlex
import sys

OVERRIDE = "#multi-agent-ok"
SWEEPING_ADD = re.compile(r"^-(?:A|u)$|^--(?:all|update)$")
COMMIT_ALL = re.compile(r"^--all$|^-[a-zA-Z]*a[a-zA-Z]*$")
PREFIXES = ("sudo", "env", "command", "time", "nohup", "exec")


def _segments(command: str) -> list[list[str]]:
    """Split a shell line into argv lists, one per `git ...` invocation."""
    out = []
    for part in re.split(r"&&|\|\||;|\||\n", command):
        try:
            argv = shlex.split(part, comments=False)
        except ValueError:  # unbalanced quotes (heredoc body etc.) -- not ours to judge
            continue
        while argv and ("=" in argv[0] or argv[0] in PREFIXES):
            argv = argv[1:]
        if argv and (argv[0] == "git" or argv[0].endswith("/git")):
            out.append(argv[1:])
    return out


def _has_pathspec(args: list[str]) -> bool:
    """True if the command is limited to explicit paths (`-- p...` or `--only p...`)."""
    if "--" in args:
        return bool(args[args.index("--") + 1 :])
    for key in ("--only", "-o"):
        if key in args:
            return bool([a for a in args[args.index(key) + 1 :] if not a.startswith("-")])
    return False


def check(command: str) -> str | None:
    """Return the deny reason, or None if the command is safe."""
    if OVERRIDE in command:
        return None

    for args in _segments(command):
        if not args:
            continue
        sub, rest = args[0], args[1:]
        flags = [a for a in rest if a.startswith("-")]
        paths = [a for a in rest if not a.startswith("-")]

        if sub == "add":
            if any(SWEEPING_ADD.match(f) for f in flags) or "." in paths or ":/" in paths:
                return (
                    "`git add -A` / `git add .` stages OTHER SESSIONS' work too -- several "
                    "agents edit this repo at once.\nStage your own paths by name:\n"
                    '    git add <my paths> && git commit -m "..." -- <the same paths>'
                )

        elif sub == "commit":
            if any(COMMIT_ALL.match(f) for f in flags):
                return (
                    "`git commit -a` commits every modified tracked file, including work that "
                    "is not yours.\nCommit path-limited instead:\n"
                    '    git add <my paths> && git commit -m "..." -- <the same paths>'
                )
            if not _has_pathspec(rest):
                return (
                    "`git commit` with no pathspec commits THE WHOLE INDEX -- anything another "
                    "session staged in the meantime rides along under your message. This is not "
                    "hypothetical (two incidents in the monorepo, 2026-08).\n"
                    "Name the paths; `--` makes the rest of the index irrelevant:\n"
                    '    git add <my paths> && git commit -m "..." -- <the same paths>\n'
                    "Unsure which are yours? `git status --porcelain` first."
                )

        elif sub == "stash":
            if not rest or (rest[0] in ("push", "save") and not _has_pathspec(rest)):
                return (
                    "`git stash` pockets the WHOLE tree, including other sessions' uncommitted "
                    "work, and they will not know where it went.\n"
                    "Stash your paths only:  git stash push -- <my paths>"
                )

        elif sub == "reset" and "--hard" in flags:
            return (
                "`git reset --hard` DESTROYS every uncommitted change in the tree, not just "
                "yours.\nUndo your own files:  git checkout HEAD -- <my paths>"
            )

        elif sub in ("checkout", "restore") and ("." in paths or ":/" in paths):
            return (
                f"`git {sub} .` DISCARDS uncommitted work across the whole tree, including "
                f"other sessions'.\nName your files:  git {sub} -- <my paths>"
            )

        elif sub == "clean":
            if "--force" in flags or any(
                "f" in f for f in flags if f.startswith("-") and not f.startswith("--")
            ):
                return (
                    "`git clean -f` deletes untracked files -- another session's new, unsaved "
                    "module is untracked.\nDelete what you created by name, or dry-run with -n."
                )

    return None


def main() -> None:
    try:
        payload = json.load(sys.stdin)
        command = (payload.get("tool_input") or {}).get("command") or ""
    except Exception:
        sys.exit(0)  # fail open: never wedge the session on our own bug
    reason = check(command)
    if reason:
        print(
            json.dumps(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": (
                            f"{reason}\n\n(.claude/hooks/git-guard.py -- see "
                            f"AGENTS.md, section Git. Deliberate sweep? put {OVERRIDE} "
                            f"in the command.)"
                        ),
                    }
                }
            )
        )
    sys.exit(0)


if __name__ == "__main__":
    main()
