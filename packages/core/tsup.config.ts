import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  minify: true,
  target: 'es2022',
  splitting: true,
  bundle: true, 
  skipNodeModulesBundle: true,
  external: [
    '@reduxjs/toolkit',
    'reselect',
    /^@reduxjs\/.*$/ // Regex to catch all RTK sub-paths
  ],
});