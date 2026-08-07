import { defineConfig } from 'vitest/config'

/**
 * Server tests only. The app has its own config under app/, because it needs a
 * different set of aliases and has to keep react-native out of the transform.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/**/*.test.js'],
    // db.js memoises its adapter at module scope, so each test file needs a
    // fresh module registry to point at its own database file.
    isolate: true,
  },
})
