---
description: Pick up the next backlog task and take it to a pushed branch
---

Work the next item in `docs/BACKLOG.md`.

## 1. Pick

Read `docs/BACKLOG.md` and `docs/task-template.md`. Take the topmost unchecked
entry that has no `blocked:` line. Say which one you picked before starting.

If the entry's acceptance criteria are too vague to verify, stop and ask —
do not guess at what done means.

## 2. Plan

Explore the relevant files, then produce a plan: files you will touch, the
order, and how you will verify each acceptance criterion. Wait for approval
before editing anything.

## 3. Implement

Branch first: `task/<short-slug>`. Smallest coherent change that satisfies the
criteria — nothing outside the task's scope.

## 4. Verify

Run the checks defined in `CLAUDE.md`. Walk the acceptance criteria one at a
time and state how each was verified. If a criterion cannot be met, stop and
report rather than reinterpreting it.

## 5. Close out

- Commit and push the branch.
- Tick the checkbox in `docs/BACKLOG.md`.
- Summarise: what changed, anything you deliberately left alone, and what the
  next unblocked item is.

## Scope discipline

If you notice unrelated problems while working, **append them to the backlog
via the `docs/task-template.md` schema and carry on.** Never fix them in this
branch. This is the rule that keeps tasks reviewable.
