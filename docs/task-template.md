# Task schema

Every entry in `docs/BACKLOG.md` follows this shape. Both `/add` and `/next`
read this file — if you change the schema, change it here only.

```md
- [ ] **<imperative title, max ~60 chars>**
  why: <one line — the user-facing or maintenance reason>
  acceptance:
    - <testable statement>
    - <testable statement>
  files: <paths or areas, comma separated — best guess is fine>
  notes: <optional — links, prior art, gotchas found while scoping>
```

## Rules

- **Testable acceptance criteria only.** "feels smoother" is not a criterion;
  "no layout shift on first paint" is.
- **One PR per task.** If a task needs more than roughly one branch's worth of
  work, split it into separate entries rather than nesting sub-bullets.
- **New tasks append to the bottom.** Moving one above an entry that depends on
  it is allowed — say what moved and what the dependency was. Moving something
  because it feels more important is a call about priorities, which is not one
  to make on someone else's behalf.
- **Ticking the box is the last step**, after the branch is pushed.
- **Blocked tasks** get `blocked: <reason or task title>` on their own line.
  `/next` skips anything with a `blocked:` line.
