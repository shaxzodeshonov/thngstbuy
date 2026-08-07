import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { ChevronLeft } from './Icons'
import { slugProblem } from './ids'
import { HEAD_TOP, PAD, color, fieldLabel, font, label } from './theme'

type NameScreenProps = {
  slug: string
  onClose(): void
  onRename(next: string): Promise<string | null>
  /** Leaves this list and asks which one to open instead. */
  onSwitch(): void
}

/**
 * Naming a list, and leaving it.
 *
 * The name is also the link, so this screen is where both live. Switching lists
 * is here rather than in the header because it is rare and slightly destructive
 * — it puts the app back to its opening question — and the header is for the
 * things you do every time.
 */
export function NameScreen({ slug, onClose, onRename, onSwitch }: NameScreenProps) {
  const [draft, setDraft] = useState(slug)
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const next = draft.trim().toLowerCase()
  const changed = next !== slug

  useEffect(() => setDraft(slug), [slug])

  async function save() {
    if (!changed || saving) return

    // Checked here as well as in the store so the answer is immediate; the
    // store enforces it either way, because it is the thing holding the data.
    const shape = slugProblem(next)
    if (shape) return setProblem(shape)

    setSaving(true)
    setProblem(await onRename(next))
    setSaving(false)
  }

  return (
    <View style={styles.screen}>
      <View style={styles.head}>
        <Pressable
          onPress={onClose}
          hitSlop={14}
          accessibilityRole="button"
          accessibilityLabel="Back to the list"
        >
          <ChevronLeft />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Name this list</Text>
        <Text style={styles.lead}>
          The name is the link. Anyone you send it to can open this list and edit it, so a short
          name is easier to share and easier for anyone else to guess.
        </Text>

        <Text style={styles.current} selectable>
          thngstbuy.vercel.app/l/{slug}
        </Text>

        <View style={styles.rename}>
          <Text style={styles.fieldLabel}>Custom name</Text>

          <View style={styles.input}>
            <TextInput
              style={styles.field}
              value={draft}
              onChangeText={(text) => {
                setDraft(text)
                setProblem(null)
              }}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="shaxzod"
              placeholderTextColor={color.inkFaint}
              onSubmitEditing={save}
            />
          </View>

          <Text style={styles.note}>
            A name like <Text style={styles.em}>shaxzod</Text> is easier to recognise than the
            generated one. Renaming changes nothing about what's in the list, and a link you have
            already sent someone keeps working.
          </Text>

          {problem && <Text style={styles.problem}>{problem}</Text>}

          <Pressable
            style={[styles.button, styles.save, (!changed || saving) && styles.disabled]}
            onPress={save}
            disabled={!changed || saving}
          >
            <Text style={styles.buttonLabel}>{saving ? 'Saving' : 'Save name'}</Text>
          </Pressable>
        </View>

        <View style={styles.switch}>
          <Text style={styles.fieldLabel}>Another list</Text>
          <Text style={styles.note}>
            Open a different list from a link. This one stays where it is — it lives on the server,
            not on this phone, so nothing is lost by leaving it.
          </Text>

          <Pressable
            style={[styles.button, styles.save]}
            onPress={onSwitch}
            accessibilityRole="button"
          >
            <Text style={styles.buttonLabel}>Open another list</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.surface },
  head: {
    flexDirection: 'row',
    minHeight: 26,
    paddingHorizontal: PAD,
    paddingTop: HEAD_TOP,
    paddingBottom: 26,
  },
  body: { paddingHorizontal: PAD, paddingBottom: PAD },

  title: { fontFamily: font.bold, fontSize: 26, letterSpacing: -0.57, color: color.ink },
  lead: {
    fontFamily: font.regular,
    fontSize: 14.5,
    lineHeight: 23,
    color: color.inkMuted,
    marginTop: 10,
  },

  current: {
    marginTop: 26,
    padding: 14,
    borderRadius: 12,
    backgroundColor: color.surfaceSunken,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    fontFamily: font.regular,
    fontSize: 14,
    color: color.ink,
  },

  button: {
    borderWidth: 1,
    borderColor: color.lineStrong,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  buttonLabel: { ...label, color: color.accent },
  save: { marginTop: 20, alignSelf: 'flex-start' },
  disabled: { opacity: 0.4 },

  switch: {
    marginTop: 38,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
    paddingTop: 20,
  },
  rename: {
    marginTop: 38,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
    paddingTop: 20,
  },
  fieldLabel: { ...fieldLabel },
  input: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    borderBottomWidth: 1,
    borderBottomColor: color.lineStrong,
    paddingBottom: 8,
  },
  field: { flex: 1, fontFamily: font.regular, fontSize: 15.5, color: color.ink, padding: 0 },
  note: { fontFamily: font.regular, fontSize: 13, lineHeight: 21, color: color.inkMuted, marginTop: 12 },
  em: { color: color.accent },
  problem: { fontFamily: font.regular, fontSize: 13, lineHeight: 21, color: color.danger, marginTop: 12 },
})
