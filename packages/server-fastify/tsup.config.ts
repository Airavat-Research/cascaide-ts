import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  minify: true,
  target: 'es2022',
  bundle: true,
  skipNodeModulesBundle: true,
  external: ['fastify', '@cascaide-ts/core'],
});