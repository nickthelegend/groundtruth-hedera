import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    // Only the offline suites. The live-chain scripts under scripts/ spend real
    // HBAR and are run explicitly via `pnpm test:chain`, never in CI.
    include: ['test/**/*.test.ts'],
    // Each file sets its own env before importing modules that read env at load
    // time (lib/money.ts derives its decimal scale that way), so files must not
    // share a process.
    pool: 'forks',
    poolOptions: { forks: { singleFork: false } },
    testTimeout: 15_000,
  },
  resolve: {
    alias: { '@': resolve(__dirname, '.') },
  },
})
