---
schema_version: 1
id: service-layer-pure
title: Service layer không được gọi database trực tiếp
scope:
  - "src/services/**"
check: semantic
rule: |
  Các class trong src/services/ không được import ORM models trực tiếp (Prisma, TypeORM, Sequelize).
  Mọi data access phải đi qua Repository interface.
  Service constructor chỉ nhận Repository, không nhận db client trực tiếp.
severity: warn
status: active
owner: demo
created: 2026-07-14
---

## Context

Giữ service testable bằng mock repository.
Nếu service gọi DB trực tiếp thì unit test phải spin up DB thật.

## Exceptions

Không có.
