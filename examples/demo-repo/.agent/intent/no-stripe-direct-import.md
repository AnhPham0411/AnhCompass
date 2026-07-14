---
schema_version: 1
id: no-stripe-direct-import
title: Cô lập Stripe SDK sau PaymentService
scope:
  - "src/**"
anchors:
  - type: path
    value: src/services/payment.ts
check: deterministic
rule: |
  Mọi call tới Stripe SDK phải đi qua PaymentService.
  Không service/controller nào được import 'stripe' trực tiếp.
deterministic:
  kind: no-import
  from:
    - "src/api/**"
    - "src/services/!(payment)*.ts"
  to:
    - "stripe"
severity: warn
status: active
owner: demo
created: 2026-07-14
---

## Context

Tách gateway để sau này swap sang VNPay không phải sửa 20 chỗ.
Đã từng bị: PR #142 import stripe thẳng vào OrderController.

## Exceptions

- `scripts/stripe-migration/**` (one-off migration tooling)
