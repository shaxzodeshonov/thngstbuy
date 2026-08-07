import { defineConfig } from 'vitest/config'
import path from 'node:path'

/**
 * The app's tests run in Node, not on a device. That is possible because the
 * storage layer sits behind the adapter in src/sqlite.ts — the same split
 * server/adapters.js makes — so the SQL under test is the SQL the phone runs.
 *
 * Anything that reaches for a native module cannot be tested here, which is why
 * the screens are not.
 */
export default defineConfig({
  resolve: {
    alias: {
      // Metro resolves this alias via metro.config.js; vitest needs telling too.
      '@domain': path.resolve(__dirname, '../src/domain'),
      // The real package pulls in react-native, which ships Flow source that
      // Vite cannot parse. No test reaches the expo adapter — see the stub.
      'expo-sqlite': path.resolve(__dirname, 'src/testing/expoSqliteStub.ts'),
    },
  },
  define: {
    // React Native injects this global; config.ts reads it.
    __DEV__: 'true',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
