# AnhCompass — Intent & Drift Layer cho Coding Agents

> **Tài liệu thiết kế & roadmap v1.1** · Tháng 07/2026 · Owner: Anh · License dự kiến: MIT (OSS core)
> **AnhCompass** — chiếc la bàn giữ cho code và agent đi đúng hướng đã định.
> CLI/binary: `anhcompass` · npm scope: `@anhcompass/*` · GitHub Action: `anhcompass-action`

---

## 1. Tổng quan

### 1.1. Vấn đề

Coding agents (Claude Code, Antigravity, Cursor, Codex...) ngày càng mạnh về **hiểu code đang thế nào**, nhưng không có tool nào giữ được **code phải thế nào**:

- Agent là nguồn drift lớn nhất: mỗi session nó tối ưu cục bộ, đi đường tắt, phá convention mà không ai bắt được cho đến khi codebase nát.
- Kiến thức "tại sao code như vậy" và các quyết định kiến trúc nằm rải rác trong đầu người, trong chat log đã mất, hoặc trong ADR chết không ai đọc.
- Các tool memory hiện có (codebase-memory-mcp, CodeGraph, RepoBrain, Memorix, knowledge base native của Antigravity/Cursor) đều **descriptive** — mô tả hiện trạng, không có baseline normative để check conformance.

### 1.2. Sản phẩm

`anhcompass` là **tầng intent + drift detection** đứng trên các tool memory có sẵn:

1. **Intent store** — các quyết định kiến trúc dạng normative, sống trong repo (`.agent/intent/`), git-tracked, máy đọc được và người review được qua PR.
2. **Drift engine** — so hiện trạng code (lấy từ graph backend có sẵn) với intent baseline, phát hiện lệch, đưa dẫn chứng.
3. **3 bề mặt tiêu thụ**: CLI (`anhcompass`), GitHub Action (bot comment PR), MCP server (agent tự load intent và tự soi diff của mình).
4. **v2 — Distill engine**: phát hiện workflow lặp lại trong session logs, đề xuất đóng gói thành CLI script / SKILL.md riêng cho dự án.

### 1.3. Định vị chiến lược — Adopt vs Build

| Tầng | Trạng thái thị trường | Quyết định |
|---|---|---|
| 1. Structural map (AST/graph) | Commoditized — codebase-memory-mcp, CodeGraph... open-source, đa agent | **ADOPT** qua adapter |
| 2. Descriptive knowledge (notes) | Đông đúc — RepoBrain, Memorix, native memory của platform | **CONSUME** (đọc làm ngữ cảnh, không sở hữu format) |
| 3. Intent baseline + drift check | **Chưa ai làm** cho agent workflow | **BUILD — sản phẩm chính** |
| 4. Auto-package CLI/skill + telemetry | Chưa ai làm | **BUILD — v2** |

Nguyên tắc: *build on the commodity, own the scarcity*. Không cạnh tranh với tầng 1–2; đứng lên trên chúng và vendor-neutral trước tầng platform (Antigravity/Cursor sẽ làm memory native ngày càng tốt, nhưng memory của họ khóa trong tool của họ — `anhcompass` là git-native, dùng chung cho cả team bất kể ai xài agent gì).

### 1.4. Không làm gì (Out of scope v1)

- ❌ KHÔNG tự build code indexer / knowledge graph (dùng backend có sẵn).
- ❌ KHÔNG làm memory notes tổng quát (nhường RepoBrain/Memorix/CLAUDE.md).
- ❌ KHÔNG block merge trong CI (v1 chỉ `warn` — false positive giết niềm tin nhanh hơn mọi thứ).
- ❌ KHÔNG auto-update intent baseline theo code (mọi thay đổi intent phải qua PR có người duyệt).
- ❌ KHÔNG làm dashboard/hosted service (v3).
- ❌ KHÔNG hỗ trợ đa ngôn ngữ lập trình ngay — v1 tập trung TypeScript/JavaScript (đúng repo dogfood), mở rộng sau.

---

## 2. Kiến trúc

```
PROJECT: anhcompass
TYPE:    CLI Tool + GitHub Action + MCP Server (TypeScript monorepo)
STACK:   TypeScript (Node 20+), pnpm workspaces

FLOW TỔNG THỂ:

                        ┌────────────────────────────────────────┐
                        │              REPO CỦA USER              │
                        │  .agent/intent/*.md   (normative — own) │
                        │  .agent/cache/        (gitignored)      │
                        │  CLAUDE.md / .repobrain/ (consume-only) │
                        └───────────────┬────────────────────────┘
                                        │
        ┌───────────────────────────────┼───────────────────────────────┐
        │                               │                               │
   ┌────▼─────┐                  ┌──────▼──────┐                 ┌──────▼──────┐
   │ anhcompass CLI│                  │ GitHub Action│                 │  MCP Server │
   │ init /   │                  │ drift-check  │                 │ get_intents │
   │ check /  │                  │ → PR comment │                 │ check_drift │
   │ compile  │                  └──────┬──────┘                 └──────┬──────┘
   └────┬─────┘                         │                               │
        └───────────────┬───────────────┴───────────────┬───────────────┘
                        │                               │
                 ┌──────▼──────────┐            ┌───────▼────────┐
                 │  @anhcompass/core     │            │  @anhcompass/llm     │
                 │  intent parser   │            │  Anthropic SDK  │
                 │  drift pipeline  │──semantic─▶│  prompt + cache │
                 │  verdict schema  │            └────────────────┘
                 └──────┬──────────┘
                        │ deterministic          ┌────────────────────────┐
                        ├───────────────────────▶│ dependency-cruiser API │
                        │                        └────────────────────────┘
                 ┌──────▼──────────┐
                 │  @anhcompass/graph    │   adapter interface (GraphProvider)
                 │  ├ cbm-adapter   │──▶ codebase-memory-mcp (binary)
                 │  ├ codegraph-ad. │──▶ CodeGraph (.codegraph/)
                 │  └ null-provider │──▶ fallback: glob + git diff thuần
                 └─────────────────┘

KEY DECISIONS:
- TypeScript monorepo (pnpm)      → đúng stack sở trường, share types giữa CLI/Action/MCP
- GraphProvider adapter           → backend graph còn non, swap được không đập sản phẩm
- Intent = markdown + frontmatter → người đọc được, máy parse được (zod), review qua PR
- Deterministic trước, LLM sau    → compile intent ra dependency-cruiser chạy free trong CI,
                                    chỉ intent semantic mới tốn LLM call
- Blast-radius filtering          → diff → graph → chỉ check intent bị ảnh hưởng → chi phí ~0
- Verdict cache theo content hash → re-push không tốn tiền check lại
- LLM calls cô lập trong @anhcompass/llm→ log đủ prompt/response/latency/token, retry, cost control
```

---

## 3. Thiết kế chi tiết

### 3.1. Intent Store — `.agent/intent/`

**Layout trong repo user:**

```
.agent/
├── intent/
│   ├── _index.md                    # index one-liner, generate bởi `anhcompass compile`
│   ├── payment-gateway-isolation.md
│   ├── layering-api-service-repo.md
│   └── error-handling-result.md
├── compiled/                        # output của `anhcompass compile` (commit được)
│   ├── depcruise.anhcompass.cjs          # rules deterministic → dependency-cruiser config
│   └── manifest.json                # map intent-id → check type → anchors resolved
└── cache/                           # verdict cache (GITIGNORED)
    └── <sha256>.json
```

**Schema một intent file** (frontmatter validate bằng zod):

```yaml
---
schema_version: 1                    # forward-compat khi schema đổi sau này
id: payment-gateway-isolation        # unique, kebab-case, = tên file
title: Cô lập payment gateway sau PaymentService
scope: ["src/services/**", "src/api/**"]   # glob — vùng intent áp dụng
anchors:                             # neo vào code, resolve qua GraphProvider
  - type: symbol
    value: PaymentService
  - type: path
    value: src/services/payment.ts
check: semantic                      # deterministic | semantic | both
rule: |
  Mọi call tới Stripe SDK phải đi qua PaymentService.
  Không service/controller nào được import 'stripe' trực tiếp.
deterministic:                       # chỉ khi check: deterministic | both
  kind: no-import
  from: ["src/api/**", "src/services/!(payment).ts"]
  to: ["stripe"]
severity: warn                       # v1: luôn warn. error dành cho v2 khi precision đã chứng minh
status: active                       # proposed | active | deprecated
owner: anh
created: 2026-07-14
verified_at_commit: a1b2c3d         # cập nhật mỗi lần check pass — đo độ tươi
---

## Bối cảnh
Tách gateway để sau này swap sang VNPay không phải sửa 20 chỗ.
Đã từng bị: PR #142 import stripe thẳng vào OrderController.

## Ngoại lệ được phép
- `scripts/stripe-migration/**` (one-off migration tooling)
```

**Ghi chú compile:** dependency-cruiser dùng **regex** cho rule `from`/`to`, còn intent viết bằng **glob** cho dễ đọc — `anhcompass compile` chịu trách nhiệm dịch glob → regex (micromatch `makeRe`), không bắt người viết intent học regex.

**Lifecycle:** `proposed` (agent đề xuất, chưa enforce) → `active` (người merge PR → enforce) → `deprecated` (giữ lại làm lịch sử, không check). Không bao giờ xóa file — deprecate.

**Chống thối (staleness):** mỗi lần check pass, `verified_at_commit` được cập nhật. `anhcompass doctor` liệt kê intent có anchor không còn resolve được (symbol bị xóa/rename) → gắn cờ `stale`, verdict với intent stale luôn kèm cảnh báo "cần người xác nhận lại".

### 3.2. GraphProvider — adapter tầng 1

```typescript
// packages/graph/src/provider.ts
export interface GraphProvider {
  readonly name: string;
  /** Backend có sẵn & index tươi cho repo này không */
  available(repoRoot: string): Promise<boolean>;
  /** Diff → các symbol/file bị ảnh hưởng (blast radius) */
  affectedSymbols(diff: ParsedDiff): Promise<SymbolRef[]>;
  /** Resolve anchor của intent → còn tồn tại không, ở đâu */
  resolveAnchor(anchor: IntentAnchor): Promise<AnchorResolution>;
  /** Lấy source snippet quanh 1 symbol (feed cho semantic check) */
  contextFor(symbols: SymbolRef[], budgetTokens: number): Promise<CodeContext>;
}
```

**3 implementation theo thứ tự ưu tiên tự detect:**

1. `CbmProvider` — gọi codebase-memory-mcp (binary local, query graph).
2. `CodeGraphProvider` — đọc `.codegraph/` (auto-sync sẵn).
3. `NullProvider` — fallback bắt buộc phải có: blast radius = files trong diff + glob matching; contextFor = đọc file trực tiếp quanh vùng diff. **Chậm và thô hơn nhưng đảm bảo `anhcompass` chạy được trên mọi repo không cài gì thêm** — điều kiện sống còn cho adoption.

### 3.3. Drift Engine — pipeline

```
INPUT: diff (PR hoặc working tree) + intent store
─────────────────────────────────────────────────
1. PARSE      đọc + validate toàn bộ .agent/intent/*.md (zod)
2. SCOPE      diff files ∩ intent.scope (glob)          → candidate intents
3. BLAST      GraphProvider.affectedSymbols(diff)
              ∩ intent.anchors                          → thu hẹp candidates
4. CACHE      key = sha256(intent content + diff hunks liên quan + model id)
              hit → trả verdict cache, skip 5–6
5a. DETERMINISTIC  chạy dependency-cruiser với .agent/compiled/depcruise.anhcompass.cjs
                   (đã compile sẵn bởi `anhcompass compile`, chạy < 2s, $0)
5b. SEMANTIC       @anhcompass/llm: prompt = rule + bối cảnh intent
                   + CodeContext (budget ~6k tokens/intent)
                   → structured JSON verdict (schema §3.4)
6. REPORT     gộp verdicts → render: terminal / PR comment / MCP response
─────────────────────────────────────────────────
Chi phí mục tiêu: PR trung bình chạm ≤ 3 intent semantic
→ ≤ 3 LLM call/PR, model Haiku-class trước, escalate Sonnet khi uncertain.
```

**Prompt design cho semantic check (nguyên tắc):**

- System: "Bạn là conformance checker. CHỈ kết luận violation khi có dẫn chứng file/line cụ thể trong context được cấp. Không suy diễn ngoài context. Không chắc → `uncertain`."
- Output: JSON-only theo verdict schema, temperature 0.
- Mọi call log đủ: intent-id, prompt hash, model, tokens in/out, latency, verdict — vào `.agent/cache/llm-log.jsonl` (local) để debug precision.

### 3.4. Verdict schema

```typescript
export const Verdict = z.object({
  intentId: z.string(),
  status: z.enum(["pass", "violation", "uncertain", "stale-intent"]),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.object({
    file: z.string(),
    line: z.number().optional(),
    excerpt: z.string().max(300),      // tôn trọng giới hạn, không dump code dài
    reason: z.string(),
  })),
  suggestion: z.string().optional(),   // gợi ý fix HOẶC "có thể intent đã lỗi thời → mở PR update intent"
  checkedAtCommit: z.string(),
  engine: z.enum(["deterministic", "semantic"]),
});
```

Quy tắc vàng: **verdict không có evidence = không được báo violation.** `uncertain` là kết quả hợp lệ và trung thực hơn một violation đoán mò.

### 3.5. Bề mặt 1 — CLI `anhcompass`

| Lệnh | Chức năng |
|---|---|
| `anhcompass init` | Detect graph backend, tạo `.agent/intent/`, chạy **phỏng vấn codebase**: agent đọc repo (qua GraphProvider + đọc CLAUDE.md/AGENTS.md có sẵn), **đề xuất** 5–7 intent status `proposed` → người sửa, đổi sang `active`, commit. Bước seed này quyết định demo được hay không. |
| `anhcompass check [--diff <ref>]` | Chạy full pipeline trên working tree hoặc diff so với ref. Exit code 0 (v1 luôn 0 trừ `--strict`). |
| `anhcompass compile` | Frontmatter → `depcruise.anhcompass.cjs` + `manifest.json` + `_index.md`. Chạy trong pre-commit hook hoặc CI. |
| `anhcompass doctor` | Kiểm tra sức khỏe: intent stale, anchor gãy, backend nào đang dùng, cache size. |
| `anhcompass intent new <id>` | Scaffold một intent file từ template. |

### 3.6. Bề mặt 2 — GitHub Action `anhcompass-drift-check`

```yaml
# .github/workflows/anhcompass.yml (phía user)
- uses: <org>/anhcompass-action@v1
  with:
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    mode: warn                # v1 chỉ warn
```

- Trigger: `pull_request`. Chạy `anhcompass check --diff origin/main`.
- Output: **1 comment duy nhất, upsert** (sticky comment — không spam mỗi push).
- Format comment: bảng verdict, mỗi violation kèm evidence + 2 nút hành động dạng link: *"Xem intent"* và *"Intent lỗi thời? Mở PR sửa intent"* (pre-filled).
- Cache verdict qua `actions/cache` key theo content hash → re-push phần không đổi = $0.
- Không có `anthropic-api-key` → Action tự hạ xuống **deterministic-only mode** (vẫn chạy, vẫn có giá trị, $0) — hạ rào chắn cho team muốn thử mà chưa muốn cấp key.

### 3.7. Bề mặt 3 — MCP Server `@anhcompass/mcp`

Tools expose (stdio, dùng `@modelcontextprotocol/sdk`):

| Tool | Dùng khi |
|---|---|
| `get_intents(paths?: string[])` | Đầu session: agent load các intent active giao với vùng sắp làm việc → không tự tạo drift. |
| `check_drift(diff?: string)` | Cuối task: agent tự soi diff của chính nó trước khi báo cáo xong. |
| `propose_intent(draft)` | Agent phát hiện quy luật ngầm → ghi file `proposed`, KHÔNG bao giờ tự ghi `active`. |

Kèm snippet hook mẫu cho Claude Code (SessionStart inject intents; Stop hook gọi `check_drift`) trong docs — copy-paste được.

### 3.8. v2 — Distill Engine (thiết kế trước, build sau)

- Nguồn dữ liệu: session logs (Claude Code transcript hooks) + shell history opt-in.
- Detector: chuỗi lệnh/thao tác xuất hiện ≥ N lần (mặc định 3) với cấu trúc tương tự (fuzzy match theo command template).
- Output: PR đề xuất gồm (a) script vào `scripts/` + entry trong `justfile`/`package.json`, hoặc (b) `SKILL.md` vào `.agent/skills/` cho workflow cần phán đoán. **Luôn qua PR, không bao giờ tự merge.**
- Telemetry local-first: đếm intent nào fire, skill nào được load → `anhcompass stats` → nền tảng cho dashboard v3.

---

## 4. Cấu trúc repo (monorepo)

```
anhcompass/
├── package.json                     # pnpm workspaces, scripts chung
├── pnpm-workspace.yaml
├── tsconfig.base.json               # strict: true
├── .github/workflows/
│   ├── ci.yml                       # lint + typecheck + vitest
│   └── anhcompass.yml                    # DOGFOOD: anhcompass check chính repo anhcompass
├── .agent/                          # dogfood: intent cho chính dự án này
│   └── intent/
│       ├── no-llm-outside-llm-pkg.md    # "LLM call chỉ được ở @anhcompass/llm"
│       └── provider-behind-interface.md # "không import backend graph trực tiếp"
│
├── packages/
│   ├── core/                        # @anhcompass/core — trái tim, KHÔNG side effect
│   │   ├── src/
│   │   │   ├── intent/
│   │   │   │   ├── schema.ts        # zod schema frontmatter + Verdict
│   │   │   │   ├── parser.ts        # gray-matter → Intent[], lỗi rõ ràng từng file
│   │   │   │   └── lifecycle.ts     # proposed/active/deprecated transitions
│   │   │   ├── engine/
│   │   │   │   ├── pipeline.ts      # orchestrate 6 bước §3.3
│   │   │   │   ├── scope.ts         # glob ∩ diff
│   │   │   │   ├── deterministic.ts # gọi dependency-cruiser API
│   │   │   │   ├── semantic.ts      # build prompt, gọi @anhcompass/llm, parse verdict
│   │   │   │   └── cache.ts         # content-hash verdict cache
│   │   │   ├── compile/
│   │   │   │   ├── depcruise.ts     # frontmatter deterministic → depcruise config
│   │   │   │   └── manifest.ts
│   │   │   ├── diff/parse.ts        # unified diff → ParsedDiff
│   │   │   └── report/
│   │   │       ├── terminal.ts
│   │   │       └── markdown.ts      # PR comment renderer
│   │   └── tests/                   # vitest — pipeline, parser, cache là critical path
│   │
│   ├── graph/                       # @anhcompass/graph
│   │   ├── src/
│   │   │   ├── provider.ts          # interface §3.2
│   │   │   ├── detect.ts            # auto-detect backend theo thứ tự ưu tiên
│   │   │   ├── cbm/adapter.ts
│   │   │   ├── codegraph/adapter.ts
│   │   │   └── null/provider.ts     # fallback thuần glob+diff — LUÔN pass CI
│   │   └── tests/
│   │
│   └── llm/                         # @anhcompass/llm — nơi DUY NHẤT gọi LLM
│       ├── src/
│       │   ├── client.ts            # Anthropic SDK, retry + timeout + typed errors
│       │   ├── prompts.ts           # system prompts, versioned (prompt_v)
│       │   ├── budget.ts            # token budget, model routing Haiku→Sonnet
│       │   └── log.ts               # jsonl: prompt hash, tokens, latency, verdict
│       └── tests/                   # mock client, KHÔNG gọi API thật trong test
│
├── apps/
│   ├── cli/                         # anhcompass (commander + picocolors)
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   └── commands/{init,check,compile,doctor,intent-new}.ts
│   │   └── package.json             # bin: { "anhcompass": "dist/index.js" }
│   ├── action/                      # anhcompass-action (composite → gọi CLI, upsert comment)
│   │   ├── action.yml
│   │   └── src/comment.ts           # sticky comment qua @actions/github
│   └── mcp-server/                  # @anhcompass/mcp
│       └── src/{index,tools}.ts
│
├── docs/
│   ├── getting-started.md
│   ├── intent-authoring.md          # cách viết intent tốt (quan trọng ngang code)
│   └── hooks/claude-code.md         # snippet SessionStart + Stop hook
├── examples/demo-repo/              # repo giả lập có drift sẵn — dùng cho test e2e + demo
├── .env.example                     # ANTHROPIC_API_KEY=
└── README.md
```

**Quy ước chất lượng** (theo chuẩn nội bộ): strict TS, zod validate mọi input ngoài (frontmatter, env, LLM output), pino logging, typed errors, không hardcode secret, function < 40 dòng, mỗi core module có ít nhất 1 test mẫu.

---

## 5. Roadmap

> **Assumption:** solo, part-time ~10–15h/tuần (song song chương trình khác từ 20/07). Mỗi phase có Definition of Done test được — chưa đạt DoD thì không sang phase sau.

### Phase 0 — Skeleton & Intent Store *(tuần 1: 14–20/07)*
- Scaffold monorepo, CI lint+test.
- `@anhcompass/core`: schema + parser + `anhcompass compile` (index + manifest, chưa cần depcruise).
- `anhcompass intent new`, `anhcompass doctor` (mức parse-only).
- **DoD:** clone repo → `pnpm i` → viết 1 intent → `anhcompass compile` ra `_index.md` + manifest hợp lệ; parser test coverage cho mọi lỗi frontmatter phổ biến.

### Phase 1 — Drift Engine v1 *(tuần 2–4)*
- `NullProvider` (fallback) + `CbmProvider`.
- Deterministic path: compile → dependency-cruiser → verdict.
- Semantic path: `@anhcompass/llm` (Haiku-class, JSON verdict, cache, jsonl log).
- `anhcompass check --diff` chạy end-to-end trên `examples/demo-repo`.
- **DoD:** demo-repo có 3 drift cài sẵn (1 deterministic, 2 semantic) → `anhcompass check` bắt đủ 3, **0 false positive** trên 5 diff sạch; tổng chi phí LLM 1 lần check < $0.02.

### Phase 2 — GitHub Action + Dogfood thật *(tuần 5–6)*
- `anhcompass-action` + sticky PR comment + actions/cache.
- **Dogfood trên repo MoreLogin clone**: viết 5–7 intent thật, bật Action, sống với nó 2 tuần.
- Tinh chỉnh prompt theo llm-log để ép precision.
- **DoD:** ≥ 10 PR thật chạy qua bot; precision violation ≥ 80% (đếm tay từ log); ≥ 1 drift thật được bắt trước merge (đây là khoảnh khắc chứng minh sản phẩm).

### Phase 3 — MCP Server + Public Alpha *(tuần 7–8)*
- `@anhcompass/mcp` 3 tools + docs hook Claude Code.
- `anhcompass init` với phỏng vấn codebase (dùng `@anhcompass/llm`, output `proposed`).
- README + docs + demo GIF; publish npm + GitHub release; post giới thiệu (Dev.to / X / group MMO-dev VN).
- **DoD:** người lạ setup được từ README trong < 10 phút trên repo TS bất kỳ (nhờ NullProvider); ≥ 3 người ngoài dùng thử và phản hồi.

### Phase 4 — v2: Distill + Telemetry *(tháng thứ 3–4 của dự án, sau khi alpha có tín hiệu)*
- Distill engine (§3.8), `anhcompass stats`, CodeGraphProvider.
- **DoD:** trên repo dogfood, distill đề xuất ≥ 3 CLI/skill mà chính mình thấy đáng merge ≥ 2.

### Phase 5 — v3: Team & Monetization *(khi có ≥ 20 repo active dùng alpha)*
- Dashboard team (Next.js — lịch sử drift, intent hay bị vi phạm, hotspot), hosted check, org-level intent share.
- Model: OSS core (CLI/Action/MCP) miễn phí vĩnh viễn — trả tiền cho dashboard + hosted + org features. Người mua: team lead / eng manager (governance), không phải dev lẻ.

### Gate quyết định sau Phase 3
- **Tín hiệu tốt** (≥ 3 external user quay lại dùng tuần 2, hoặc ≥ 1 team hỏi tính năng org) → đi tiếp Phase 4.
- **Tín hiệu yếu** → sản phẩm vẫn là internal tool có giá trị cho chính workflow freelance/MMO của mình; chi phí chìm thấp vì mọi phase đều tự dùng được.

---

## 6. Metrics

**North Star:** số drift thật được bắt trước khi merge / tuần / repo active.

| Tầng | Metric | Mục tiêu alpha |
|---|---|---|
| Chất lượng | Precision của verdict `violation` | ≥ 80% (đo tay từ llm-log) |
| Chất lượng | Tỷ lệ `uncertain` | < 25% (cao hơn = prompt/context yếu) |
| Adoption | Repos có `.agent/intent/` với ≥ 3 intent active | 20 sau 2 tháng public |
| Hiệu năng | Thời gian check 1 PR (p95) | < 90s trong CI |
| Chi phí | LLM cost / PR (p95) | < $0.05 |
| Health | Intent stale không được xử lý > 30 ngày | 0 trên repo dogfood |

---

## 7. Rủi ro & Giảm thiểu

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| **False positive giết niềm tin** | Cao | v1 chỉ `warn`; verdict bắt buộc có evidence; `uncertain` là output hợp lệ; đo precision từ tuần đầu dogfood |
| Backend graph (cbm/CodeGraph) đổi API hoặc chết | Trung | Adapter interface + NullProvider luôn chạy được — backend chỉ là tăng tốc, không phải dependency sống còn |
| Platform (Antigravity/Cursor) làm native intent | Trung | Moat = vendor-neutral + git-native + team-shared; ship nhanh, chiếm convention `.agent/intent/` trước |
| Chi phí LLM trong CI làm user ngại bật | Trung | Blast-radius filter + cache + Haiku-first; deterministic path hoàn toàn $0 |
| Solo + part-time, dễ đứt quãng | Cao | Phase nhỏ có DoD; mọi phase đều tự dùng được nên không có phase "vô ích"; dogfood chính là user số 0 |
| Viết intent tốt là kỹ năng khó → store rỗng/rác | Trung | `anhcompass init` phỏng vấn codebase để seed; docs/intent-authoring.md; template + ví dụ thật |
| Prompt injection từ nội dung diff/code vào semantic check | Thấp–Trung | Code context bọc trong delimiter, system prompt chỉ định rõ code là data không phải lệnh; verdict schema cứng, JSON-only |

---

## 8. Setup & Run (khi Phase 0 xong)

```bash
# Dev
git clone <repo> && cd anhcompass
pnpm install
cp .env.example .env        # điền ANTHROPIC_API_KEY
pnpm build && pnpm test

# Dùng trên 1 repo bất kỳ
cd ~/projects/morelogin-clone
npx anhcompass init              # phỏng vấn codebase → intent proposed
# review, sửa, đổi status: active, commit .agent/
npx anhcompass check --diff origin/main
```

## 9. Next Steps (ngay tuần này)

1. Tạo repo `anhcompass` + scaffold Phase 0 (tên đã chốt: **AnhCompass**).
2. Viết tay 2 intent đầu tiên cho chính repo `anhcompass` (dogfood từ commit số 1).
3. Cài codebase-memory-mcp lên repo MoreLogin clone, thử query blast radius bằng tay để xác nhận adapter khả thi trước khi code `CbmProvider`.
4. Dựng `examples/demo-repo` với 3 drift cài sẵn — đây vừa là test e2e vừa là material demo/GIF cho Phase 3.
5. Đăng ký sớm npm package `anhcompass` + scope `@anhcompass` + GitHub org/repo (tránh mất tên).