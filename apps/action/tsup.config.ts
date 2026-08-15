import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/comment.ts'],
  format: ['esm'],
  dts: false,
  sourcemap: true,
  clean: true,
  // GitHub Actions run from a bare checkout with no node_modules —
  // the dist must be a single self-contained bundle
  noExternal: [/.*/],
  banner: { js: '#!/usr/bin/env node' },
});
