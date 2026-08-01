/**
 * A transcription of the web app's design tokens (src/design/tokens.ts and
 * src/styles/tokens.css), in the units React Native wants. The phone layout is
 * the one the web app already uses below 640px: the surface fills the screen,
 * no canvas margin, no rounded card.
 */

export const color = {
  surface: '#FAF9F6',
  surfaceSunken: '#F4F2ED',

  ink: '#1C1B19',
  inkMuted: '#A9A49C',
  inkFaint: '#C3BDB3',

  accent: '#A28B68',
  accentSoft: '#BCA989',

  line: '#E6E2DA',
  lineStrong: '#D8D3C9',

  /** Only ever used by the delete affordance. */
  danger: '#A8574A',
} as const

/** Gutter inside the screen, matching the web's --pad at phone width. */
export const PAD = 26

export const font = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const

/**
 * The uppercase, wide-tracked label used for section heads, field names and
 * the buttons that carry text.
 */
export const label = {
  fontFamily: font.medium,
  fontSize: 11,
  letterSpacing: 1.65,
  textTransform: 'uppercase',
  lineHeight: 13,
} as const

export const fieldLabel = {
  fontFamily: font.medium,
  fontSize: 10.5,
  letterSpacing: 1.47,
  textTransform: 'uppercase',
  color: color.inkMuted,
} as const

/** Height of a list row, so the swipe backdrop can match it exactly. */
export const ROW_HEIGHT = 62
