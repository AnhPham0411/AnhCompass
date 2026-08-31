# AnhCompass Benchmark Results

> Reproduce: `pnpm bench` (deterministic, free, offline) · `pnpm bench -- --semantic` (needs an LLM API key) · `pnpm bench -- --graph` (needs the graph engine, Phase 1).
> Corpus: `benchmarks/cases/` — every case is labeled from **rule semantics**, never from observed engine behavior.
> Categories: **correct** (clean code) · **wrong** (clear violations) · **edge** (tricky but decidable) · **ai-generated** (realistic multi-file coding-agent diffs).

## Corpus

| File | Cases | What it covers |
|---|---|---|
| `det-import-syntax.json` | 22 | Import forms a dependency can take: default / named / namespace / side-effect / subpath / dynamic / require / import-equals / re-export / type-only / multi-line / scoped package |
| `det-false-positive.json` | 18 | Text that *looks* like an import but is not one: comments, JSDoc, string and template literals, markdown fences, manifest entries, similar package names |
| `det-scope.json` | 12 | Glob boundaries, suppression comments (targeted / bare / wrong-intent), multi-file diffs, removals |
| `det-python.json` | 14 | Python import forms and their look-alikes |
| `graph-layering.json` | 20 | Transitive and layer-boundary dependencies — the forbidden edge is reached through files the diff never touches |
| `semantic.json` | 14 | Prose rules requiring judgment: layering, error handling, secrets, purity, plus buried violations in agent-shaped diffs |
| `seed.json` | 2 | Original smoke cases |
| **Total** | **102** | |

## Baseline — 2026-08-31, before Phase 1

This is the **regex engine measured honestly**, on the corpus above. It is the number Phase 1 has to beat, published here rather than hidden.

| Slice | Cases | TP | TN | FP | FN | Precision | Recall | F1 | Accuracy | p50/p95 |
|---|---|---|---|---|---|---|---|---|---|---|
| deterministic (all) | 68 | 29 | 27 | 8 | 4 | **78.4%** | **87.9%** | **82.9%** | 82.4% | 0ms / 1ms |
| deterministic / correct | 19 | 0 | 19 | 0 | 0 | 100.0% | 100.0% | 100.0% | 100.0% | 0ms / 0ms |
| deterministic / wrong | 23 | 23 | 0 | 0 | 0 | 100.0% | 100.0% | 100.0% | 100.0% | 0ms / 0ms |
| deterministic / edge | 26 | 6 | 8 | 8 | 4 | **42.9%** | **60.0%** | **50.0%** | 53.8% | 0ms / 2ms |

20 graph cases and 14 semantic cases are not counted above — graph cases are skipped until the engine exists (Phase 1), semantic cases need an API key.

### Reading these numbers

The headline is the **edge slice: precision 42.9%, recall 60.0%.** The obvious cases (`correct`, `wrong`) are at 100% and always were — that is what the previous 2-case corpus measured. Everything a real repository actually contains lives in `edge`, and there the current engine is close to a coin flip.

`pnpm bench` exits 2 today. That is the intended state at the end of Phase 0: the corpus exists specifically to make the gap visible.

### The 12 known failures

**8 false positives — all one root cause: matching text instead of parsing code.**

| Case | Input |
|---|---|
| `det-fp-line-comment` | `// import _ from 'lodash';` |
| `det-fp-block-comment` | `/* import _ from 'lodash'; */` |
| `det-fp-jsdoc-example` | `* @example import { chunk } from 'lodash';` |
| `det-fp-commented-require` | `// const _ = require('lodash');` |
| `det-fp-string-literal` | a codegen template string containing an import |
| `det-fp-template-literal` | a backtick string containing `require('lodash')` |
| `det-fp-test-assertion` | `expect(output).toContain("import _ from 'lodash'")` |
| `det-fp-markdown-fence` | a `.md` file in scope showing the old pattern |

Every one of these tells a developer their correct code is a violation. This is the failure mode that gets a tool switched off.

**4 false negatives — line-oriented matching cannot see the dependency.**

| Case | Input |
|---|---|
| `det-syntax-multiline` | specifier on a line with no `import` keyword |
| `det-syntax-reexport` | `export { chunk } from 'lodash';` |
| `det-syntax-reexport-star` | `export * from 'lodash';` |
| `det-py-multiple-on-line` | `import json, requests` |

**Not counted, and worse:** the 20 `graph-layering.json` cases. The current engine cannot express an answer to them at all. `graph-transitive-unchanged-hop` is the sharpest — the diff adds no import, the forbidden path already exists in the repo, and an added-lines-only checker reports PASS on a violating repository.

## What each phase must move

| Phase | Target |
|---|---|
| 1 — AST + import graph | deterministic/edge precision → 100% (all 8 FP are parse-level), the 4 FN fixed, 20 graph cases enabled and passing |
| 2 — retrieval | semantic slice measured twice on the same corpus: current glob-walk context vs graph-neighborhood context. Report token count, recall and FP for both. `sem-violation-outside-diff` is the case that separates them |
| 3 — closed loop | no new accuracy target; corpus guards against regression |

If Phase 2 cannot show graph-backed retrieval beating the glob walk on this corpus, that result gets published here too.
