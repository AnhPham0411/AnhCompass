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

## 🚀 Quick Start

### 1. Installation

You can install AnhCompass globally or run it locally via `npx`:

```bash
npm install -g anhcompass
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
- `list_intents`: Returns all active architectural rules for the current project.
- `check_drift`: Analyzes the agent's current working tree diff and highlights violations.

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
pnpm bench                # deterministic cases — free, offline, runs in CI
pnpm bench -- --semantic  # semantic cases too (needs an LLM API key, costs ~cents)
```

Reports precision / recall / F1 / accuracy per engine and category, plus latency percentiles and LLM cost. Results land in `benchmarks/results/report.{json,md}`. See [BENCHMARKS.md](BENCHMARKS.md) for the latest numbers.

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