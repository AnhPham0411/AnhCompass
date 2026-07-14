import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/comment.ts'],
  format: ['esm'],
  dts: false,
  sourcemap: true,
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
});
