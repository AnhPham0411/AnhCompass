# TASKS-PHASE0.md — AnhCompass Phase 0

> Phase 0: Skeleton & Intent Store (14–20/07/2026)

**DoD:** clone repo → `pnpm i` → viết 1 intent → `anhcompass compile` ra `_index.md` + manifest hợp lệ; parser test coverage cho mọi lỗi frontmatter phổ biến.

---

## T0 — Monorepo scaffold ✅
- [x] `package.json` root (pnpm workspaces)
- [x] `pnpm-workspace.yaml`
- [x] `tsconfig.base.json` (strict: true, ESM)
- [x] `.gitignore`, `.env.example`
- [x] `vitest.config.ts` root

## T1 — `@anhcompass/core`: schema + parser ✅
- [x] `packages/core/src/intent/schema.ts` — zod schemas (IntentFrontmatter, Verdict)
- [x] `packages/core/src/intent/parser.ts` — parseIntentFile, parseIntentDir, IntentParseError
- [x] `packages/core/src/intent/lifecycle.ts` — canTransition, assertTransition
- [x] `packages/core/tests/parser.test.ts` — coverage mọi lỗi frontmatter
- [x] `packages/core/tests/lifecycle.test.ts`

## T2 — `@anhcompass/core`: compile ✅
- [x] `packages/core/src/compile/index-builder.ts` — buildIndex → _index.md
- [x] `packages/core/src/compile/manifest.ts` — buildManifest → manifest.json
- [x] `packages/core/tests/compile.test.ts`

## T3 — CLI `anhcompass` ✅
- [x] `apps/cli/src/index.ts` — commander entry
- [x] `apps/cli/src/commands/compile.ts` — `anhcompass compile`
- [x] `apps/cli/src/commands/doctor.ts` — `anhcompass doctor` (parse-only)
- [x] `apps/cli/src/commands/intent-new.ts` — `anhcompass intent new <id>`

## T4 — Dogfood intents ✅
- [x] `.agent/intent/no-llm-outside-llm-pkg.md`
- [x] `.agent/intent/provider-behind-interface.md`

## T5 — CI + pnpm install + test xanh ⏳
- [ ] `pnpm install` thành công
- [ ] `pnpm test` xanh (vitest)
- [ ] `pnpm build` thành công
- [ ] `pnpm run anhcompass compile` chạy ra `_index.md` + `manifest.json`
- [ ] `.github/workflows/ci.yml`

---

> Sau khi T5 xong: chuyển sang Phase 1 — Drift Engine.
