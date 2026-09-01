# AnhCompass 🧭

> The intent and architectural drift layer for coding agents.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue)](https://www.typescriptlang.org/)

**AnhCompass** is an open-source tool designed to keep your codebase and AI coding agents (like Cursor, Claude Code, Antigravity) aligned with your project's architectural decisions. 

As coding agents become more autonomous, they tend to introduce "architectural drift" by optimizing locally and ignoring broader project conventions. AnhCompass provides a **normative baseline**—machine-readable architectural rules that your agents and CI pipelines can enforce.

---

## 🌟 Key Features

- **Intent Store:** Store architectural rules in plain Markdown (`.agent/intent/*.md`). Human-readable, machine-enforceable, and tracked via Git.
- **Deterministic Check:** Lightning-fast pattern checks for hard rules (forbidden imports, JS/TS **and** Python) that cost $0 and run in milliseconds.
- **Semantic Check:** Uses LLMs (Anthropic, OpenAI, or Gemini) to analyze code logic and semantics against your written intent.
- **Hybrid Enforcement:** Only deterministic evidence can *block* a pipeline — LLM verdicts are always warn-level. An AI judgment alone never gates your merge.
- **Baseline & Regression:** Snapshot verdicts, edit your rules, and get a diff report showing exactly which verdicts flipped — and whether the rule change caused it.
- **Agent-Ready (MCP Server):** Native integration with Model Context Protocol. AI agents can read your intents before coding and verify their diffs before submitting.
- **CI/CD Integration:** Includes a GitHub Action to automatically comment on Pull Requests when architectural drift is detected.

---

## What it catches, and what it does not

Measured on 139 benchmark cases, including 24 held out from development. Full numbers,
method and failures in [BENCHMARKS.md](BENCHMARKS.md).

**Caught, with evidence, in milliseconds and for $0:**

| | |
|---|---|
| Forbidden dependencies | every import form JS/TS and Python can express — default, named, namespace, side-effect, subpath, dynamic, `require`, `import =`, re-export, type-only, multi-line, scoped |
| Transitive dependencies | the forbidden module reached through files your diff never touched |
| Layer breaches | including one laundered through a directory that belongs to no layer |
| Cycles | two files or four, in or out of a rule's scope |
| Pre-existing violations | a diff that adds no import can still leave the repository in breach |

**Not caught, and worth knowing before you trust it:**

| | |
|---|---|
| Languages other than TS/JS and Python | Python gets the lexical pass only — no import graph, so no transitive answers |
| Dynamic dependencies built from variables | `import_module(name)` cannot be resolved without running the program |
| JSX text on its own line | can still be read as a real import; the tokeniser is not a JSX parser |
| Anything a model judged alone | semantic verdicts warn, they never block — measured precision was 70% on a cheap model, and a third of clean pull requests would have been blocked |
| Behaviour of agents using it | there is no measurement yet that AnhCompass makes a coding agent break architecture less often. It is the next thing to prove |

When no engine can evaluate a rule — a cycle rule with no graph backend, files missing
from the index, a model call that timed out — the answer is `uncertain`, never `pass`.

---

## 🚀 Quick Start

### 1. Installation

Currently, AnhCompass is in the hardening phase before its public npm release. To install it globally from source:

```bash
git clone https://github.com/AnhPham0411/AnhCompass.git
cd AnhCompass
pnpm install
pnpm build
npm link
```

### 2. Initialize in your repository

Navigate to your project folder and run the initialization command:

```bash
cd my-project
anhcompass init
```
*This will create the `.agent/intent/` directory, a sample intent, a `.env.example` file, and a GitHub workflow template.*

### 3. Add your LLM API Key
Semantic checks work with **Anthropic, OpenAI, or Gemini** — the provider is auto-detected from the key format (`sk-ant-...` → Anthropic, `sk-...` → OpenAI, otherwise Gemini):
```bash
export LLM_API_KEY="sk-..."        # or ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY
```
*(If no key is provided, AnhCompass will safely fallback to deterministic-only mode).*

### 4. Run Drift Check

Write some code, and before you commit, run:

```bash
anhcompass check
```
AnhCompass will scan your Git diff and report any architectural violations.

---

## 📝 Writing Intents

Intents live in `.agent/intent/`. They use a simple Markdown + Frontmatter format.

### Example: Deterministic Rule (No Lodash)
Use deterministic rules for strict, pattern-based checks (e.g., forbidden imports).

```yaml
---
schema_version: 1
id: no-lodash
title: No direct lodash imports
scope: ["src/**"]
check: deterministic
rule: |
  Do not import lodash directly. Use ES native arrays or custom utilities.
deterministic:
  kind: no-import
  from: ["src/**"]
  to: ["lodash"]
severity: warn
status: active
---

## Context
Lodash bloats our bundle size. Use vanilla JS alternatives.
```

### Example: Semantic Rule (Architecture)
Use semantic rules for complex architectural logic that requires AI reasoning.

```yaml
---
schema_version: 1
id: isolate-payment-gateway
title: Isolate Stripe behind PaymentService
scope: ["src/api/**", "src/services/**"]
check: semantic
rule: |
  API Controllers must never interact directly with the Stripe SDK.
  All Stripe logic must be encapsulated inside `src/services/payment.ts`.
severity: warn
status: active
---

## Context
We want to easily swap payment gateways in the future. Leaking Stripe objects to controllers breaks this boundary.
```

---

## 🤖 MCP Server for Coding Agents

If you use an MCP-compatible agent (like Cursor or Claude Code), you can attach AnhCompass as an MCP server. This allows the AI to automatically read your rules before writing code.

**Start the MCP Server:**
```bash
anhcompass-mcp
```
**Available MCP Tools:**

| Tool | What it does |
|---|---|
| `list_intents` | Every architectural rule defined in the project |
| `get_architecture_context` | Before writing: the rules that cover these specific files, plus the files' direct dependencies and dependents |
| `check_plan` | Before writing: reviews a plan against the rules, quoting the sentence that would breach one. Advisory — a plan cannot violate anything yet |
| `check_drift` | After writing: checks the working tree diff |
| `explain_violation` | Why a rule exists, what triggered it, how to fix it, and how to waive it deliberately |
| `verify_fix` | Re-checks only the files that were just changed |

Together these close the loop an agent works in: read the constraints, propose, check the proposal, write, verify. Output is plain text — no terminal escape codes.

---

## ☁️ GitHub Action

AnhCompass comes with a built-in GitHub Action to prevent drift during code review.

```yaml
name: AnhCompass Drift Check
on: [pull_request]

jobs:
  check-drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Run AnhCompass
        uses: AnhPham0411/AnhCompass/apps/action@main
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

The bot will leave a sticky comment on the PR detailing any architectural drift, pointing out the exact file and lines that violate the intent.

By default the job **fails only on blocking violations** (deterministic evidence + `severity: error`). Control this with the `fail-on` input: `block` (default), `any` (also fail on LLM warn-level findings — not recommended), or `never`.

---

## 🛡️ Enforcement Levels (Hybrid Enforcement)

Every violation carries an enforcement level, resolved by the pipeline:

| Evidence | `severity: error` | `severity: warn` |
|---|---|---|
| **Deterministic** (pattern match) | 🚫 `block` | ⚠️ `warn` |
| **Semantic** (LLM) | ⚠️ `warn` — always | ⚠️ `warn` |

An LLM verdict can never block a merge on its own — semantic checks are probabilistic and act as an early-warning layer, not a gatekeeper. In the CLI:

```bash
anhcompass check --strict       # exit 1 only on BLOCKING violations (CI-safe)
anhcompass check --strict-all   # exit 1 on any violation, including LLM warnings (opt-in)
```

---

## 📈 Baseline & Regression Testing for Intents

When you edit a rule, how do you know it doesn't suddenly flag half your codebase — or silently stop catching things? Snapshot first, then compare:

```bash
# 1. Take a baseline on a known-good state
anhcompass check --diff origin/main --save-baseline

# 2. Edit your intents (or code), then compare
anhcompass check --diff origin/main --compare-baseline
```

The comparison reports **regressions** (`pass → violation`), **improvements**, new/removed intents, and marks each change with whether the *rule text itself* changed since the baseline (`rule changed`) — so you can tell "my code drifted" apart from "my rule got stricter". With `--strict`, regressions fail the run.

---

## 🧪 Benchmarks

The repo ships a benchmark suite (`benchmarks/`) measuring both engines against labeled cases — correct code, wrong code, edge cases, and realistic AI-generated diffs:

```bash
pnpm bench                          # lexical cases — free, offline, runs in CI
pnpm bench -- --graph               # plus the import-graph cases (also free)
pnpm bench -- --semantic            # plus the LLM cases (needs an API key, ~5 cents)
pnpm bench -- --semantic --compare-retrieval  # graph vs directory-walk retrieval
pnpm bench -- --model gpt-4o        # pin the model for the semantic slice
```

Reports precision / recall / F1 / accuracy per engine and category, plus latency percentiles and LLM cost. Results land in `benchmarks/results/report.{json,md}`. See [BENCHMARKS.md](BENCHMARKS.md) for the latest numbers and [PERFORMANCE.md](PERFORMANCE.md) for cost at scale.

Every deterministic case runs twice, once with a graph backend attached and once without, because those are two different engine configurations and a repository's contents decide which one the CLI uses. That second pass exists because its absence once hid a bug that answered `pass` on violating repositories — the story is in BENCHMARKS.md.

## 🔎 How the two deterministic engines fit together

The **lexical scanner** reads the diff and finds direct dependencies, in every language it supports. The **import graph** reads the whole repository and finds transitive and structural ones, but indexes TypeScript and JavaScript only.

They are additive: the scanner always runs, and the graph only adds to it. Attaching a graph backend can surface more violations, never fewer. If a rule needs the graph and no graph is available — a `no-cycle` rule in a repository the indexer cannot read — the verdict is `uncertain`, never a `pass` that was never checked.

The graph also decides what a semantic check gets to read. Rather than walking directories until the context budget runs out, AnhCompass follows imports out from the changed files, so a rule broken two files away from the diff is still visible. Measured against the directory walk it finds more on fewer tokens ([BENCHMARKS.md](BENCHMARKS.md)); `--no-graph-retrieval` restores the walk.

---

## 🛠️ CLI Commands

| Command | Description |
|---|---|
| `anhcompass init` | Scaffold `.agent/intent` directory and templates. |
| `anhcompass intent new <id>` | Create a new intent markdown file. |
| `anhcompass compile` | Compile intents into `_index.md` and `manifest.json`. |
| `anhcompass check` | Scan the current Git diff (including untracked files) for intent violations. |
| `anhcompass check --strict` | Exit 1 on blocking violations — safe default for CI. |
| `anhcompass check --save-baseline` | Snapshot verdicts as the regression baseline. |
| `anhcompass check --compare-baseline` | Diff current verdicts against the baseline. |
| `anhcompass doctor` | Verify intent syntax and workspace health. |

---

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.