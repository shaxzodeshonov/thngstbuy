// Installs global.crypto.getRandomValues, which Hermes does not ship. It must
// come first: @domain/items builds item ids from it, and the server keeps a
// client-supplied id only if it is a well-formed UUID -- otherwise it mints its
// own, and the optimistic row and the stored row become two different items.
import 'react-native-get-random-values'

// Gesture Handler must be imported before anything that renders, or the swipe
// gestures silently do nothing on Android.
import 'react-native-gesture-handler'

import { registerRootComponent } from 'expo'
import App from './App'

registerRootComponent(App)
