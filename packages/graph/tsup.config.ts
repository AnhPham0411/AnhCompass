import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true, external: ['typescript'], 
  clean: true,
  tsconfig: 'tsconfig.json',
});
