# CLAUDE.md — AnhCompass

## Bối cảnh (đọc 30 giây)

AnhCompass = intent & drift layer cho coding agents: intent store normative trong
`.agent/intent/`, drift engine so code với intent, 3 bề mặt CLI / GitHub Action / MCP.
Toàn cảnh nằm ở `DESIGN.md` — tham chiếu khi cần, KHÔNG cần đọc lại mỗi session.
File này là **luật bắt buộc** mỗi session.

## Luật kiến trúc (vi phạm = làm lại, không thương lượng)

1. **LLM call CHỈ nằm trong `packages/llm`.** Không nơi nào khác được import
   `@anthropic-ai/sdk` hay gọi HTTP tới bất kỳ LLM API nào.
2. **Graph backend CHỈ được chạm qua interface `GraphProvider`** trong `packages/graph`.
   `packages/core` và `apps/*` không được biết codebase-memory-mcp hay CodeGraph tồn tại.
3. **`packages/core` thuần logic**: không đọc `process.env`, không network, không fs trực
   tiếp trừ khi nhận path qua tham số, không `console.log`. I/O và wiring nằm ở `apps/*`.
4. **Mọi dữ liệu từ ngoài đi qua zod trước khi dùng**: frontmatter, env, CLI args, LLM output.
5. **Verdict không có evidence thì không được mang status `violation`.** Không chắc → `uncertain`.

## Chuẩn code

- TypeScript `strict: true`, ESM, Node >= 20, pnpm workspaces.
- Typed errors (`class IntentParseError extends Error`...); không bare `catch (e) {}` nuốt lỗi.
- `import type` tách bạch. Function < 40 dòng. Mỗi file một trách nhiệm.
- Log bằng pino, chỉ ở `apps/*`. Không hardcode secret; thêm env mới → cập nhật `.env.example`.
- Tên biến có nghĩa — không `x`, `tmp`, `data` làm tên cuối.

## Workflow bắt buộc

1. Làm **đúng 1 task** trong `TASKS-PHASE0.md` mỗi lượt, theo thứ tự T0 → T5.
2. Task có acceptance test sẵn trong repo → code đến khi test xanh.
   **KHÔNG sửa acceptance test để nó pass** — test là spec. Tin rằng test sai → dừng lại,
   nêu lý do, chờ xác nhận.
3. Trước khi báo xong task: `pnpm lint && pnpm typecheck && pnpm test` đều xanh.
4. Không tự thêm dependency ngoài danh sách dưới. Cần thêm → hỏi trước, kèm lý do.
5. Commit theo conventional commits (`feat(core): ...`, `test(cli): ...`).

## Dependencies cho phép (Phase 0)

Runtime: `zod`, `gray-matter`, `micromatch`, `commander`, `picocolors`, `pino` (apps only).
Dev: `typescript`, `vitest`, `tsx`, `tsup`, `eslint`, `prettier`, `@types/node`, `@types/micromatch`.

## Lệnh

```bash
pnpm install
pnpm -r build        # tsup từng package
pnpm test            # vitest toàn workspace
pnpm lint && pnpm typecheck
```

## Không làm

- Không code Phase 1+ (drift engine, GraphProvider, LLM) khi Phase 0 chưa xanh hết.
- Không tạo abstraction "phòng cho tương lai" ngoài những gì DESIGN.md nêu.
- Không đổi schema intent mà không bump `schema_version` và cập nhật DESIGN.md.
- Không ghi đè file người dùng (intent, config) khi không có `--force`.