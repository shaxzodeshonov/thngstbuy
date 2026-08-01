import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * The offline cache. The web app's storage.ts was written with an async
 * interface from the start so this file could be exactly this short.
 */
export const storage = {
  async get(key: string): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(key)
    } catch {
      return null
    }
  },
  async set(key: string, value: string): Promise<void> {
    try {
      await AsyncStorage.setItem(key, value)
    } catch {
      // Out of space or unavailable. State stays correct for this session.
    }
  },
}

/** Remembers which list to reopen, so the app doesn't mint a new one each launch. */
export const LAST_LIST_KEY = 'thngstbuy.lastList'
