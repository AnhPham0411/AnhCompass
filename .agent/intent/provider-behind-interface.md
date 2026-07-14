---
schema_version: 1
id: provider-behind-interface
title: Graph backend chỉ được truy cập qua GraphProvider interface
scope:
  - "packages/core/src/**"
  - "apps/**"
anchors:
  - type: path
    value: packages/graph/src/provider.ts
check: semantic
rule: |
  packages/core và apps/* không được import trực tiếp từ packages/graph/src/cbm
  hay packages/graph/src/codegraph.
  Mọi tương tác với graph backend phải qua interface GraphProvider.
severity: warn
status: active
owner: anh
created: 2026-07-14
---

## Context

Backend graph (codebase-memory-mcp, CodeGraph) còn non và có thể đổi API.
Giữ adapter sau interface để swap backend không phá sản phẩm.
