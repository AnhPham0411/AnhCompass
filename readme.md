# AnhCompass 🧭

> The intent and architectural drift layer for coding agents.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue)](https://www.typescriptlang.org/)

**AnhCompass** is an open-source tool designed to keep your codebase and AI coding agents (like Cursor, Claude Code, Antigravity) aligned with your project's architectural decisions. 

As coding agents become more autonomous, they tend to introduce "architectural drift" by optimizing locally and ignoring broader project conventions. AnhCompass provides a **normative baseline**—machine-readable architectural rules that your agents and CI pipelines can enforce.

---

## 🌟 Key Features

- **Intent Store:** Store architectural rules in plain Markdown (`.agent/intent/*.md`). Human-readable, machine-enforceable, and tracked via Git.
- **Deterministic Check:** Lightning-fast regex-based checks for hard rules (like forbidden imports) that cost $0 and run in milliseconds.
- **Semantic Check:** Uses LLMs (Anthropic Claude) to analyze code logic and semantics against your written intent.
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

### 3. Add your Anthropic API Key
For semantic checks to work, AnhCompass needs an Anthropic API key.
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
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

---

## 🛠️ CLI Commands

| Command | Description |
|---|---|
| `anhcompass init` | Scaffold `.agent/intent` directory and templates. |
| `anhcompass intent new <id>` | Create a new intent markdown file. |
| `anhcompass compile` | Compile intents into `_index.md` and `manifest.json`. |
| `anhcompass check` | Scan the current Git diff for intent violations. |
| `anhcompass doctor` | Verify intent syntax and workspace health. |

---

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.