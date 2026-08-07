import { useState } from 'react'
import { Pressable, StyleSheet, TextInput, View } from 'react-native'
import { Plus } from './Icons'
import { FOOT_BOTTOM, PAD, color, font } from './theme'

/**
 * The bottom line of the list. Submitting keeps the keyboard up so several
 * things can be added in a row, matching the website.
 */
export function AddBar({ onAdd }: { onAdd(name: string): void }) {
  const [name, setName] = useState('')
  const ready = name.trim().length > 0

  function submit() {
    if (!ready) return
    onAdd(name)
    setName('')
  }

  return (
    <View style={styles.bar}>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="Add something"
        placeholderTextColor={color.accentSoft}
        returnKeyType="done"
        blurOnSubmit={false}
        onSubmitEditing={submit}
        accessibilityLabel="Add something to the list"
      />
      <Pressable
        onPress={submit}
        disabled={!ready}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Add to the list"
        style={[styles.button, ready && styles.buttonReady]}
      >
        <Plus size={18} tint={ready ? color.surface : color.inkMuted} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
    paddingTop: 22,
    // Without this the add row sits directly on the gesture bar. The safe-area
    // inset stops it being *under* the bar; it does not stop it touching it.
    paddingBottom: FOOT_BOTTOM,
    paddingHorizontal: PAD,
  },
  input: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: 15.5,
    color: color.ink,
    padding: 0,
  },
  button: {
    width: 42,
    height: 42,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: color.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonReady: { backgroundColor: color.accent, borderColor: color.accent },
})
