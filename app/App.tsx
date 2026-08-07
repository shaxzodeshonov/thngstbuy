import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, Share, StyleSheet, Text, View } from 'react-native'
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
import { ApiError, api } from './src/api'
import { shareUrl } from './src/config'
import { mirror } from './src/mirror'
import { parseListRef } from './src/ids'
import { LAST_LIST_KEY, storage } from './src/storage'
import { describe, useSyncedList } from './src/useSyncedList'
import { ListScreen } from './src/ListScreen'
import { DetailScreen } from './src/DetailScreen'
import { NameScreen } from './src/NameScreen'
import { OpenScreen } from './src/OpenScreen'
import { PAD, color, font, label } from './src/theme'

export default function App() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  })

  const [listId, setListId] = useState<string | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)
  /** Nothing to show and nothing remembered: ask which list to open. */
  const [needsList, setNeedsList] = useState(false)
  const opening = useRef(false)
  const incomingUrl = Linking.useURL()

  const openList = useCallback((id: string) => {
    setListId(id)
    setNeedsList(false)
    setBootError(null)
    void storage.set(LAST_LIST_KEY, id)
  }, [])

  /**
   * Opens a list the user named, having checked it is really there. Checking
   * first is what makes a typo say "no list with that name" instead of dropping
   * someone into an error screen for a list that never existed.
   */
  const openNamed = useCallback(
    async (ref: string): Promise<string | null> => {
      try {
        await api.getList(ref)
        openList(ref)
        return null
      } catch (failure) {
        if (failure instanceof ApiError && failure.status === 404) {
          return `No list called “${ref}”. Check the link, or start a new list.`
        }
        // Opening by name is the one thing that cannot be done offline: there is
        // no local copy of a list this device has never seen.
        if (await mirror.has(ref)) {
          openList(ref)
          return null
        }
        return "Couldn't reach the server. Check your connection and try again."
      }
    },
    [openList],
  )

  const createList = useCallback(async (): Promise<string | null> => {
    try {
      openList((await api.createList()).slug)
      return null
    } catch {
      return 'Starting a new list needs a connection, because the list lives on the server so it can be shared.'
    }
  }, [openList])

  /**
   * Which list to show, in order of preference: one opened from a link, then the
   * one used last. If neither, ask — a fresh install used to mint a list on the
   * spot, which meant someone who had been sent a link arrived at an empty list
   * that wasn't the one they were coming for, with no way to say so.
   */
  useEffect(() => {
    // `needsList` means the question is already on screen and waiting for an
    // answer. Without it, leaving a list opened from a link would walk straight
    // back into it, because the launch URL is still the launch URL.
    if (listId || needsList || opening.current) return
    opening.current = true

    void (async () => {
      try {
        const fromLink =
          parseListRef(incomingUrl) ?? parseListRef(await Linking.getInitialURL())
        if (fromLink) return openList(fromLink)

        const remembered = await storage.get(LAST_LIST_KEY)
        if (remembered) return openList(remembered)

        setNeedsList(true)
      } catch (failure) {
        setBootError(describe(failure))
      } finally {
        opening.current = false
      }
    })()
  }, [incomingUrl, listId, needsList, openList])

  /**
   * A link arriving while the app is already open switches lists.
   *
   * Only when it is a link we have not already acted on. `useURL` keeps handing
   * back the URL the app was launched from, so without this, deliberately
   * leaving that list would be undone on the next render.
   */
  const handledUrl = useRef<string | null>(null)
  useEffect(() => {
    if (!incomingUrl || incomingUrl === handledUrl.current) return
    handledUrl.current = incomingUrl

    const fromLink = parseListRef(incomingUrl)
    if (fromLink && fromLink !== listId) openList(fromLink)
  }, [incomingUrl, listId, openList])

  const list = useSyncedList(listId)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [naming, setNaming] = useState(false)
  const selected = list.items.find((i) => i.id === selectedId) ?? null

  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null)
  }, [selectedId, selected])

  // Keep the URL-shaped id in step with a rename.
  useEffect(() => {
    if (list.slug && listId && list.slug !== listId) openList(list.slug)
  }, [list.slug, listId, openList])

  /**
   * Back to the opening question. This used to mint a list on the spot, which
   * was the wrong move from a dead end: someone whose link failed usually wants
   * to check the link, not to be handed a different empty list. Forgetting the
   * remembered one is what stops the next launch walking straight back in.
   */
  const startOver = useCallback(() => {
    setBootError(null)
    setListId(null)
    setNeedsList(true)
    void storage.set(LAST_LIST_KEY, '')
  }, [])

  const handleDelete = useCallback(
    (id: string) => {
      list.remove(id)
      if (selectedId === id) setSelectedId(null)
    },
    [list, selectedId],
  )

  /**
   * The link, over whatever the phone offers. The https form rather than the
   * app's own scheme, because the person receiving it may not have the app —
   * this way it opens in their browser, and in the app if they do.
   */
  const handleShare = useCallback(() => {
    if (!list.slug) return
    void Share.share({ message: shareUrl(list.slug) })
  }, [list.slug])

  if (!fontsLoaded) return <Splash />

  const problem = bootError ?? (list.status === 'error' ? list.error : null)

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        {/* Edge-to-edge draws under the bar, so the surface behind it is the
            SafeAreaView's; only the icon colour is set here. */}
        <StatusBar style="dark" />
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          {needsList && !listId ? (
            <OpenScreen onOpen={openNamed} onCreate={createList} />
          ) : problem ? (
            <Notice
              title="Can't open the list"
              // A list this device has already seen opens offline, so reaching
              // this screen means both the server and the local copy came up
              // empty. Starting a new one is the only move, and it needs a
              // connection — hence the detail line, which is the server's own
              // words rather than a guess.
              body="It isn't saved on this phone, and the server couldn't be reached to fetch it."
              detail={problem}
              actionLabel="Open another list"
              onPress={startOver}
            />
          ) : list.status === 'missing' ? (
            <Notice
              title="This list is gone"
              body="The server has nothing under that name. It may have been renamed — a link made before the rename keeps working, but a name typed by hand does not."
              actionLabel="Open another list"
              onPress={startOver}
            />
          ) : !listId || list.status === 'loading' ? (
            <Splash />
          ) : naming && list.slug ? (
            <NameScreen
              slug={list.slug}
              onClose={() => setNaming(false)}
              onRename={list.rename}
              onSwitch={startOver}
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
              unsent={list.pending}
              onOpen={setSelectedId}
              onToggle={list.toggleBought}
              onDelete={handleDelete}
              onAdd={list.add}
              onRename={() => setNaming(true)}
              onShare={handleShare}
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
