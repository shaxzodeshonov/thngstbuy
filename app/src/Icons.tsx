import { View, type ViewStyle } from 'react-native'
import { color } from './theme'

/**
 * The web app draws its icons as 1.5px SVG paths. React Native has no SVG
 * without another dependency, and these four shapes are simple enough to build
 * from views — which keeps the install smaller and renders identically.
 */

type IconProps = { size?: number; tint?: string }

/** Two strokes rotated into a chevron pointing left. */
export function ChevronLeft({ size = 20, tint = color.ink }: IconProps) {
  const arm: ViewStyle = {
    position: 'absolute',
    width: 1.6,
    height: size * 0.42,
    backgroundColor: tint,
    borderRadius: 1,
  }
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={[arm, { transform: [{ translateY: -size * 0.145 }, { rotate: '45deg' }] }]}
      />
      <View style={[arm, { transform: [{ translateY: size * 0.145 }, { rotate: '-45deg' }] }]} />
    </View>
  )
}

/** A tick: a short arm and a long arm, rotated into place. */
export function Check({ size = 18, tint = color.ink }: IconProps) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: size * 0.34,
          height: size * 0.66,
          borderRightWidth: 1.7,
          borderBottomWidth: 1.7,
          borderColor: tint,
          transform: [{ rotate: '45deg' }, { translateY: -size * 0.06 }],
        }}
      />
    </View>
  )
}

/** A lid, a rim and a body. */
export function Trash({ size = 18, tint = color.ink }: IconProps) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: size * 0.28,
          height: 1.5,
          backgroundColor: tint,
          marginBottom: 1.5,
          borderRadius: 1,
        }}
      />
      <View style={{ width: size * 0.72, height: 1.5, backgroundColor: tint, borderRadius: 1 }} />
      <View
        style={{
          width: size * 0.56,
          height: size * 0.56,
          borderWidth: 1.5,
          borderTopWidth: 0,
          borderColor: tint,
          borderBottomLeftRadius: 2,
          borderBottomRightRadius: 2,
          marginTop: 1.5,
        }}
      />
    </View>
  )
}

export function Plus({ size = 18, tint = color.ink }: IconProps) {
  const bar: ViewStyle = { position: 'absolute', backgroundColor: tint, borderRadius: 1 }
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={[bar, { width: size * 0.62, height: 1.6 }]} />
      <View style={[bar, { width: 1.6, height: size * 0.62 }]} />
    </View>
  )
}
