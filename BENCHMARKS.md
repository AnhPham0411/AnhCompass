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
| `graph-structural.json` | 9 | `no-cycle` and `layer-boundary`: cycles of two and three files, a cycle out of scope, a cycle the diff does not touch, and the allowed, skipped, reversed and intra-layer directions |
| `semantic.json` | 14 | Prose rules requiring judgment: layering, error handling, secrets, purity, plus buried violations in agent-shaped diffs |
| `semantic-retrieval.json` | 2 | Repositories holding more in-scope files than the context budget allows, where the file that decides the verdict is not the one a directory walk reaches first |
| `seed.json` | 2 | Original smoke cases |
| **Total** | **113** | |

Every deterministic case runs twice — with and without a graph provider attached — because
those are two different engine configurations and the CLI picks between them by whether a
`package.json` exists. See *What the corpus was not measuring* below.

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

## Phase 1 — AST + import graph, 2026-09-01

Same corpus, same labels, nothing rewritten to fit. The regex matcher was replaced by a
tokenizer (`packages/core/src/engine/scanner.ts`), and the 20 graph cases were enabled.

| Slice | Cases | TP | TN | FP | FN | Precision | Recall | F1 | Accuracy | p50/p95 |
|---|---|---|---|---|---|---|---|---|---|---|
| deterministic (all) | 68 | 33 | 35 | 0 | 0 | **100%** | **100%** | **100%** | 100% | 1ms / 3ms |
| deterministic / correct | 19 | 0 | 19 | 0 | 0 | 100% | 100% | 100% | 100% | 1ms / 2ms |
| deterministic / wrong | 23 | 23 | 0 | 0 | 0 | 100% | 100% | 100% | 100% | 1ms / 2ms |
| deterministic / edge | 26 | 10 | 16 | 0 | 0 | **100%** | **100%** | **100%** | 100% | 1ms / 4ms |
| graph (all) | 20 | 14 | 6 | 0 | 0 | **100%** | **100%** | **100%** | 100% | 22ms / 40ms |
| semantic (all) | 14 | 7 | 4 | 3 | 0 | **70.0%** | **100%** | 82.4% | 78.6% | 2353ms / 4969ms |

Movement against the baseline: deterministic/edge precision **42.9% → 100%**, recall
**60.0% → 100%**. All 12 known failures are gone, all 20 graph cases pass, and `pnpm bench`
exits 0.

### Why the failures were failures

Every one of the 8 false positives was a matcher reading text as if it were code — a
commented import, a codegen template string, a markdown fence. Every one of the 4 false
negatives was a dependency the line-oriented matcher could not see — a specifier on its
own line, a re-export, a comma-separated Python import list.

Tokenizing removes both classes at once rather than patching them individually: comments
and string bodies never reach the matcher, and statements are matched across line breaks.
The fix is ~330 lines with no new dependency. One known limit is documented in the source:
a regex literal containing import-like text is still tokenized as code.

### The semantic slice, measured for the first time

`gpt-4o-mini`, 14 cases, three consecutive runs with identical results:

**Recall 100%, precision 70%.** It missed nothing and cried wolf on 3 of 10 clean diffs.

| False positive | What the model said |
|---|---|
| `sem-controller-delegates` | "The controller is directly calling a service method… violates the rule that business logic should reside in the service layer" — delegating to the service is exactly what the rule asks for. The model inverted it. |
| `sem-test-fixture-secret` | Flagged an obvious test placeholder as a hardcoded credential. |
| `sem-ai-generated-clean` | Called input validation and status-code choice "business logic" on a diff that respects the boundary. |

This is the empirical case for hybrid enforcement, and it is why the LLM verdict is
warn-only in code rather than as a matter of taste. A checker with this profile is
valuable as an early-warning layer — it finds things the deterministic engine cannot
express — and would be actively harmful as a merge gate: roughly a third of the clean
pull requests it examined would have been blocked, one of them for the opposite of what
the rule says.

Cost is not the constraint: 14 calls, 7911 input / 2024 output tokens, **$0.0024** total.
Latency is — p95 ≈ 5s per intent versus 3ms for the deterministic engine.

## What the corpus was not measuring — 2026-09-01

Phase 1 reported 100% on the deterministic corpus. That number was true and it was
misleading, because the corpus ran the deterministic cases with **no graph provider
attached**, and the CLI attaches one on any repository containing a `package.json` or
`tsconfig.json`. The two engines were an `if/else`: with a provider present, the lexical
scanner never ran.

The graph indexer reads `.ts/.tsx/.js/.jsx`. So on a repository holding both a JavaScript
frontend and a Python backend — an ordinary shape — every Python violation was answered
`pass`, with confidence 100%. Reduced to its smallest form:

| Repository | Verdict |
|---|---|
| `src/app.py` with `import requests`, intent forbidding `requests` | ✗ VIOLATION — correct |
| the same repository plus a one-line `package.json` | ✓ **PASS** — wrong |

A suppression comment had the mirror-image bug: `// anhcompass-disable-line no-lodash`
was honored by the lexical pass and ignored by the graph pass, so the same waiver worked
or failed depending on whether a `package.json` happened to sit in the root.

**The fix** is that the engines are now additive rather than exclusive. The lexical pass
always runs; the graph pass only adds to it, skipping edges the lexical pass already
reported or the developer waived. Attaching a graph backend can now only surface more
violations, never hide one. A rule kind that no available engine can evaluate — a
`no-cycle` rule on a repository with no graph backend — returns `uncertain` instead of
the `pass` it used to return without checking anything.

**The corpus now measures the shipped path.** Every deterministic case runs twice, once
in each engine configuration, and both must agree with the label. That second pass is what
would have caught this, and it is why the table below has a row that did not exist before.

| Slice | Cases | TP | TN | FP | FN | Precision | Recall | Accuracy |
|---|---|---|---|---|---|---|---|---|
| deterministic (all) | 68 | 33 | 35 | 0 | 0 | 100% | 100% | 100% |
| deterministic + graph provider | 68 | 33 | 35 | 0 | 0 | 100% | 100% | 100% |
| graph (all) | 29 | 18 | 11 | 0 | 0 | 100% | 100% | 100% |
| semantic (all) | 14 | 7 | 7 | 0 | 0 | 100% | 100% | 100% |

The graph slice grew from 20 to 29: `no-cycle` and `layer-boundary` were configurable in
the schema and implemented in code with no case covering either. They now have nine —
cycles of two and three files, a cycle outside the rule's scope, a pre-existing cycle the
diff does not touch, and the allowed, skipped, reversed and intra-layer directions.

### The semantic slice reached 100%, and not the way expected

The three false positives were the same failure twice over: the model quoted the rule
correctly and then concluded the opposite of what it says. Against a rule reading
*"controllers may parse input, call exactly one service, and shape the response"*, it
flagged a controller for calling a service.

Two attempts, one useful:

| Change | Precision | Recall |
|---|---|---|
| `gpt-4o-mini`, prompt v1 | 70.0% | 100% |
| `gpt-4o-mini`, prompt v2 — quote the violated clause, label each file's role | **70.0%** | 100% |
| `gpt-4o`, prompt v2 | **100%** | 100% |

Prompt v2 changed nothing measurable. It did make the failure legible: with the model now
required to quote the clause it was enforcing, the inversion was visible in the output
rather than inferred. The corpus says this was a model-capability limit, not a prompt gap,
and no amount of further prompt work was going to move it.

So the default routing changed: conformance judgment goes to the accurate tier, and cost
is the opt-in (`--model`). The suite costs $0.0392 against $0.0027 — fourteen times more,
and four cents. False positives are what get a checker switched off; that is the more
expensive currency.

**One caveat on this result.** Fourteen cases is a small sample, and 100% on it should be
read as "no measurable errors at this size", not as a precision guarantee. The semantic
slice needs to grow before it can carry more weight than that.

## Phase 2 — retrieval, 2026-09-01

The question was whether following the import graph beats walking directories when
gathering code context for a semantic check. Until now it could not be asked: the
benchmark never ran the graph path, and when run by hand the two strategies returned
**identical** token counts on every case. Not a tie — the fixtures were two files each,
so a 6,000-token budget held the whole repository either way and there was nothing to
choose between.

Two things had to change before a measurement meant anything.

**The ranking was inert.** The graph path ranked its candidates and then passed them to a
function that selects files in directory order, so the rank was computed and discarded.
Retrieval that has decided what matters most now spends the budget in that order
(`readFilesInOrder`).

**The corpus could not discriminate.** `semantic-retrieval.json` adds two repositories
with twenty in-scope files ahead of the one that decides the verdict — more than the
context budget admits. The pair is deliberate: one where the file behind the budget holds
a violation, one where it is clean, so a strategy cannot win by simply reaching further
and reporting more.

| Retrieval | Cases | TP | TN | FP | FN | Precision | Recall | Input tokens | Cost |
|---|---|---|---|---|---|---|---|---|---|
| glob-walk | 16 | 7 | 8 | 0 | 1 | 100% | **87.5%** | 14,418 | $0.0510 |
| graph neighbourhood | 16 | 8 | 8 | 0 | 0 | 100% | **100%** | **12,098** | **$0.0457** |

Graph retrieval wins on every axis at once: it finds the violation the walk misses, on
16% fewer input tokens, for less money. The walk's miss is `sem-retrieval-violation-past-budget`,
and it answered `uncertain` rather than `pass` — the honest failure, but a miss.

That is enough to make it the default. `--no-graph-retrieval` restores the walk, and the
walk still runs automatically wherever no graph backend exists.

Reproduce with `pnpm bench -- --semantic --compare-retrieval`.

## Phase 3 — closed loop, 2026-09-01

The MCP surface advertised six tools. Three worked, one returned every intent regardless
of scope, and two returned the string `[Not Implemented in Phase 3 yet]` — to an agent,
indistinguishable from a real answer. All six now work, and there is an integration test
that drives the built server over stdio rather than testing the functions behind it.

| Tool | What changed |
|---|---|
| `check_drift`, `verify_fix` | Emitted ANSI colour codes into a tool result. An MCP client is a program; it now gets plain text |
| `get_architecture_context` | Returned every intent (`filter(() => true)`). Now returns only the rules whose scope covers the named files, with each rule's text and the file's direct dependencies |
| `check_plan` | Implemented: reviews a plan against the active rules before code exists, quoting the sentence that would breach one. Advisory by construction — a plan cannot violate anything yet, so nothing here blocks |
| `explain_violation` | Implemented: the rule, why it exists, the evidence, the fix, and the waiver syntax. Given a diff it cannot parse it now says so, rather than reporting `pass` on input nobody read |

## Outside evidence — dependency-cruiser, 2026-09-01

Everything above is self-graded: a corpus written by the same hand that wrote the engines,
on repositories built for the test. The obvious way that fails is a shared blind spot, and
it already has — twice, the corpus read 100% while the product answered `pass` on a
violating repository.

So: a real project, and rules nobody here wrote. `sverweij/dependency-cruiser` ships
`.dependency-cruiser.mjs`, twenty architectural rules its maintainer actually enforces.
Two were transcribed verbatim into intents — `restrict-fs-access`, with its list of eleven
exempt paths, and `cli-to-main-only` — and run against the project's own history.

| Input | Result |
|---|---|
| Real diff, `HEAD~40` (270 files, +10,869 / −13,251) | 2 pass, **0 false positives** |
| Real diffs, `HEAD~25` and `HEAD~10` | 2 pass each, **0 false positives** |
| `import fs from "fs"` planted in `src/report/` | caught |
| `src/cli/` importing `src/extract/` planted | caught |

That is the first false-positive measurement on legitimate work this project has, and the
first check of any kind against rules it did not author.

It also found the bug the corpus could not. `cli-to-main-only` first reported **pass with
the violation sitting in front of it**: the graph indexer read `.ts/.tsx/.js/.jsx` while
dependency-cruiser is written in `.mjs`, so the layer rule was evaluated against an index
that contained none of the files it governs. The graph was not empty — 584 nodes — just
empty of anything relevant, which is why nothing looked wrong.

Third instance of one failure: an engine that cannot see its input reporting a confident
green light. Fixed twice at the cause (the indexer now matches the scanner's file
coverage) and once at the principle: a rule only the graph can answer, over an index
holding none of its files, now returns `uncertain`.

**What this evidence is not.** One repository, two rules, three diffs. It shows the tool
does not cry wolf on one real codebase; it says nothing about how it behaves on a hundred.

## What each phase must move

| Phase | Target | Status |
|---|---|---|
| 1 — AST + import graph | deterministic/edge precision → 100% (all 8 FP are parse-level), the 4 FN fixed, 20 graph cases enabled and passing | ✅ done — see above |
| 2 — retrieval | semantic slice measured twice on the same corpus: current glob-walk context vs graph-neighborhood context. Report token count, recall and FP for both | ✅ done — graph retrieval wins on recall, tokens and cost, and is now the default |
| 3 — closed loop | no new accuracy target; corpus guards against regression | ✅ done — all six MCP tools implemented, with a stdio integration test |

Two negative results are kept above rather than deleted: prompt v2 bought nothing on the
cheap model, and graph retrieval was indistinguishable from the directory walk until the
corpus was built to tell them apart. A benchmark that only records its wins is a
brochure.
