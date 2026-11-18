import { defineConfig } from 'vite'

export default defineConfig({
  root: 'demo',
  // Relative asset paths, so the build works under any GitHub Pages sub-path.
  base: './',
  build: { outDir: '../dist-demo', emptyOutDir: true },
  server: { host: true, port: 5180 },
})
