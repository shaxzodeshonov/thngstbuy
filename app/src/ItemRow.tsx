import { useRef } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable'
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated'
import type { Item } from '@domain/types'
import { formatPriceShort } from '@domain/format'
import { Check, Trash } from './Icons'
import { PAD, color, font, label } from './theme'

type ItemRowProps = {
  item: Item
  onOpen(id: string): void
  onToggle(id: string): void
  onDelete(id: string): void
}

/**
 * A list row with two gestures:
 *
 *   swipe right  ->  ticks the item off as soon as you let go
 *   swipe left   ->  holds open a Delete button you then press
 *
 * The asymmetry is deliberate. Ticking something off is the common action and
 * is trivially undone by tapping the circle again, so it fires on release.
 * Deleting is not undoable, so the swipe only *offers* it and the press is what
 * commits — the same two-step the website uses with its arming trash button.
 */
export function ItemRow({ item, onOpen, onToggle, onDelete }: ItemRowProps) {
  const swipeable = useRef<SwipeableMethods>(null)

  return (
    <ReanimatedSwipeable
      ref={swipeable}
      friction={1.6}
      overshootLeft={false}
      overshootRight={false}
      leftThreshold={56}
      rightThreshold={72}
      renderLeftActions={(progress) => <TickBackdrop progress={progress} bought={item.bought} />}
      renderRightActions={() => (
        <DeleteAction
          onPress={() => {
            swipeable.current?.close()
            onDelete(item.id)
          }}
        />
      )}
      onSwipeableWillOpen={(direction) => {
        // Right-swipe reveals the left side. Act and spring straight back, so
        // the row never sits in an opened state waiting for a second gesture.
        if (direction !== 'left') return
        onToggle(item.id)
        swipeable.current?.close()
      }}
    >
      <View style={styles.row}>
        <Pressable
          onPress={() => onToggle(item.id)}
          hitSlop={12}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: item.bought }}
          accessibilityLabel={item.name}
          style={[styles.check, item.bought && styles.checkOn]}
        >
          {item.bought && <View style={styles.checkDot} />}
        </Pressable>

        <Pressable style={styles.body} onPress={() => onOpen(item.id)} accessibilityRole="button">
          <Text style={[styles.name, item.bought && styles.nameBought]} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={[styles.price, item.bought && styles.priceBought]}>
            {formatPriceShort(item.price)}
          </Text>
        </Pressable>
      </View>
    </ReanimatedSwipeable>
  )
}

/** Fades a tick in behind the row as it slides right, so the gesture explains itself. */
function TickBackdrop({ progress, bought }: { progress: SharedValue<number>; bought: boolean }) {
  const style = useAnimatedStyle(() => ({
    opacity: Math.min(progress.value, 1),
    transform: [{ scale: 0.7 + Math.min(progress.value, 1) * 0.3 }],
  }))

  return (
    <View style={styles.tickBackdrop}>
      <Animated.View style={style}>
        <Check size={20} tint={bought ? color.inkFaint : color.accent} />
      </Animated.View>
    </View>
  )
}

function DeleteAction({ onPress }: { onPress(): void }) {
  return (
    <Pressable style={styles.delete} onPress={onPress} accessibilityRole="button">
      <Trash size={16} tint={color.surface} />
      <Text style={styles.deleteLabel}>Delete</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
    backgroundColor: color.surface,
    paddingHorizontal: PAD,
  },
  check: {
    width: 19,
    height: 19,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: color.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: {
    borderColor: color.accentSoft,
    backgroundColor: 'rgba(162, 139, 104, 0.10)',
  },
  checkDot: { width: 7, height: 7, borderRadius: 999, backgroundColor: color.accent },
  body: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    paddingVertical: 19,
  },
  name: { flexShrink: 1, fontFamily: font.semibold, fontSize: 16.5, color: color.ink },
  nameBought: { color: color.inkFaint, textDecorationLine: 'line-through' },
  price: { fontFamily: font.regular, fontSize: 14, color: color.inkMuted },
  priceBought: { color: color.inkFaint },

  tickBackdrop: {
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingLeft: PAD,
    width: 96,
    backgroundColor: color.surfaceSunken,
  },
  delete: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 24,
    backgroundColor: color.danger,
  },
  deleteLabel: { ...label, color: color.surface },
})
