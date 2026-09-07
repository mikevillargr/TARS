# Per-Change Changelog Files

One file per shipped change, named after the version it bumped: `vX.Y.Z.md`. This directory
exists so the detailed "what changed and why" writeup for every production change is stored as
an individual, citable file — not just buried in `SYSTEM_STATE.md`'s ever-growing Version History
section — and can be mechanically compiled into GitHub release notes when a formal release
happens.

## When to create one

Same trigger as the `SYSTEM_STATE.md` Version History mandate in `CLAUDE.md` §0 / `AGENTS.md` §7:
**every change that reaches production**, no matter how small. If you're bumping the patch
version and adding an entry to `SYSTEM_STATE.md`, you're also creating `docs/changelog/vX.Y.Z.md`
in the same commit.

## What goes in it

The same content you write for the `SYSTEM_STATE.md` Version History entry — don't write it
twice in two different styles, just save a copy as its own file:

```markdown
# vX.Y.Z — YYYY-MM-DD

**Type:** feat | fix | chore | refactor | docs
**Scope:** web | harness | web+harness | infra

<One-paragraph summary of what changed.>

**Why:** <the decision/rationale — what problem this solved, what was tried before, what broke.
This is the part `gh release create --generate-notes` can never produce from a PR title alone.>

**Files changed:** <short list or "see commit diff">
```

Look at any recent entry in `SYSTEM_STATE.md`'s Version History for the level of detail expected
(e.g. the v2.15.9/v2.15.10 root-cause writeups) — that's the bar.

## How this feeds GitHub release notes

When Mike explicitly says "release" (see `CLAUDE.md` §12), compile the release notes from every
`docs/changelog/vX.Y.Z.md` file whose version falls between the previous tag and the new one,
concatenated in ascending version order, and pass that as `--notes-file` to `gh release create` —
**do not** rely on `--generate-notes` alone; it only pulls PR titles and drops the "why."

## Retroactive backfill

Not required. This folder starts from the next shipped change going forward — no need to
reconstruct files for the hundreds of versions already in `SYSTEM_STATE.md`'s history.
