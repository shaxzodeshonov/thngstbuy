import { useEffect, useState } from 'react'
import { Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { ChevronLeft } from './Icons'
import { api } from './api'
import { PAD, color, fieldLabel, font, label } from './theme'

type ShareScreenProps = {
  slug: string
  onClose(): void
  onRename(next: string): Promise<string | null>
}

/** The link, and the one place it can be renamed. Mirrors the website's sheet. */
export function ShareScreen({ slug, onClose, onRename }: ShareScreenProps) {
  const [draft, setDraft] = useState(slug)
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  const url = `${api.baseUrl}/l/${slug}`
  const changed = draft.trim().toLowerCase() !== slug

  useEffect(() => setDraft(slug), [slug])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1800)
    return () => clearTimeout(timer)
  }, [copied])

  async function save() {
    if (!changed || saving) return
    setSaving(true)
    setProblem(await onRename(draft.trim().toLowerCase()))
    setSaving(false)
  }

  return (
    <View style={styles.screen}>
      <View style={styles.head}>
        <Pressable onPress={onClose} hitSlop={14} accessibilityRole="button" accessibilityLabel="Back to the list">
          <ChevronLeft />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Share this list</Text>
        <Text style={styles.lead}>
          Anyone with this link can add, edit and delete things. There is no password.
        </Text>

        <Text style={styles.url} selectable>
          {url}
        </Text>

        <View style={styles.buttons}>
          <Pressable
            style={[styles.button, copied && styles.buttonOn]}
            onPress={async () => {
              await Clipboard.setStringAsync(url)
              setCopied(true)
            }}
          >
            <Text style={[styles.buttonLabel, copied && styles.buttonLabelOn]}>
              {copied ? 'Link copied' : 'Copy link'}
            </Text>
          </Pressable>

          <Pressable style={styles.button} onPress={() => void Share.share({ message: url })}>
            <Text style={styles.buttonLabel}>Send</Text>
          </Pressable>
        </View>

        <View style={styles.rename}>
          <Text style={styles.fieldLabel}>Custom name</Text>

          <View style={styles.input}>
            <Text style={styles.prefix}>/l/</Text>
            <TextInput
              style={styles.field}
              value={draft}
              onChangeText={(next) => {
                setDraft(next)
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
            A name like <Text style={styles.em}>shaxzod</Text> is easy to remember — and easy for
            anyone else to guess. Leave the generated one if this list should stay private.
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
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.surface },
  head: { flexDirection: 'row', minHeight: 26, paddingHorizontal: PAD, paddingBottom: 26 },
  body: { paddingHorizontal: PAD, paddingBottom: PAD },

  title: { fontFamily: font.bold, fontSize: 26, letterSpacing: -0.57, color: color.ink },
  lead: { fontFamily: font.regular, fontSize: 14.5, lineHeight: 23, color: color.inkMuted, marginTop: 10 },

  url: {
    marginTop: 26,
    padding: 14,
    borderRadius: 12,
    backgroundColor: color.surfaceSunken,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    fontFamily: font.regular,
    fontSize: 13.5,
    color: color.ink,
  },

  buttons: { flexDirection: 'row', gap: 10, marginTop: 14 },
  button: {
    borderWidth: 1,
    borderColor: color.lineStrong,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  buttonOn: { backgroundColor: color.accent, borderColor: color.accent },
  buttonLabel: { ...label, color: color.accent },
  buttonLabelOn: { color: color.surface },
  save: { marginTop: 20, alignSelf: 'flex-start' },
  disabled: { opacity: 0.4 },

  rename: { marginTop: 38, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line, paddingTop: 20 },
  fieldLabel: { ...fieldLabel },
  input: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    borderBottomWidth: 1,
    borderBottomColor: color.lineStrong,
    paddingBottom: 8,
  },
  prefix: { fontFamily: font.regular, fontSize: 15.5, color: color.inkFaint },
  field: { flex: 1, fontFamily: font.regular, fontSize: 15.5, color: color.ink, padding: 0 },
  note: { fontFamily: font.regular, fontSize: 13, lineHeight: 21, color: color.inkMuted, marginTop: 12 },
  em: { color: color.accent },
  problem: { fontFamily: font.regular, fontSize: 13, lineHeight: 21, color: color.danger, marginTop: 12 },
})
