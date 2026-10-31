import { defineConfig, configDefaults } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    // Agent worktrees check out a full repo copy under .claude/worktrees/ —
    // without this exclude the root suite runs every test twice (and the
    // copies fail on root-relative fixtures).
    exclude: [...configDefaults.exclude, '.claude/worktrees/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
