---
description: Turn a rough idea into a well-formed backlog entry
---

Add a new task to `docs/BACKLOG.md` based on this rough description:

$ARGUMENTS

Work in this order. Do not skip ahead to asking questions.

## 1. Check the backlog first

Read `docs/BACKLOG.md`. If this is already an entry, or contradicts an
existing one, stop and say so — do not add a duplicate.

## 2. Look at the code before asking anything

Use a subagent for this so the file reads stay out of the main context.
Give it a tight brief: targeted search only, do not walk the whole tree, and
report back on:

- whether the thing described already exists or is partly done
- which files or components would actually need to change
- anything that makes the request ambiguous in practice

## 3. Only then ask

Ask at most two questions, and only about things the code did not answer.
Ground each question in what you found — reference the actual file or prop,
so it can be answered in a few words.

If the description plus what you found is already unambiguous, skip the
questions entirely and go straight to writing the entry.

## 4. Write the entry

Follow `docs/task-template.md` exactly. Append to the bottom of the backlog.
Then say where in the order you think it belongs and why. Move it there yourself
only if the dependency runs the wrong way — something already listed depends on
this entry, or this entry depends on something below it. Anything else is a
judgement about priorities, and that one stays with whoever owns the list.

## 5. Commit it

`docs/BACKLOG.md` is the only path this command may stage. Stage it by name and
commit that path alone — never `git add -A` or `git add .`, or an entry written
while something else is half-finished will sweep that work into the commit
beside it. Whatever else was dirty when you started stays dirty afterwards.

Leaving it uncommitted is not an option either. On a laptop that would be
fine, but in a hosted session the container is reclaimed and anything
uncommitted goes with it, entry included.

Where the commit lands:

- **On `main`, or free to switch to it** — commit there. This is a queue
  mutation, not a change to be reviewed: it cannot break the app, and you
  already settled its wording before writing it. It is also the only place the
  entry does anything, because `/next` cuts its branch from `main` and reads
  the backlog off that.
- **Pinned to a branch you may not leave**, as a hosted session usually is —
  commit there, and say in your summary that the entry has to be merged to
  `main` before `/next` can ever pick it up.

## Constraints

- **`docs/BACKLOG.md` is the only file this command may change.**
  If you spot something worth fixing while looking around, add it to the
  backlog as a separate entry. Do not fix it now, however small.
- No new branches.
- If the task belongs in Jira rather than this repo's backlog, say so and stop.
