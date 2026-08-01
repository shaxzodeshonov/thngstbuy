import type { Item } from '@/domain/types'
import { formatPriceShort } from '@/domain/format'

type ItemRowProps = {
  item: Item
  selected: boolean
  onSelect(id: string): void
  onToggle(id: string): void
}

export function ItemRow({ item, selected, onSelect, onToggle }: ItemRowProps) {
  return (
    <li
      className={[
        'row',
        item.bought ? 'row--bought' : '',
        selected ? 'row--selected' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        type="button"
        className="row__check"
        role="checkbox"
        aria-checked={item.bought}
        aria-label={item.bought ? `Mark ${item.name} as not bought` : `Mark ${item.name} as bought`}
        onClick={() => onToggle(item.id)}
      >
        <span className="row__checkMark" />
      </button>

      <button type="button" className="row__open" onClick={() => onSelect(item.id)}>
        <span className="row__name">{item.name}</span>
        <span className="row__price">{formatPriceShort(item.price)}</span>
      </button>
    </li>
  )
}
