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
Then tell me where in the order you think it belongs and why — but do not
reorder it yourself.

## Constraints

- **This command is read-only apart from appending to `docs/BACKLOG.md`.**
  If you spot something worth fixing while looking around, add it to the
  backlog as a separate entry. Do not fix it now, however small.
- No new branches, no commits.
- If the task belongs in Jira rather than this repo's backlog, say so and stop.
