import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['src/**/*.test.{ts,tsx}'], exclude: ['src/**/*.bench.test.ts'] } },
      { test: { name: 'bench', include: ['src/**/*.bench.test.ts'], testTimeout: 120_000 } },
    ],
  },
})
