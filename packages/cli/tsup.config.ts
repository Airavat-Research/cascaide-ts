import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  clean: true,
  minify: true,
  bundle: true,
  noExternal: ['@clack/prompts', 'commander', 'gradient-string'],
  external: ['figlet'],
});