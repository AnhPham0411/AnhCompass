# ROADMAP-9 — Từ "prototype đo đạc tử tế" sang "developer infrastructure"

> Nguồn: audit code trực tiếp 2026-09-01 trên `feat/engine-hardening` @ `b008060`, không dựa vào mô tả.
> Đã chạy để verify: `pnpm test` → 115/115 pass · `pnpm bench -- --graph` → exit 0, mọi slice 100%.
> Tiếp nối [PLAN-DRAFT.md](PLAN-DRAFT.md), phần Phase 0–3 đã xong (xem [BENCHMARKS.md](BENCHMARKS.md)).
> Nguyên tắc giữ nguyên từ PLAN-DRAFT: **không thêm feature mới nào trước khi phase hiện tại có số đo.**

## 0. Hiện trạng đã verify (không phải cảm nhận)

Phần *engineering* đã ở mức khá. Phần *sản phẩm* gần bằng 0. Đây là bất đối xứng cần sửa.

| Đã có, đã đo | Bằng chứng |
|---|---|
| Deterministic engine trên AST + tokenizer | `packages/core/src/engine/scanner.ts` (comment/string/template không tới matcher), `packages/graph/src/index/indexer.ts` (TypeScript Compiler API) |
| 68 case deterministic, chạy 2 cấu hình engine, 100% | `benchmarks/results/report.md` |
| Graph engine thật: reachable / paths / cycles / neighbors | `packages/graph/src/query/query.ts`, 31 case, 100% |
| Hai engine additive, không phải if/else | `packages/core/src/engine/deterministic.ts` — graph pass chỉ *thêm*, không che |
| `uncertain` khi không engine nào trả lời được | cùng file, nhánh `graphCoverage() === 0` |
| Closed loop MCP 6 tool | `apps/mcp-server/src/index.ts`, có integration test qua stdio |
| Bằng chứng ngoài đầu tiên | `sverweij/dependency-cruiser`, 2 rule của maintainer đó, 3 diff thật, 0 FP |

| Chưa có / đang hỏng | Bằng chứng |
|---|---|
| **Không ai cài được** | `apps/cli/package.json` có `"private": true`, version `0.0.1`, chưa publish — trong khi `readme.md` bảo `npm install -g anhcompass` |
| **1.191 dòng không test** | `packages/graph` (727) + `packages/llm` (464) = 0 file test |
| Semantic không nằm trong CI | `.github/workflows/ci.yml` chạy `pnpm bench -- --graph`; semantic slice = 0 case |
| 100% trên corpus tự viết | Không có held-out set, không mutation testing — BENCHMARKS.md tự nhận "self-graded" nhưng chưa có cơ chế chống |
| Chưa chứng minh tác động lên agent | Không có behavioral benchmark |
| OSS maturity | Không CONTRIBUTING / SECURITY / CHANGELOG / CoC / issue template / tag / release |

## 1. Về bản review ngoài (2026-09-01)

Review đó đọc [BENCHMARKS.md](BENCHMARKS.md) nhưng dừng ở mục **"Baseline — trước Phase 1"** và tưởng là hiện trạng.

**Sai (đã lỗi thời):** "precision 78.4% / edge 42.9%", "engine là text matching", "graph cases bị skip", "`pnpm bench` exit 2", "MCP chỉ có 2 tool", "chưa có pre-flight / closed loop", "chỉ benchmark repo giả". Tất cả đều đã bị Phase 1–3 xử lý, có số trong BENCHMARKS.md.

**Sai về phương pháp:** chấm repo bằng star count của repo khác. Không kiểm soát được, không đo chất lượng kỹ thuật.

**Đúng, và vẫn đúng hôm nay:**

1. OSS maturity gần 0.
2. LLM layer quá mỏng — không retry, không timeout.
3. Semantic chưa được chứng minh liên tục.
4. Corpus semantic 14 case là quá nhỏ.
5. **Chưa có agent behavioral benchmark** — điểm đúng nhất của review, và là W3 dưới đây.
6. README marketing trước, proof sau.

## 2. Lỗi chưa ai nêu (từ đọc code)

| # | Lỗi | Vị trí | Hệ quả |
|---|---|---|---|
| 1 | README dạy lệnh cài không chạy được | `readme.md` vs `apps/cli/package.json` `private: true` | Người thử đầu tiên fail ở bước 1 |
| 2 | `graph` + `llm` không có unit test | 0 file `.test.ts` trong 2 package | Regression lọt, benchmark không thay được test |
| 3 | `paths()` enumerate mọi simple path tới 10 hop rồi mới `slice(0,5)` | `packages/graph/src/query/query.ts` | Repo có barrel file → đồ thị dày → treo |
| 4 | `cycles()` DFS đệ quy | cùng file | Chain sâu → stack overflow |
| 5 | `resolveImport` chỉ đọc `tsconfig.json` root, bỏ `tsconfig.base.json` | `packages/graph/src/index/indexer.ts` | Monorepo dùng alias → edge không resolve → **im lặng bỏ sót violation**. Đúng failure mode BENCHMARKS.md đã gọi tên 3 lần |
| 6 | Ghi `.anhcompass/cache/graph.json` (1.1MB) vào repo người dùng, `init` không thêm `.gitignore` | `indexer.ts`, `apps/cli/src/commands/init.ts` | Rác trong repo người khác |
| 7 | CI chỉ ubuntu, dev trên Windows | `.github/workflows/ci.yml` | Bug path separator do user phát hiện |
| 8 | Walk không tôn trọng `.gitignore` | `packages/graph/src/ts-provider.ts` | Index chứa file build |
| 9 | Provider LLM đoán theo prefix API key | `packages/llm/src/client.ts` | `sk-proj-`, key Gemini `AIza` → route sai provider |

## 3. Điều kiện cần cho 9đ — dùng để tự chấm

> Cập nhật 2026-09-01 sau đợt sửa W0/W2 + Phase 4 (held-out corpus).

| Điều kiện | Trạng thái |
|---|---|
| AST + import graph | ✅ |
| Closed loop MCP 6 tool | ✅ |
| Hybrid enforcement có bằng chứng thực nghiệm | ✅ |
| Benchmark công bố cả kết quả âm | ✅ |
| Deterministic precision/recall ≥ 95% trên **held-out** | ✅ 24 case held-out, 100% sau khi sửa 2 defect nó tìm ra |
| Unit test cho `graph` + `llm` | ✅ graph 34, llm 26 (tổng 186 test, trước là 115) |
| CI xanh 3 OS, semantic slice có chạy | ✅ matrix 3 OS × Node 20/22; semantic chạy khi có `LLM_API_KEY` |
| Cài được bằng 1 lệnh | ⚠️ bundle đã publish-ready (`npm pack` chạy được, không còn workspace dep); còn thiếu bước `npm publish` |
| Mutation score ≥ 70% trên `core` + `graph` | ❌ có `stryker.config.json`, chưa chạy |
| FP rate < 1% trên ≥ 100 diff thật, ≥ 10 repo | ❌ mới 1 repo / 3 diff |
| **Agent violation giảm ≥ 50%, false block < 2%** | ❌ quan trọng nhất, chưa bắt đầu |
| CHANGELOG + release + docs | ⚠️ CHANGELOG/CONTRIBUTING/SECURITY/CoC/ARCHITECTURE/template đã có; chưa tag `v0.1.0` |

**7/12 đạt, 2 gần đạt.** Trước đợt này là 4/12.

## 4. Các phase

### W0 — Gỡ blocker (1–2 ngày)

Không làm xong cái này thì mọi phase sau vô nghĩa: không ai chạy được thứ bạn đo.

- Bỏ `private: true`, version `0.1.0`, thêm `files` / `repository` / `publishConfig`, publish `anhcompass` lên npm.
- Sửa `readme.md`: hoặc publish thật, hoặc đổi sang clone-and-build cho tới khi publish. Không để lệnh nào trong README fail.
- Dọn working tree: `test-alias.ts`, `test-case.ts`, `test-graph.ts`, `write-alias.ts`, `bench_output.log`.
- `init` ghi `.anhcompass/` vào `.gitignore`; cân nhắc chuyển cache sang `node_modules/.cache/anhcompass`.
- CI matrix `ubuntu × windows × macos`, Node 20/22. Thêm job semantic chạy có điều kiện khi repo có secret.

**Chấp nhận xong khi:** `npx anhcompass@0.1.0 --version` chạy được từ một máy sạch; CI xanh trên 3 OS; `git status` sạch.

### W1 — Chống overfit + bằng chứng ngoài (1 tuần)

100% trên corpus do chính tay mình viết cùng lúc với engine là **cảnh báo**, không phải chiến thắng. Một benchmark mà mọi ô đều 100% đã ngừng mang thông tin.

- **Held-out corpus**: `benchmarks/cases/holdout/`, case viết *trước* khi sửa engine, không được dùng để debug. Report in riêng 2 dòng `dev` vs `holdout`.
- **Mutation testing** (Stryker) trên `core` + `graph`. Mỗi mutant sống sót phải sinh ra một case mới.
- **10 repo thật**, rule lấy từ chính maintainer repo đó — cùng phương pháp đã dùng với dependency-cruiser: Next.js, NestJS, Prisma, Vite, một monorepo pnpm, FastAPI, Django, và 2–3 repo tuỳ chọn.
- Corpus semantic 14 → 50+, nhãn từ rule semantics như cũ.

**Chấp nhận xong khi:** held-out precision/recall ≥ 95%; mutation score ≥ 70%; FP rate < 1% trên ≥ 100 diff thật; bảng công khai trong BENCHMARKS.md, kèm cả trường hợp thua.

### W2 — Hardening engine (1 tuần, song song W1)

- Unit test `packages/graph`: `reachable` / `paths` / `cycles` / `neighbors` / `resolveImport` / cache invalidation theo mtime. ≥ 40 test, coverage ≥ 85%.
- Unit test `packages/llm` với mock transport: 3 provider, schema fail, budget routing, redaction. ≥ 25 test.
- `paths()`: đổi sang **reverse reachability từ node bị cấm** — chính giải pháp PERFORMANCE.md đã tự đề xuất — bỏ enumerate-then-slice.
- `cycles()`: đệ quy → iterative (Tarjan SCC).
- `resolveImport`: đọc `tsconfig.base.json`, `extends`, `references`. Thêm case `graph-monorepo-alias` vào corpus.
- Walk tôn trọng `.gitignore`, loại `.next` / `coverage` / `build` / `vendor`.
- LLM client: `AbortController` timeout, retry backoff cho 429/5xx, `requestId` trong log, redact key, chọn provider tường minh (`--provider` / env) thay vì đoán theo prefix.

**Chấp nhận xong khi:** benchmark 50k node / 200k edge < 500ms; chain 50k node không stack overflow; giả lập 429 → retry; timeout → `uncertain` chứ không treo.

### W3 — Con số làm nên 9 điểm (2–3 tuần)

Đây là thứ chưa đối thủ nào trong nhóm này công bố, và là khác biệt thật sự giữa "linter thông minh" và "hạ tầng".

```
100 task coding thật (từ issue có thật của 5 repo ở W1)
   ├── Arm A: agent trần
   ├── Arm B: agent + MCP read-only (list_intents, get_architecture_context)
   └── Arm C: agent + closed loop (check_plan → code → check_drift → verify_fix)

3 seed mỗi task. Chấm violation bằng deterministic engine,
+ 20% mẫu chấm tay để đo độ tin của chính engine chấm.
```

| Chỉ số | Mốc |
|---|---|
| Architectural violation / task, A → C | giảm ≥ 50% |
| False block rate (arm C) | < 2% |
| Task success rate | không giảm quá 2 điểm % |
| Token overhead | < 15% |
| Latency thêm / task | < 5s p95 |

**Chấp nhận xong khi:** có `BEHAVIORAL.md` với script reproduce, và kết quả được công bố kể cả khi arm C không thắng. Nếu không chứng minh được thì nói thẳng — đúng như đã làm với prompt v2 và retrieval ở Phase 2.

### W4 — OSS maturity (3–4 ngày, xen kẽ)

- `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md` (Keep a Changelog), issue/PR template.
- `ARCHITECTURE.md` tách khỏi CLAUDE.md.
- semver + tag `v0.1.0`, release notes.
- Viết lại `readme.md` theo thứ tự: **What it catches → What it cannot catch → Benchmark → Limitations → Install**. Với tool loại governance, trust đứng trước hype.

## 5. Không làm (giữ nguyên tinh thần PLAN-DRAFT)

- Không đua độ sâu graph với Graphenium. Import graph *đủ dùng* cho TS/JS, không phải universal symbol graph.
- Không mở rộng Java / Go / Rust / C# trước W3.
- Không thêm command, provider LLM, dashboard, UI.
- Không tối ưu số star / GitHub About.
- Không viết DSL architecture đầy đủ hay constraint solver.

## 6. Ước lượng

W0 2 ngày → W1 + W2 song song 2 tuần → W3 3 tuần, W4 xen kẽ. Khoảng **5–6 tuần** tới 12/12 ở mục 3.

Thứ tự này khác PLAN-DRAFT vì bốn việc đầu của roadmap cũ (AST → graph → evidence → loop) đã xong. Cái chặn bây giờ không phải thuật toán, mà là: **không ai cài được, và chưa chứng minh nó làm agent bớt phá kiến trúc.**
