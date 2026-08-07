import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import type { Item } from '@domain/types'
import { formatCount, formatDate, formatMoney, parsePrice } from '@domain/format'
import { Check, ChevronLeft, Trash } from './Icons'
import { HEAD_TOP, PAD, color, fieldLabel, font, label } from './theme'

type DetailScreenProps = {
  item: Item
  position: number
  onBack(): void
  onChange(patch: Partial<Item>): void
  onToggleBought(): void
  onDelete(): void
}

export function DetailScreen({
  item,
  position,
  onBack,
  onChange,
  onToggleBought,
  onDelete,
}: DetailScreenProps) {
  const armed = useArmedDelete(item.id)

  return (
    <View style={styles.screen}>
      <View style={styles.head}>
        <Pressable onPress={onBack} hitSlop={14} accessibilityRole="button" accessibilityLabel="Back to the list">
          <ChevronLeft />
        </Pressable>
        <Text style={styles.count}>{formatCount(position)}</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody}>
        <Draft
          value={item.name}
          onCommit={(name) => onChange({ name })}
          style={styles.title}
          placeholder="Untitled"
          accessibilityLabel="Name"
        />

        <PriceField value={item.price} onCommit={(price) => onChange({ price })} />

        <View style={styles.fields}>
          <Field
            name="Which model"
            value={item.model}
            placeholder="Not decided yet"
            onCommit={(model) => onChange({ model })}
          />
          <Field
            name="Where"
            value={item.where}
            placeholder="Not sure yet"
            onCommit={(where) => onChange({ where })}
          />
          <Field
            name="Why"
            value={item.why}
            placeholder="What is this for?"
            multiline
            onCommit={(why) => onChange({ why })}
          />
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Added</Text>
            <Text style={[styles.value, { color: color.inkMuted }]}>{formatDate(item.addedAt)}</Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.foot}>
        <Pressable
          onPress={onToggleBought}
          accessibilityRole="button"
          accessibilityLabel={item.bought ? 'Mark as not bought' : 'Mark as bought'}
          style={[styles.action, item.bought && styles.actionOn]}
        >
          <Check size={18} tint={item.bought ? color.surface : color.inkMuted} />
        </Pressable>

        <Pressable
          onPress={() => (armed.isArmed ? onDelete() : armed.arm())}
          accessibilityRole="button"
          accessibilityLabel={armed.isArmed ? 'Tap again to remove' : 'Remove'}
          style={[styles.action, armed.isArmed && styles.actionArmed]}
        >
          <Trash size={18} tint={armed.isArmed ? color.surface : color.inkMuted} />
        </Pressable>
      </View>
    </View>
  )
}

/**
 * While a field is being edited it owns its text. Someone else editing the same
 * list pushes a new snapshot every few seconds, and adopting it mid-word would
 * move the cursor out from under the person typing.
 */
function Draft({
  value,
  onCommit,
  style,
  placeholder,
  multiline,
  accessibilityLabel,
}: {
  value: string
  onCommit(next: string): void
  style: object
  placeholder: string
  multiline?: boolean
  accessibilityLabel?: string
}) {
  const [draft, setDraft] = useState<string | null>(null)

  return (
    <TextInput
      style={style}
      value={draft ?? value}
      placeholder={placeholder}
      placeholderTextColor={color.inkFaint}
      multiline={multiline}
      accessibilityLabel={accessibilityLabel}
      onFocus={() => setDraft(value)}
      onBlur={() => setDraft(null)}
      onChangeText={(next) => {
        setDraft(next)
        onCommit(next)
      }}
    />
  )
}

function Field({
  name,
  value,
  placeholder,
  multiline,
  onCommit,
}: {
  name: string
  value: string
  placeholder: string
  multiline?: boolean
  onCommit(next: string): void
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{name}</Text>
      <Draft
        value={value}
        onCommit={onCommit}
        placeholder={placeholder}
        multiline={multiline}
        style={styles.value}
        accessibilityLabel={name}
      />
    </View>
  )
}

/**
 * Price holds raw text while focused and only parses on blur, so the digit
 * grouping never fights the cursor.
 */
function PriceField({ value, onCommit }: { value: number | null; onCommit(next: number | null): void }) {
  const [draft, setDraft] = useState<string | null>(null)

  return (
    <TextInput
      style={styles.price}
      value={draft ?? (value === null ? '' : formatMoney(value))}
      placeholder="Add a price"
      placeholderTextColor={color.inkFaint}
      keyboardType="number-pad"
      accessibilityLabel="Price in UZS"
      onFocus={() => setDraft(value === null ? '' : String(value))}
      onChangeText={setDraft}
      onBlur={() => {
        onCommit(parsePrice(draft ?? ''))
        setDraft(null)
      }}
    />
  )
}

/** Two taps to delete, matching the website. Disarms itself after 3.5s. */
function useArmedDelete(itemId: string) {
  const [isArmed, setIsArmed] = useState(false)

  useEffect(() => setIsArmed(false), [itemId])

  useEffect(() => {
    if (!isArmed) return
    const timer = setTimeout(() => setIsArmed(false), 3500)
    return () => clearTimeout(timer)
  }, [isArmed])

  return { isArmed, arm: () => setIsArmed(true) }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.surface },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 26,
    paddingHorizontal: PAD,
    paddingTop: HEAD_TOP,
    paddingBottom: 26,
  },
  count: { ...label, color: color.inkFaint },

  scroll: { flex: 1 },
  scrollBody: { paddingHorizontal: PAD, paddingBottom: PAD },

  title: {
    fontFamily: font.bold,
    fontSize: 30,
    letterSpacing: -0.66,
    color: color.ink,
    padding: 0,
  },
  price: {
    fontFamily: font.regular,
    fontSize: 14.5,
    color: color.inkMuted,
    marginTop: 7,
    padding: 0,
  },

  fields: { marginTop: 30 },
  field: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
    paddingVertical: 17,
    gap: 7,
  },
  fieldLabel: { ...fieldLabel },
  value: { fontFamily: font.regular, fontSize: 15.5, color: color.ink, padding: 0 },

  foot: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
    paddingVertical: 20,
  },
  action: {
    width: 44,
    height: 44,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: color.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionOn: { backgroundColor: color.accent, borderColor: color.accent },
  actionArmed: { backgroundColor: color.danger, borderColor: color.danger },
})
