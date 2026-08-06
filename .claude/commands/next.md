---
description: Pick up the next backlog task and take it to a pushed branch
---

Work the next item in `docs/BACKLOG.md`, start to finish, without checking in.

Do not ask for approval of the plan, or for permission to start, or whether to
carry on. Either the task is clear enough to do or it is not, and the stop
conditions below say which. Anything short of one of those, keep going.

## 1. Pick

Read `docs/BACKLOG.md` and `docs/task-template.md`. Take the topmost unchecked
entry that has no `blocked:` line. Say which one you picked, then get on with it.

Do not reorder the list here, dependency or not. The template allows it, but
doing it in this command would mean choosing your own task, which is the single
decision this one does not get to make. If the topmost entry turns out to sit
above something it depends on, that is a stop condition — say so and leave the
list alone.

## 2. Plan

Explore the relevant files and write down the plan: the files you will touch,
the order, and how you will verify each acceptance criterion. This is a record,
not a request — post it and continue straight into the work.

If you cannot say how a criterion will be verified, that is a stop condition,
not something to work out as you go.

## 3. Implement

Branch first: `task/<short-slug>`. Never commit to `main`. Smallest coherent
change that satisfies the criteria — nothing outside the task's scope.

## 4. Verify

Run the checks in `CLAUDE.md`, then walk the acceptance criteria one at a time
and state how each was verified.

Verify by measuring, not by reasoning. Read the pixel, count the thing, time
the thing. "It should work because…" is not verification, and with nobody
reading over your shoulder it is how a wrong change gets pushed looking right.
Where a criterion can only be checked by eye, say so plainly in the summary
rather than reporting it as passed.

## 5. Close out

- Commit and push the branch. No pull request unless the task asks for one.
- Tick the checkbox in `docs/BACKLOG.md` and push that too.
- Summarise: what changed, how each criterion was verified, anything you
  deliberately left alone, and what the next unblocked item is.

## Stop conditions

Stop, leave the branch unpushed and the box unticked, and say why:

- the acceptance criteria are too vague to verify, or two of them contradict
- a criterion cannot be met without going outside the task's scope
- the work needs a decision that is not yours to make — dropping part of the
  task, changing stored data in a way that cannot be undone, adding a dependency
- something already on `main` is broken, so you cannot tell whether it was your
  change that failed

Reinterpreting a criterion so that it passes is never the answer. A stopped
task with a clear reason is a good outcome. A ticked box over work that does
not do what was asked is not, and unattended it will not be noticed for days.

## Scope discipline

If you notice unrelated problems while working, **append them to the backlog
via the `docs/task-template.md` schema and carry on.** Never fix them in this
branch. This is the rule that keeps tasks reviewable, and it matters more
without a human gate, not less — an unattended run is exactly where a small
fix quietly becomes a second change nobody reviewed.

The fix stays out of this branch; the entry describing it has nowhere else to
go, so it rides this task's pull request and reaches `main` when that does.
List what you appended in the summary. If the branch is later abandoned the
entry goes with it, and that line is the only trace left.
