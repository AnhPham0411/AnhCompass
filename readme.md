# AnhCompass — Intent & Drift Layer for Coding Agents

> **Design Document & Roadmap v1.1** · July 2026 · Owner: Anh · License: MIT (OSS core)
> **AnhCompass** — the compass that keeps your code and AI agents on the intended path.
> CLI/binary: `anhcompass` · npm scope: `@anhcompass/*` · GitHub Action: `anhcompass-action`

---

## 1. Overview

### 1.1. The Problem

Coding agents (Claude Code, Antigravity, Cursor, Codex) are getting exceptionally good at **understanding what the code is**, but there is no tool to enforce **what the code should be**:

- Agents are the biggest source of architectural drift: they optimize locally, take shortcuts, and break conventions until the codebase turns into a mess.
- Knowledge about "why the code is this way" and architectural decisions is scattered across human minds, lost chat logs, or dead ADRs.
- Existing memory tools (codebase-memory-mcp, CodeGraph, RepoBrain, Memorix) are **descriptive** — they describe the current state, but lack a normative baseline for conformance checking.

### 1.2. The Product

`anhcompass` is an **intent + drift detection layer** that sits on top of existing memory tools:

1. **Intent store** — normative architectural decisions, living in the repo (`.agent/intent/`), git-tracked, machine-readable, and human-reviewable via PRs.
2. **Drift engine** — compares the current code state with the intent baseline, detects drift, and provides evidence.
3. **3 Consumption Surfaces**: CLI (`anhcompass`), GitHub Action (PR comment bot), MCP server (agents self-load intents and self-check diffs).

### 1.3. Out of scope (v1)

- ❌ DO NOT build a custom code indexer / knowledge graph (adopt existing backends).
- ❌ DO NOT block merges in CI (v1 only `warns` — false positives kill trust quickly).
- ❌ DO NOT auto-update intent baselines based on code.
- ❌ NO multi-language support yet — v1 focuses on TypeScript/JavaScript.

---

## 2. Architecture

```
PROJECT: anhcompass
TYPE:    CLI Tool + GitHub Action + MCP Server (TypeScript monorepo)
STACK:   TypeScript (Node 20+), pnpm workspaces
```

- **GraphProvider adapter** -> Swappable graph backends.
- **Intent = markdown + frontmatter** -> Readable by humans, parsable by machines (zod).
- **Deterministic first, LLM second** -> Regex-based checks are free and fast, semantic intents use LLMs only when necessary.
- **Verdict cache by content hash** -> Re-pushing unchanged code costs $0.

---

## 3. Setup & Run

```bash
# Dev
git clone https://github.com/AnhPham0411/AnhCompass && cd AnhCompass
pnpm install
cp .env.example .env        # Fill in ANTHROPIC_API_KEY
pnpm build && pnpm test

# Use on any repo
cd ~/projects/my-app
npx anhcompass init              
npx anhcompass check --diff origin/main
```