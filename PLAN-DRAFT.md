# PLAN-DRAFT — Từ "AI checker" sang "machine-verifiable architecture layer"

> Bản nháp. Nguồn: review ngoài + đối chiếu code thực tế 2026-08-31.
> **Trạng thái 2026-09-01: Phase 0–3 đã xong** — số đo trong [BENCHMARKS.md](BENCHMARKS.md).
> Kế hoạch tiếp theo nằm ở [ROADMAP-9.md](ROADMAP-9.md); mục 0 dưới đây là ảnh chụp hiện trạng *trước* Phase 1 và được giữ lại làm mốc so sánh, không phải mô tả hiện tại.
> Nguyên tắc: **không thêm feature mới nào trước khi Phase 1 + 2 xong và có số đo.**

## 0. Sự thật hiện trạng (đã verify trong code, không phải cảm nhận)

| Vấn đề | Bằng chứng | Hệ quả |
|---|---|---|
| `packages/graph` là dead code | `GraphProvider` / `NullProvider` / `detectProvider` / `affectedSymbols` / `contextFor` / `resolveAnchor` = 0 call site trong `packages/core/src`, `apps/*/src`, `benchmarks/src`. Core chỉ dùng type `ParsedDiff` + `readFilesMatchingGlobs`. | "Graph intelligence" chưa nằm trên đường thực thi. |
| `stale-intent` là status chết | Có trong `intent/schema.ts` + 2 reporter, không code path nào sinh ra. `resolveAnchor` không được gọi; `NullProvider` luôn `found: true`. | Field `anchors` trong frontmatter là trang trí. |
| Deterministic chỉ thấy dòng `+` | `deterministic.ts`: `hunks.filter(l => l.startsWith('+'))` | Vi phạm đã tồn tại trong repo là vô hình. Repo bẩn + diff sạch = PASS. |
| Deterministic là regex trên raw text | `buildImportPattern()`, không strip comment/string | `// import Stripe from 'stripe'` → false positive. Multi-line import và `export ... from` → false negative. |
| Chỉ 1 rule kind | `DeterministicRuleSchema.kind = enum(['no-import'])` | Không transitive, không layer, không cycle. |
| Retrieval gần như ngẫu nhiên | `semantic.ts` → `readFilesMatchingGlobs()`: walk theo thứ tự `readdir`, dừng ở 15 file, `slice(0, maxChars)` từ đầu file | Trên repo lớn, LLM thấy file nào phụ thuộc thứ tự alphabet. UNCERTAIN không phải safety feature, là hệ quả. |
| Benchmark chưa là bằng chứng | `cases/seed.json` = 4 case; `results/report.md` = 2 case deterministic | "Precision 100%" trên N=2. |

Harness benchmark (`benchmarks/src/run.ts`) thì **tốt** — TP/TN/FP/FN, slice theo engine/category, p50/p95, LLM cost. Cái thiếu là dữ liệu.

## 1. Quyết định chiến lược

- **Không đua graph với Graphenium.** Họ có AST + Stack Graph + Datalog đi trước. Mục tiêu là graph *đủ dùng*: import graph + transitive closure cho TS/JS, không phải universal symbol graph 7 ngôn ngữ.
- **Hoãn DSL riêng.** `dependency-cruiser` / Nx / ArchUnit đã có cú pháp allow/deny quen thuộc. Differentiation không nằm ở cú pháp rule.
- **Một ngôn ngữ làm cho đúng (TS/JS) trước khi mở rộng.** Python giữ nguyên regex fallback, đánh dấu rõ là best-effort.
- **Đổi trục của hybrid enforcement.** Ràng buộc "LLM luôn warn-only" hiện gắn với *engine sinh verdict* (`enforcement.ts`). Phải đổi sang gắn với *evidence có verify được bằng máy hay không*: LLM đề xuất đường đi → graph xác nhận đường đi tồn tại → được phép block. LLM nói "có vẻ vi phạm" mà không kèm path → warn. Đây là lối thoát cho nghịch lý "architecture phức tạp thì không enforce được".
- **Parser: TypeScript compiler API (`ts.createSourceFile`), parse-only, không type-checker.** Lý do: `typescript` đã là devDep sẵn, không thêm native binding (tránh đau trên Windows), đủ chính xác để diệt toàn bộ false positive comment/string, và nhanh vì không tạo `Program`. `ts-morph` quá nặng, `tree-sitter` native khó build, `web-tree-sitter` để dành khi mở rộng đa ngôn ngữ.
- **`packages/graph` được phép chạm `fs`.** Rule 3 trong CLAUDE.md chỉ ràng buộc `packages/core` là pure. Indexer sống ở `graph`, core chỉ nhận kết quả.

## 2. Các phase

### Phase 0 — Dataset  ✅ XONG (2026-08-31)

Mục tiêu: có corpus đủ lớn để mọi thay đổi engine sau này đo được, và **phơi bày công khai** các FP/FN của engine hiện tại làm mốc so sánh.

- Nâng `benchmarks/cases/` từ 4 → ~100 case, chia theo file/nhóm ngữ nghĩa.
- Mở rộng `BenchCaseSchema`: thêm `engine: 'graph'` và `fixture?: Record<path, content>` để biểu diễn được case layering/transitive (cần file thật, không chỉ diff).
- Runner gate case `graph` sau cờ `--graph` (giống `--semantic`), in rõ "N graph case đang chờ Phase 1" khi chưa bật.
- Ghi lại **baseline số** của engine hiện tại vào `BENCHMARKS.md`, gồm cả các case đang fail.

**Kết quả thực tế:** corpus 4 → **102 case** (68 deterministic chạy được, 20 graph chờ Phase 1, 14 semantic chờ API key).

Baseline engine regex hiện tại, đo trên corpus mới:

| Slice | Cases | FP | FN | Precision | Recall | F1 |
|---|---|---|---|---|---|---|
| deterministic (all) | 68 | 8 | 4 | 78.4% | 87.9% | 82.9% |
| deterministic / correct | 19 | 0 | 0 | 100% | 100% | 100% |
| deterministic / wrong | 23 | 0 | 0 | 100% | 100% | 100% |
| **deterministic / edge** | **26** | **8** | **4** | **42.9%** | **60.0%** | **50.0%** |

Con số đáng kể là slice `edge`: **precision 42.9%, recall 60%**. Case `correct`/`wrong` đạt 100% và vốn đã luôn 100% — đó chính là thứ corpus 2-case cũ đang đo. Mọi thứ repo thật sự chứa nằm ở `edge`.

- 8 FP: toàn bộ cùng một nguyên nhân — khớp text thay vì parse code (comment, JSDoc, string/template literal, markdown fence).
- 4 FN: import nhiều dòng, `export ... from`, `export * from`, `import json, requests`.
- 20 case graph chưa engine nào trả lời được. Nặng nhất là `graph-transitive-unchanged-hop`: diff không thêm import nào, đường đi vi phạm đã có sẵn trong repo, engine chỉ đọc dòng `+` báo PASS trên một repo đang vi phạm.

`pnpm bench` hiện exit 2. Đúng như mong đợi ở cuối Phase 0 — corpus tồn tại để phơi bày khoảng cách này.

Việc đã làm ngoài dữ liệu:
- `BenchCaseSchema`: thêm `engine: 'graph'` và `fixture?: Record<path, content>`.
- Runner: materialize fixture vào root riêng cho từng case, nên **semantic case giờ mới thực sự có context** (trước đây chạy trên tmpdir rỗng, model chỉ thấy diff). Case graph bị skip có đếm, sau cờ `--graph`.
- `BENCHMARKS.md` viết lại: corpus, baseline, 12 failure liệt kê từng case, mục tiêu từng phase phải dịch chuyển.

Chưa biểu diễn được (ghi lại để Phase 1 xử lý): case **cycle** cần `kind: 'no-cycle'`, mà `DeterministicRuleSchema.kind` hiện chỉ có `'no-import'` nên zod loại. Không viết case không chạy được.

typecheck ✅ · lint ✅ · `pnpm test` 78/78 ✅

### Phase 1 — Import graph thật + deterministic trên AST  ✅ XONG (2026-09-01)

- `packages/graph/src/index/` — indexer TS/JS: `ts.createSourceFile` → trích import/require/dynamic-import/re-export → `{ nodes: file[], edges: import[] }`, cache trên đĩa theo mtime+hash.
- `packages/graph/src/query/` — `reachable(from, to)`, `paths(from, to, maxHops)`, `cycles()`.
- `TsGraphProvider implements GraphProvider` — thay `NullProvider` làm mặc định, nối `detectProvider` vào pipeline thật (hiện có nhánh chết).
- Rule kind mới: `layer-boundary` (`allow`/`deny` giữa các layer định nghĩa bằng glob) + `no-import` chạy trên AST thay vì regex.
- Deterministic quét **cả repo**, không chỉ dòng `+`; diff dùng để chọn intent và để rank, không phải để giới hạn khả năng phát hiện.
- Evidence đổi từ "dòng khớp regex" sang **đường đi**: `api/PaymentController.ts → PaymentService.ts → StripeClient.ts`.
- Kích hoạt `resolveAnchor` thật → `stale-intent` hết là status chết.

**Chấp nhận xong khi:** toàn bộ FP comment/string ở Phase 0 về 0; các case transitive/layering pass; bảng so sánh Regex vs Graph trong `BENCHMARKS.md`.

### Phase 2 — Retrieval thay `readFilesMatchingGlobs`  ✅ XONG (2026-09-01)

- Changed files → graph neighbors 1–2 hop → rank theo khoảng cách + liên quan tới scope của intent → cắt theo token budget.
- Giữ nguyên đường cũ sau một cờ để **A/B đo được**: token dùng, recall, FP — trên cùng corpus Phase 0.

**Chấp nhận xong khi:** chứng minh bằng số trên chính corpus này rằng Graph+LLM > LLM alone (recall tăng, token giảm). Nếu không chứng minh được, phải nói thẳng trong `BENCHMARKS.md`.

### Phase 3 — Closed loop + governance  ✅ XONG (2026-09-01)

- MCP: `get_architecture_context`, `check_plan`, `explain_violation`, `verify_fix` (hiện chỉ có `list_intents`, `check_drift`).
- Intent lifecycle: `supersedes`, `conflicts_with`, `exceptions[] {path, reason, expires, approved_by}`, `review_after`.
- `anhcompass doctor` mở rộng: intent mồ côi, scope chồng lấn, exception hết hạn, intent không có evidence.

Chỉ bắt đầu sau khi Phase 1 + 2 có số.

## 3. Không làm (và lý do)

- DSL architecture đầy đủ / constraint solver — over-engineering trước khi có graph.
- Hỗ trợ Java/Go/Rust/C# — bẫy làm chết dự án ở tháng thứ 3.
- Mở rộng baseline/regression — đã tốt, không phải moat, không ưu tiên.
- Tối ưu số star / GitHub About — không phải tín hiệu chất lượng giai đoạn này.
