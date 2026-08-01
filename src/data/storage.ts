/**
 * The single platform seam in the data layer.
 *
 * The interface is async because React Native's AsyncStorage is async. Porting
 * means writing one new `Storage` object and deleting nothing else:
 *
 *   import AsyncStorage from '@react-native-async-storage/async-storage'
 *   export const storage: Storage = {
 *     get: (k) => AsyncStorage.getItem(k),
 *     set: (k, v) => AsyncStorage.setItem(k, v),
 *   }
 */

export type Storage = {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
}

/** localStorage, wrapped so a disabled/full store degrades to in-memory. */
export const storage: Storage = {
  async get(key) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null
    } catch {
      return null
    }
  },
  async set(key, value) {
    try {
      globalThis.localStorage?.setItem(key, value)
    } catch {
      // Private mode / quota exceeded. State stays correct for this session.
    }
  },
}
