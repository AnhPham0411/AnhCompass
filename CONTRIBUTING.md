# Contributing to AnhCompass

## The one rule that matters

**A change to an engine lands with a benchmark case, and the case is labelled before the code is written.**

This project's whole claim is that its numbers mean something. A case written after
watching what the engine did is not evidence, it is a screenshot. See
[BENCHMARKS.md](BENCHMARKS.md) for what that has already cost us — twice the corpus read
100% while the product answered `pass` on a violating repository.

## Setup

```bash
pnpm install
pnpm -r build
pnpm test
```

Node >= 20, pnpm 9. Everything else is in the workspace.

## Before you open a pull request

```bash
pnpm -r build && pnpm -r typecheck && pnpm lint && pnpm test && pnpm bench -- --graph
```

All five must pass. `pnpm bench` exits 2 when any case disagrees with its label — that is
a failure, not a warning. CI runs the same five on Linux, Windows and macOS against Node
20 and 22.

The semantic slice needs an API key and is not part of that gate:

```bash
LLM_API_KEY=... LLM_PROVIDER=openai pnpm bench -- --semantic
```

## The two corpora

| Directory | What it is for |
|---|---|
| `benchmarks/cases/dev/` | Cases you may debug against while building |
| `benchmarks/cases/holdout/` | Cases you may **not** look at while fixing a failure |

The holdout split exists because an engine tuned until its own corpus reads 100% has
learned the corpus, not the problem. Report both; a gap between them is information.

If you fix a bug the holdout found, add a unit test for it — that is what keeps it fixed.
Do not move the case into `dev/`.

## Architectural rules

`CLAUDE.md` holds them, and the repository enforces them on itself:

```bash
node apps/cli/dist/index.js check --diff origin/master
```

The short version:

1. LLM calls live in `packages/llm`. Nothing else imports an SDK or calls a model API.
2. Graph backends are reached through the `GraphProvider` interface.
3. `packages/core` is pure: no `process.env`, no network, no `fs` on a path it did not
   receive as an argument, no `console`.
4. External data — frontmatter, env, CLI args, model output — passes through zod first.
5. **A verdict without evidence cannot say `violation`.** If the engine could not see the
   input, the answer is `uncertain`. An engine that reports a confident green light on
   input it never read is the failure mode this project exists to prevent, and it has
   shipped three times.

## Code

TypeScript strict, ESM. Typed errors — no `catch {}` that swallows. Functions under 40
lines. `import type` for types. Comments explain why, not what.

## Commits

Conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`), scoped by package
where it helps: `fix(graph): …`.

## Reporting a false positive

The most useful issue you can file. Include the intent frontmatter, the diff, and what
you expected. A false positive is treated as a higher-severity defect than a miss —
a checker that cries wolf gets switched off, and then it catches nothing at all.
