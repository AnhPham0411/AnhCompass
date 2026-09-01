# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Mutation testing** (`pnpm mutate`). The first measurement said the suite was worth
  **43.9%**: of 3,015 mutants, 968 — a third of the codebase — were never reached by a
  test at all, while coverage reported otherwise. Six modules had no tests, including the
  pipeline that orchestrates every check. After 224 new tests it reads **68.35%**, with
  117 mutants unreached.

  The threshold is set at 65 rather than the 70 originally written down: 70 was chosen
  before any measurement existed, and the remaining survivors are largely mutants no test
  can distinguish — a changed zod message, a default value nothing reads. A threshold
  below the measured score catches a regression; one above it only reports the same
  failure forever.
- **Held-out benchmark corpus** (`benchmarks/cases/holdout/`, 24 cases). Cases are written
  from rule semantics and are not used to debug the engine. The report prints `dev` and
  `holdout` as separate rows, because an engine measured only on the corpus it was tuned
  against has learned the corpus.
- `--provider` / `LLM_PROVIDER` to declare the model vendor explicitly. The old guess from
  the key prefix remains as a fallback and now says when it is guessing.
- Unit tests for `packages/graph` (30) and `packages/llm` (26), which had none.
- CI runs on Linux, Windows and macOS against Node 20 and 22.
- `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `ARCHITECTURE.md`, issue and
  pull request templates.

### Fixed

- **False positive on JSX text.** `<p>run: import _ from 'lodash'</p>` was reported as a
  lodash dependency. An `import … from` declaration is now only read in statement
  position, which is where the grammar allows it. Found by the holdout corpus.
- **Missed Python dynamic imports.** `importlib.import_module('requests')` and
  `__import__('requests')` are dependencies and were invisible. Found by the holdout corpus.
- **Monorepo path aliases were not resolved.** The indexer searched upward for
  `tsconfig.json` and could adopt the compiler options of an unrelated project above the
  repository root, while a repo whose root holds only `tsconfig.base.json` — the monorepo
  convention — got none at all. The search now stays inside the repository and knows both
  filenames.
- **`paths()` could hang on a dense graph.** It enumerated every simple path up to ten
  hops and then kept five. It now searches breadth-first from the forbidden module and
  stops at the fifth result, with a ceiling on work done.
- **`cycles()` overflowed the stack on a deep dependency chain.** It is now Tarjan with
  an explicit work stack; a 50,000-module chain answers instead of crashing, and there is
  a test at that size. The witness-cycle search inside a strongly connected component
  carries the same expansion ceiling as `paths()`.
- **Bare import specifiers resolved to files instead of packages.** After the resolver
  started using the TypeScript module resolver, `lodash` became
  `node_modules/.pnpm/lodash@4/node_modules/lodash/index.js` — a node no rule can name and
  the walker never indexes — so every graph-based dependency rule silently matched
  nothing on a repository with its dependencies installed. A bare specifier stays the
  package it names; only one landing on first-party source becomes a path, which is what
  keeps a `paths` alias a real edge.
- **The graph cache outlived the logic that filled it.** It is keyed by file mtime, which
  answers "did this file change" and not "would it resolve differently now", so the fix
  above appeared not to work until the cache was cleared by hand. The cache file now
  carries a format version and is discarded when the resolver changes.
- A retryable HTTP response is drained before the retry, instead of leaking its socket.
- `anhcompass init` no longer replaces an existing `.gitignore` when it cannot read it —
  only a genuine ENOENT leads to a write.
- A typo in `--provider` prints what the valid values are instead of an unhandled
  rejection stack.
- `providerWasInferred` and `resolveLlmProvider` now agree about a blank `LLM_PROVIDER`,
  so the "guessed from the key" warning cannot go missing.
- A benchmark case that declares a `split` disagreeing with its directory stops the run
  rather than being silently overwritten.
- LLM calls have a 30s timeout and retry 429/5xx with backoff. Failures carry a request id.
- The repository walk skips build output and directories named in the root
  `.gitignore`, including a trailing-wildcard pattern. On this repository that pattern
  (`real-demo*/`, seventeen thousand generated fixture files) took `anhcompass check`
  from over two minutes to one second, cold.
- A corrupt graph cache entry is dropped rather than fed to the query engine as an index.

### Changed

- The published `anhcompass` binary bundles the workspace packages. They are private and
  unpublished, so a consumer could not have resolved them.
- `benchmarks/cases/` split into `dev/` and `holdout/`.

### Removed

- `semantic-expansion.json`: 72 generated cases covering 2 rules and 4 diffs. Corpus
  padding inflates the apparent size of the evidence without adding any.
