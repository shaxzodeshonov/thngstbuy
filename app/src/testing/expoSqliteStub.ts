/**
 * Stands in for `expo-sqlite` under vitest.
 *
 * The real package reaches into react-native, whose source ships as Flow rather
 * than TypeScript and cannot be parsed outside Metro. Nothing in a test should
 * ever reach the expo adapter — every test calls `useAdapter` first — so this
 * only has to exist, not work. It throws rather than returning a null object so
 * that a test which *does* fall through says why instead of failing obscurely.
 */

export function openDatabaseAsync(): Promise<never> {
  throw new Error(
    'expo-sqlite is not available under vitest. Call useAdapter(() => createNodeAdapter()) ' +
      'in a beforeEach, or move the assertion to a test that runs on a device.',
  )
}
