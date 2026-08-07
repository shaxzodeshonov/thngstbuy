import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { Item } from '@domain/types'
import * as Items from '@domain/items'
import { formatCount, formatMoney } from '@domain/format'
import { ItemRow } from './ItemRow'
import { AddBar } from './AddBar'
import { PAD, color, font, label } from './theme'

type ListScreenProps = {
  items: Item[]
  /** False when the last attempt to reach the server failed. */
  live: boolean
  /** Writes made here that the server has not acknowledged yet. */
  unsent: number
  onOpen(id: string): void
  onToggle(id: string): void
  onDelete(id: string): void
  onAdd(name: string): void
  onRename(): void
  onShare(): void
}

export function ListScreen({
  items,
  live,
  unsent,
  onOpen,
  onToggle,
  onDelete,
  onAdd,
  onRename,
  onShare,
}: ListScreenProps) {
  const [showBought, setShowBought] = useState(false)

  const pending = Items.pending(items)
  const bought = Items.bought(items)
  const total = Items.pendingTotal(items)

  return (
    <View style={styles.screen}>
      <View style={styles.head}>
        <View>
          <Text style={styles.title}>Things to buy</Text>
          <SyncNote live={live} unsent={unsent} />
        </View>
        <View style={styles.headRight}>
          <Pressable onPress={onShare} hitSlop={10} accessibilityRole="button">
            <Text style={styles.share}>Share</Text>
          </Pressable>
          <Pressable onPress={onRename} hitSlop={10} accessibilityRole="button">
            <Text style={styles.share}>Name</Text>
          </Pressable>
          <Text style={styles.count}>{formatCount(pending.length)}</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollBody}
        keyboardShouldPersistTaps="handled"
      >
        {pending.length === 0 && bought.length === 0 ? (
          <Text style={styles.empty}>Nothing yet. Add the first thing below.</Text>
        ) : (
          pending.map((item, index) => (
            <View key={item.id} style={index === pending.length - 1 && styles.lastRow}>
              <ItemRow item={item} onOpen={onOpen} onToggle={onToggle} onDelete={onDelete} />
            </View>
          ))
        )}

        {bought.length > 0 && (
          <View style={styles.bought}>
            <Pressable onPress={() => setShowBought((v) => !v)} hitSlop={8}>
              <Text style={styles.boughtToggle}>
                {formatCount(bought.length)} bought {showBought ? '⌃' : '⌄'}
              </Text>
            </Pressable>

            {showBought &&
              bought.map((item, index) => (
                <View key={item.id} style={index === bought.length - 1 && styles.lastRow}>
                  <ItemRow item={item} onOpen={onOpen} onToggle={onToggle} onDelete={onDelete} />
                </View>
              ))}
          </View>
        )}
      </ScrollView>

      <View style={styles.foot}>
        {Items.hasPricedPending(items) && <Text style={styles.total}>{formatMoney(total)}</Text>}
        <AddBar onAdd={onAdd} />
      </View>
    </View>
  )
}

/**
 * Says when the list on screen is ahead of the list on the server.
 *
 * Deliberately a line of small muted text rather than a badge or a spinner. The
 * whole point of queueing writes is that the user does not have to care whether
 * they have gone yet — this is here for the moment they wonder, not to be
 * noticed the rest of the time. It renders nothing when there is nothing to say.
 */
function SyncNote({ live, unsent }: { live: boolean; unsent: number }) {
  if (live && unsent === 0) return null

  const what =
    unsent > 0 ? `${unsent} change${unsent === 1 ? '' : 's'} to send` : 'Offline — changes are saved'

  return <Text style={styles.syncNote}>{what}</Text>
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: PAD,
    paddingBottom: 30,
  },
  title: { ...label, color: color.accent },
  syncNote: { fontFamily: font.regular, fontSize: 12, color: color.inkFaint, marginTop: 5 },
  headRight: { flexDirection: 'row', alignItems: 'baseline', gap: 16 },
  share: { ...label, color: color.inkFaint },
  count: { ...label, color: color.inkFaint },

  scroll: { flex: 1 },
  scrollBody: { paddingBottom: 12 },
  /* The web list draws a rule under the final row as well as between rows. */
  lastRow: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
  empty: { fontFamily: font.regular, fontSize: 15, color: color.inkFaint, paddingHorizontal: PAD },

  bought: { paddingTop: 22 },
  boughtToggle: { ...label, color: color.inkFaint, paddingHorizontal: PAD, paddingVertical: 4 },

  foot: { paddingTop: 4 },
  total: {
    fontFamily: font.regular,
    fontSize: 13.5,
    color: color.inkMuted,
    paddingHorizontal: PAD,
    marginBottom: 20,
  },
})
