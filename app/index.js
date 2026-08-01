// Gesture Handler must be imported before anything that renders, or the swipe
// gestures silently do nothing on Android.
import 'react-native-gesture-handler'

import { registerRootComponent } from 'expo'
import App from './App'

registerRootComponent(App)
