import { useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { parseListRef } from './ids'
import { HEAD_TOP, PAD, color, fieldLabel, font, label, wordmark } from './theme'

type OpenScreenProps = {
  /** Resolves to null once the list is open, or to a message saying why not. */
  onOpen(ref: string): Promise<string | null>
  /** Mints a new list on the server. Needs a connection. */
  onCreate(): Promise<string | null>
}

/**
 * The first thing a new install shows.
 *
 * A list here is not an account — there is no sign-up, and the link is the only
 * key. So the honest first question is not "who are you" but "which list", and
 * the two answers are: one you were sent, or a new one.
 *
 * The input takes a whole link or just the name, because someone who was sent a
 * link will paste the link and someone who knows the name will type the name.
 * Sorting that out is `parseListRef`'s job, not the user's.
 */
export function OpenScreen({ onOpen, onCreate }: OpenScreenProps) {
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState<'opening' | 'creating' | null>(null)

  const ref = parseListRef(draft)
  const typed = draft.trim().length > 0

  async function open() {
    if (busy) return

    if (!ref) {
      setProblem(
        typed
          ? "That doesn't look like a list link or name. Paste the whole link, or just the part after /l/."
          : 'Paste a link, or type a list name.',
      )
      return
    }

    setBusy('opening')
    setProblem(await onOpen(ref))
    setBusy(null)
  }

  async function create() {
    if (busy) return
    setBusy('creating')
    setProblem(await onCreate())
    setBusy(null)
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.mark}>thngstobuy</Text>

        <Text style={styles.title}>Open a list</Text>
        <Text style={styles.lead}>
          A list lives at a link. Paste one you've been sent to open it here — on this phone and in
          a browser it's the same list, and anyone holding the link can edit it.
        </Text>

        <Text style={styles.fieldLabel}>Link or name</Text>

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
            autoComplete="off"
            keyboardType="url"
            placeholder="thngstbuy.vercel.app/l/shaxzod"
            placeholderTextColor={color.inkFaint}
            returnKeyType="go"
            onSubmitEditing={open}
            editable={busy === null}
            accessibilityLabel="List link or name"
          />
        </View>

        <Text style={styles.note}>
          Either the whole link, or just the last part of it — <Text style={styles.em}>shaxzod</Text>{' '}
          or <Text style={styles.em}>tpd3k4q6vb06</Text>.
        </Text>

        {problem && <Text style={styles.problem}>{problem}</Text>}

        <Pressable
          style={[styles.button, styles.primary, (busy !== null || !typed) && styles.disabled]}
          onPress={open}
          disabled={busy !== null || !typed}
          accessibilityRole="button"
        >
          {busy === 'opening' ? (
            <ActivityIndicator color={color.surface} size="small" />
          ) : (
            <Text style={styles.primaryLabel}>Open this list</Text>
          )}
        </Pressable>

        <View style={styles.or}>
          <View style={styles.rule} />
          <Text style={styles.orLabel}>or</Text>
          <View style={styles.rule} />
        </View>

        <Pressable
          style={[styles.button, busy !== null && styles.disabled]}
          onPress={create}
          disabled={busy !== null}
          accessibilityRole="button"
        >
          {busy === 'creating' ? (
            <ActivityIndicator color={color.accent} size="small" />
          ) : (
            <Text style={styles.buttonLabel}>Start a new list</Text>
          )}
        </Pressable>

        <Text style={styles.foot}>
          A new list gets its own link, which you can rename and send to anyone.
        </Text>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.surface },
  body: { paddingHorizontal: PAD, paddingTop: HEAD_TOP + 22, paddingBottom: PAD },

  mark: { ...wordmark, color: color.accent, marginBottom: 44 },

  title: { fontFamily: font.bold, fontSize: 26, letterSpacing: -0.57, color: color.ink },
  lead: {
    fontFamily: font.regular,
    fontSize: 14.5,
    lineHeight: 23,
    color: color.inkMuted,
    marginTop: 10,
  },

  fieldLabel: { ...fieldLabel, marginTop: 34 },
  input: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    borderBottomWidth: 1,
    borderBottomColor: color.lineStrong,
    paddingBottom: 8,
  },
  field: { flex: 1, fontFamily: font.regular, fontSize: 15.5, color: color.ink, padding: 0 },
  note: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 21,
    color: color.inkMuted,
    marginTop: 12,
  },
  em: { color: color.accent },
  problem: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 21,
    color: color.danger,
    marginTop: 12,
  },

  button: {
    borderWidth: 1,
    borderColor: color.lineStrong,
    borderRadius: 999,
    paddingVertical: 13,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  buttonLabel: { ...label, color: color.accent },
  primary: {
    marginTop: 22,
    backgroundColor: color.accent,
    borderColor: color.accent,
  },
  primaryLabel: { ...label, color: color.surface },
  disabled: { opacity: 0.4 },

  or: { flexDirection: 'row', alignItems: 'center', gap: 14, marginVertical: 26 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: color.line },
  orLabel: { ...label, color: color.inkFaint },

  foot: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 21,
    color: color.inkFaint,
    marginTop: 16,
  },
})
