# CLAUDE.md — AnhCompass

## Context

AnhCompass = intent & drift layer for coding agents: normative intent store in `.agent/intent/`, drift engine comparing code with intent, 3 surfaces: CLI / GitHub Action / MCP.

## Architectural Rules (Violation = Redo, Non-negotiable)

1. **LLM calls MUST be inside `packages/llm`.** No other package is allowed to import `@anthropic-ai/sdk` or make HTTP calls to any LLM API.
2. **Graph backend MUST only be accessed via the `GraphProvider` interface** in `packages/graph`.
3. **`packages/core` is pure logic**: no `process.env`, no network, no direct `fs` unless path is passed via parameters, no `console.log`. I/O and wiring live in `apps/*`.
4. **All external data goes through zod before use**: frontmatter, env, CLI args, LLM output.
5. **A verdict without evidence cannot carry a `violation` status.** If uncertain → `uncertain`.

## Code Standards

- TypeScript `strict: true`, ESM, Node >= 20, pnpm workspaces.
- Typed errors; no bare `catch (e) {}` swallowing errors.
- Clean separation with `import type`. Functions < 40 lines. Single responsibility per file.
- Use `pino` for logging, only in `apps/*`. No hardcoded secrets.
- Meaningful variable names.

## Commands

```bash
pnpm install
pnpm -r build        # tsup for each package
pnpm test            # vitest across workspace
pnpm lint && pnpm typecheck
```