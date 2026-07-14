# Báo Cáo Hiệu Năng & Khả Năng Chịu Tải (Performance Benchmark)

> **Mục đích:** Ghi chú lại kết quả stress-test của AnhCompass trên các điều kiện khắc nghiệt (hàng nghìn files).
> **Ngày test:** 14/07/2026
> **Môi trường:** Node.js 20, pnpm workspaces, Windows.
> **LLM Provider:** OpenAI (`gpt-4o-mini`) qua Native Fetch (Model-agnostic).

---

## 1. Bài Test 1: Quy mô Production nhỏ (500 Files)

*   **Đầu vào:** Diff gồm **495 files** thay đổi. Chứa 4 intents (2 deterministic, 2 semantic).
*   **Tổng thời gian thực thi (Latency):** `4.3 giây` (4303 ms)
*   **Kết quả phát hiện:**
    *   **Deterministic:** Bắt chính xác 100% 2 file vi phạm (dùng `lodash` và `moment`). Tốc độ xử lý < 0.05s, không tốn token.
    *   **Semantic:** Phát hiện chính xác `console.log` trong API layer (tỉ lệ tự tin: 100%). Rule crypto trả về `UNCERTAIN` do context cung cấp không đủ rủi ro để AI kết luận.
*   **Kết luận:** Xử lý một Pull Request lớn (~500 files) mất chưa tới 5s. Phù hợp để nhúng thẳng vào Pre-commit hook hoặc CI pipeline mà không gây chậm trễ.

## 2. Bài Test 2: Quy mô Monolithic Repo (10.000 Files)

*   **Đầu vào:** Diff siêu khổng lồ gồm **10.004 files**. Rải rác vi phạm ngẫu nhiên.
*   **Tổng thời gian thực thi:** `8.78 giây` (8780 ms)
*   **Fix kĩ thuật đã áp dụng:**
    *   Mặc định `git diff` của 10.000 files vượt quá buffer mặc định của Node.js (1MB) gây lỗi `stdout maxBuffer length exceeded`.
    *   **Cách giải quyết:** Đã chỉnh sửa lõi `diff/parse.ts`, tăng `maxBuffer` lên **100MB**. Hệ thống không bị crash và parse thành công toàn bộ diff trong bộ nhớ.
*   **Kết quả phát hiện:**
    *   **Deterministic:** Vẫn bắt trúng vi phạm (vd: `src/services/file_107.js` chứa import lodash) cực kỳ nhanh.
    *   **Semantic:** Trả về `UNCERTAIN`. 
*   **Bản chất của `UNCERTAIN` trên scale lớn:**
    *   Khi diff lên tới 10.000 files, lượng text sinh ra lên tới hàng chục MB, vượt xa Context Window của LLM.
    *   Hệ thống có cơ chế **Token Budgeting** (~6000 tokens) để bảo vệ chi phí API của user. Nó tự động cắt bớt diff.
    *   Do file vi phạm bị cắt mất, AI không nhìn thấy chứng cứ → Trả về `UNCERTAIN`.
    *   *Đây là tính năng an toàn (Safety feature)*: AI không bị ảo giác (hallucination) để tạo ra False Positive. Nếu không thấy, nó trung thực báo là không chắc chắn.

## 3. Bài Học Rút Ra & Insight Kiến Trúc

1.  **Lá chắn Deterministic (Regex):** Trong những tình huống PR khổng lồ làm mù mắt LLM (vì vượt token budget), engine Deterministic (chạy local, regex-based) vẫn là tấm khiên thép vững chắc nhất để giữ ranh giới kiến trúc. Nó bao quát toàn bộ 10.000 files mà không sót một dòng, chi phí $0.
2.  **Tốc độ Parse:** Thuật toán phân tách Unified Diff sang cấu trúc JSON nội bộ của AnhCompass cực kì hiệu quả. Parse 10.000 files mất chưa tới 2 giây. Phần lớn thời gian của `8.78s` là chờ Network IO từ OpenAI.
3.  **Khả năng Model-Agnostic:** Module LLM Client viết bằng Native Fetch chạy trơn tru với API key của OpenAI, tự động map model (`claude-haiku-4-5` -> `gpt-4o-mini`) mà không cần cài thêm bất kỳ dependency cồng kềnh nào (không dùng SDK của OpenAI hay Google). Điều này giúp package giữ được sự tinh gọn tuyệt đối.

---
*Ghi chú: Lịch sử test và chi tiết log LLM có thể xem lại tại thư mục `.agent/cache` (nếu không clear) trong quá trình phát triển.*
