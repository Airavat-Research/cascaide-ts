import { defineConfig } from 'tsup';

export default defineConfig({
  // This glob pattern finds index.ts or index.tsx automatically
  entry: ['src/index.{ts,tsx}'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  minify: true,
  target: 'es2022',
  bundle: true,
  skipNodeModulesBundle: true,
  external: ['react', 'react-dom', 'react-redux', '@cascaide-ts/core'],
});