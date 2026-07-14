---
schema_version: 1
id: no-console-in-lib
title: Không dùng console.log trong thư viện
scope:
  - "src/lib/**"
check: semantic
rule: |
  Code trong src/lib/ không được dùng console.log, console.error, console.warn.
  Thư viện phải nhận logger qua dependency injection hoặc silent.
  console.log trong lib làm test output noise và không thể tắt được.
severity: warn
status: active
owner: demo
created: 2026-07-14
---

## Context

Thư viện bị dùng trong nhiều context (browser, node, lambda).
Console noise làm CI log khó đọc.

## Exceptions

Không có.
