import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import * as Linking from 'expo-linking'
// Imported from the individual weight folders, not the package root. The root
// index references all 17 weights, and Metro then bundles every one of them —
// about 5.8MB of fonts the app never renders.
import { useFonts } from 'expo-font'
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular'
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium'
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold'
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold'
import * as Items from '@domain/items'
import { api } from './src/api'
import { LAST_LIST_KEY, storage } from './src/storage'
import { describe, useSyncedList } from './src/useSyncedList'
import { ListScreen } from './src/ListScreen'
import { DetailScreen } from './src/DetailScreen'
import { ShareScreen } from './src/ShareScreen'
import { PAD, color, font, label } from './src/theme'

/** Pulls the list name out of a deep link, e.g. https://…/l/shaxzod. */
function listFromUrl(url: string | null): string | null {
  if (!url) return null
  return /\/l\/([a-z0-9][a-z0-9-]{1,30}[a-z0-9])/.exec(url)?.[1] ?? null
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  })

  const [listId, setListId] = useState<string | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)
  const opening = useRef(false)
  const incomingUrl = Linking.useURL()

  const openList = useCallback((id: string) => {
    setListId(id)
    void storage.set(LAST_LIST_KEY, id)
  }, [])

  /**
   * Which list to show, in order of preference: one opened from a link, the one
   * used last, or a fresh one. Minting only happens when the other two miss, so
   * reopening the app doesn't scatter empty lists behind you.
   */
  useEffect(() => {
    if (listId || opening.current) return
    opening.current = true

    void (async () => {
      try {
        const fromLink = listFromUrl(incomingUrl) ?? listFromUrl(await Linking.getInitialURL())
        if (fromLink) return openList(fromLink)

        const remembered = await storage.get(LAST_LIST_KEY)
        if (remembered) return openList(remembered)

        openList((await api.createList()).slug)
      } catch (failure) {
        setBootError(describe(failure))
      } finally {
        opening.current = false
      }
    })()
  }, [incomingUrl, listId, openList])

  // A link arriving while the app is already open switches lists.
  useEffect(() => {
    const fromLink = listFromUrl(incomingUrl)
    if (fromLink && fromLink !== listId) openList(fromLink)
  }, [incomingUrl, listId, openList])

  const list = useSyncedList(listId)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const selected = list.items.find((i) => i.id === selectedId) ?? null

  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null)
  }, [selectedId, selected])

  // Keep the URL-shaped id in step with a rename.
  useEffect(() => {
    if (list.slug && listId && list.slug !== listId) openList(list.slug)
  }, [list.slug, listId, openList])

  const startFresh = useCallback(() => {
    setBootError(null)
    api
      .createList()
      .then((state) => openList(state.slug))
      .catch((failure: unknown) => setBootError(describe(failure)))
  }, [openList])

  const handleDelete = useCallback(
    (id: string) => {
      list.remove(id)
      if (selectedId === id) setSelectedId(null)
    },
    [list, selectedId],
  )

  if (!fontsLoaded) return <Splash />

  const problem = bootError ?? (list.status === 'error' ? list.error : null)

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        {/* Edge-to-edge draws under the bar, so the surface behind it is the
            SafeAreaView's; only the icon colour is set here. */}
        <StatusBar style="dark" />
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          {problem ? (
            <Notice
              title="Can't reach the list"
              body="The server answered with an error."
              detail={problem}
              actionLabel="Try again"
              onPress={startFresh}
            />
          ) : list.status === 'missing' ? (
            <Notice
              title="This list is gone"
              body="The link doesn't point at anything — it may have been mistyped, or the list was never created."
              actionLabel="Start a new list"
              onPress={startFresh}
            />
          ) : !listId || list.status === 'loading' ? (
            <Splash />
          ) : sharing && list.slug ? (
            <ShareScreen
              slug={list.slug}
              onClose={() => setSharing(false)}
              onRename={list.rename}
            />
          ) : selected ? (
            <DetailScreen
              item={selected}
              position={Items.positionOf(list.items, selected.id)}
              onBack={() => setSelectedId(null)}
              onChange={(patch) => list.update(selected.id, patch)}
              onToggleBought={() => {
                list.toggleBought(selected.id)
                setSelectedId(null)
              }}
              onDelete={() => handleDelete(selected.id)}
            />
          ) : (
            <ListScreen
              items={list.items}
              live={list.live}
              onOpen={setSelectedId}
              onToggle={list.toggleBought}
              onDelete={handleDelete}
              onAdd={list.add}
              onShare={() => setSharing(true)}
            />
          )}
        </SafeAreaView>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

function Splash() {
  return (
    <View style={[styles.root, styles.centre]}>
      <ActivityIndicator color={color.accentSoft} />
    </View>
  )
}

function Notice({
  title,
  body,
  detail,
  actionLabel,
  onPress,
}: {
  title: string
  body: string
  detail?: string | null
  actionLabel: string
  onPress(): void
}) {
  return (
    <View style={[styles.root, styles.centre, { padding: PAD }]}>
      <Text style={styles.noticeTitle}>{title}</Text>
      <Text style={styles.noticeBody}>{body}</Text>
      {detail && <Text style={styles.noticeDetail}>{detail}</Text>}
      <Pressable style={styles.noticeAction} onPress={onPress}>
        <Text style={styles.noticeActionLabel}>{actionLabel}</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.surface },
  safe: { flex: 1, backgroundColor: color.surface },
  centre: { alignItems: 'center', justifyContent: 'center' },

  noticeTitle: { fontFamily: font.bold, fontSize: 22, color: color.ink, textAlign: 'center' },
  noticeBody: {
    fontFamily: font.regular,
    fontSize: 15,
    lineHeight: 24,
    color: color.inkMuted,
    textAlign: 'center',
    marginTop: 12,
    maxWidth: 320,
  },
  noticeDetail: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 19,
    color: color.inkMuted,
    backgroundColor: color.surfaceSunken,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    borderRadius: 10,
    padding: 12,
    marginTop: 18,
    maxWidth: 340,
  },
  noticeAction: {
    marginTop: 26,
    borderWidth: 1,
    borderColor: color.lineStrong,
    borderRadius: 999,
    paddingVertical: 13,
    paddingHorizontal: 22,
  },
  noticeActionLabel: { ...label, color: color.accent },
})
