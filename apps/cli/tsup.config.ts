import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  sourcemap: true,
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
  /** The `@anhcompass/*` packages are workspace-private and never published,
   *  so a consumer installing `anhcompass` from npm cannot resolve them. They
   *  are bundled into the binary instead; their third-party dependencies stay
   *  external and are declared in this package's `dependencies`. */
  noExternal: [/^@anhcompass\//],
});
