/**
 * Hairline icons, 1.5px round-capped, drawn on a 20×20 grid to sit on the
 * same optical weight as the type. `currentColor` throughout so the button
 * states drive them.
 */

type IconProps = { size?: number }

const base = {
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

export function ChevronLeft({ size = 20 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="M12.5 4.5 7 10l5.5 5.5" />
    </svg>
  )
}

export function Check({ size = 20 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="m4.5 10.5 3.5 3.5 7.5-8" />
    </svg>
  )
}

export function Trash({ size = 20 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="M3.75 5.75h12.5M8.25 5.75V4.5a1 1 0 0 1 1-1h1.5a1 1 0 0 1 1 1v1.25" />
      <path d="M5.5 5.75 6.25 16a.9.9 0 0 0 .9.85h5.7a.9.9 0 0 0 .9-.85l.75-10.25" />
    </svg>
  )
}

export function Plus({ size = 20 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true">
      <path d="M10 4.75v10.5M4.75 10h10.5" />
    </svg>
  )
}
