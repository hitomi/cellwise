import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      entry: { index: 'src/index.ts', core: 'src/core/index.ts', 'locales/zh-CN': 'src/locales/zh-cn.ts' },
      fileName: (_format, name) => `${name}.js`,
      formats: ['es'],
    },
    rollupOptions: { external: ['react', 'react/jsx-runtime', 'react-dom'] },
    sourcemap: true,
  },
})
