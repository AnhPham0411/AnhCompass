# demo-repo

Simulated repo với 3 drift cài sẵn để test AnhCompass e2e.

## Drifts

1. **`src/api/order.ts`** — imports `stripe` directly (violates `no-stripe-direct-import` — deterministic)
2. **`src/services/user.ts`** — imports `PrismaClient` directly (violates `service-layer-pure` — semantic)
3. **`src/lib/formatter.ts`** — uses `console.log` (violates `no-console-in-lib` — semantic)

## Run

```bash
cd examples/demo-repo
git init && git add -A && git commit -m "baseline: add drift files"
# Make a change to trigger diff
echo "// change" >> src/api/order.ts
git add src/api/order.ts
# Run check from anhcompass root
node ../../apps/cli/dist/index.js check --repo-root . --diff HEAD
```
