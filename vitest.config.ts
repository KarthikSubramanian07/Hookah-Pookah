import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['src/engine/**/*.ts', 'src/state/**/*.ts', 'src/worker/**/*.ts'],
      exclude: ['src/engine/preflopRanking.ts', 'src/worker/*.worker.ts'],
      reporter: ['text', 'lcov'],
      thresholds: { lines: 90, functions: 90, branches: 80, statements: 90 },
    },
  },
})
