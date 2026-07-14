---
schema_version: 1
id: no-llm-outside-llm-pkg
title: LLM calls chỉ nằm trong packages/llm
scope:
  - "packages/core/src/**"
  - "apps/**"
anchors:
  - type: path
    value: packages/llm/src/client.ts
check: deterministic
rule: |
  Mọi HTTP call tới LLM API (Anthropic, OpenAI...) phải nằm trong @anhcompass/llm.
  packages/core và apps/* không được import @anthropic-ai/sdk hay openai trực tiếp.
deterministic:
  kind: no-import
  from:
    - "packages/core/src/**"
    - "apps/*/src/**"
  to:
    - "@anthropic-ai/sdk"
    - "openai"
severity: warn
status: active
owner: anh
created: 2026-07-14
---

## Context

Nếu LLM call rải rác khắp nơi, không trace được chi phí, không retry đồng nhất.
Tập trung vào một package để log đủ prompt/token/latency và swap model dễ dàng.

## Exceptions

Không có.
