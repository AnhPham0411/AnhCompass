# Architecture

## What the system is

A rule written in Markdown, compared against a diff and the repository it lands in, by
engines of different strength, producing a verdict whose confidence is bounded by the
evidence behind it.

```
.agent/intent/*.md
        |
        v
   parse + zod ............ packages/core/src/intent
        |
        v
   scope filter ........... which rules govern which changed files
        |
        +--> deterministic engine ....... packages/core/src/engine/deterministic.ts
        |       |
        |       +-- lexical pass ........ tokenises the diff (JS/TS + Python)
        |       +-- graph pass .......... queries the import graph (TS/JS only)
        |
        +--> semantic engine ............ packages/core/src/engine/semantic.ts
                |
                +-- retrieval ........... graph neighbourhood, or a directory walk
                +-- one model call ...... packages/llm
        |
        v
   enforcement ............ deterministic + severity error -> block; everything else warns
        |
        v
   report ................. terminal / markdown / plain, plus a baseline diff
```

Three surfaces consume that pipeline: the CLI (`apps/cli`), the GitHub Action
(`apps/action`), and the MCP server (`apps/mcp-server`).

## Packages

| Package | Holds | May not |
|---|---|---|
| `packages/core` | Parsing, scoping, both engines, enforcement, baseline, reports | Read env, touch the network, log, or open a path it was not given |
| `packages/graph` | The import graph: indexer, query engine, providers | Be reached except through `GraphProvider` |
| `packages/llm` | Every model call, prompts, budget, cost logging | — |
| `apps/*` | I/O, wiring, process concerns | Contain logic that belongs in core |

The direction is one-way: `apps` depend on `core`, `core` depends on `graph` and `llm`,
and nothing depends on `apps`. The repository checks this about itself — the rules in
`.agent/intent/` are AnhCompass's own intents.

## The two deterministic engines are additive

The lexical pass always runs. The graph pass only adds to it.

This is the single most important decision in the codebase, and it was made after the
alternative shipped a bug three times. When the two engines were an `if/else`, attaching a
graph backend *replaced* the lexical scanner — and the indexer reads TypeScript while the
scanner also reads Python, so a repository with a JS frontend and a Python backend
answered `pass` on every Python violation, at confidence 1.0, the moment a `package.json`
appeared in its root.

Additive means attaching a backend can only surface more violations, never hide one. The
graph pass skips edges the lexical pass already reported or the developer waived, so the
two never double-count or contradict each other on a waiver.

## Uncertainty is a status, not a fallback

`uncertain` is what the pipeline returns when no engine could evaluate a rule: a
`no-cycle` rule with no graph backend, a rule whose files are absent from the index, a
model call that timed out. It is deliberately not `pass`.

Every serious bug this project has shipped has been the same shape — an engine that could
not see its input reporting a confident green light. `uncertain` is the type-level answer
to that, and the reason a graph rule now checks index coverage before it answers.

## Why an LLM verdict cannot block

Measured, not assumed. On the semantic corpus, the cheap model's recall was 100% and its
precision 70%: it blocked roughly a third of clean pull requests, once for the exact
opposite of what the rule said. A checker with that profile is valuable as an early
warning and destructive as a merge gate.

So `resolveEnforcement` keys on the engine, not on confidence: deterministic evidence at
severity `error` blocks; everything else warns. The full numbers are in BENCHMARKS.md.

## The graph

`Indexer` parses each file with the TypeScript compiler's parser — no type checker, no
`Program`, so it stays fast — and records import, re-export, `require`, dynamic import
and `import =` edges. Module specifiers resolve through the repository's own `tsconfig`
so path aliases become real edges. Results are cached per file by mtime.

`QueryEngine` answers four questions over that graph: `reachable`, `paths`, `cycles`
(Tarjan, with an explicit work stack so a deep chain cannot overflow) and `neighbors`. `paths` searches backwards from the forbidden module
and stops at the fifth witness — evidence needs a witness, not an enumeration, and the
number of simple paths in a module graph is exponential in hop count.

## Retrieval

For a semantic check, context comes from the import graph: files within two hops of the
change, ranked by whether they fall in the rule's scope, spent against a token budget in
rank order. The directory walk it replaced is still there behind `--no-graph-retrieval`
and still runs wherever no graph backend exists. Graph retrieval was kept because it
measured better — more recall on fewer tokens — not because it sounded better.
