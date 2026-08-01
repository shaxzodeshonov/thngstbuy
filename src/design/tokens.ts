/**
 * The design's raw values, in a form React Native's StyleSheet can consume
 * directly. `src/styles/tokens.css` mirrors these as custom properties for the
 * web build — keep the two in sync when a value changes.
 */

export const color = {
  /** Warm paper the card floats on. */
  canvas: '#E9E6DF',
  /** The card itself — a shade lighter and warmer than the canvas. */
  surface: '#FAF9F6',
  /** Slightly recessed surface, used for the wide-screen summary pane. */
  surfaceSunken: '#F4F2ED',

  ink: '#1C1B19',
  inkMuted: '#A9A49C',
  inkFaint: '#C3BDB3',

  /** The tan that carries the section headings and the add-item prompt. */
  accent: '#A28B68',
  accentSoft: '#BCA989',

  line: '#E6E2DA',
  lineStrong: '#D8D3C9',
} as const

export const space = {
  xs: 4,
  sm: 8,
  md: 14,
  lg: 20,
  xl: 28,
  xxl: 40,
} as const

export const radius = {
  card: 28,
  control: 999,
} as const

export const type = {
  /** Uppercase, wide-tracked labels: section heads and field names. */
  label: { size: 11, weight: '500', tracking: 1.6 },
  fieldLabel: { size: 10.5, weight: '500', tracking: 1.4 },
  itemName: { size: 16.5, weight: '600', tracking: -0.1 },
  price: { size: 14, weight: '400', tracking: 0 },
  title: { size: 30, weight: '700', tracking: -0.7 },
  body: { size: 15.5, weight: '400', tracking: -0.1 },
} as const

/** Every transition in the app uses one of these two. */
export const motion = {
  quick: 140,
  settle: 260,
} as const
