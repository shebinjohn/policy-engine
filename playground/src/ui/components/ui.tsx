/** Small shared building blocks: glyphs, status chips, fields, selects, callouts, copy button. */
import { createContext, useContext, useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type { EntityKind, World } from '../../engine/types.ts'
import { isAddress } from '../lib/format.ts'
import { keyOf, nameOf } from '../lib/describe.ts'

// ---------------------------------------------------------------------------------------------
// Engineer view
// ---------------------------------------------------------------------------------------------

export const EngineerContext = createContext(false)
export const useEngineer = () => useContext(EngineerContext)

/** Renders only in Engineer view. */
export function Tech({ children, block = false }: { children: ReactNode; block?: boolean }) {
  const on = useEngineer()
  if (!on || children === undefined || children === null || children === '') return null
  return block ? <div className="tech">{children}</div> : <span className="tech">{children}</span>
}

// ---------------------------------------------------------------------------------------------
// Glyphs (status marks always travel with a word)
// ---------------------------------------------------------------------------------------------

export type GlyphKind =
  | 'pass'
  | 'fail'
  | 'warn'
  | 'skip'
  | 'info'
  | 'none'
  | 'star'
  | 'star-empty'
  | 'clock'
  | 'arrow-right'
  | 'arrow-down'
  | 'up'
  | 'down'
  | 'plus'
  | 'close'
  | 'copy'
  | 'user'
  | 'module'
  | 'lock'

export function Glyph({ kind, size = 16, title }: { kind: GlyphKind; size?: number; title?: string }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    'aria-hidden': title ? undefined : true,
    role: title ? 'img' : undefined,
    className: `glyph glyph-${kind}`,
    focusable: false
  } as const
  const stroke = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round'
  } as const
  let body: ReactNode
  switch (kind) {
    case 'pass':
      body = (
        <>
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path
            d="M4.8 8.2l2.1 2.1 4.3-4.6"
            fill="none"
            stroke="var(--surface-raised)"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )
      break
    case 'fail':
      body = (
        <>
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path
            d="M5.5 5.5l5 5M10.5 5.5l-5 5"
            fill="none"
            stroke="var(--surface-raised)"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </>
      )
      break
    case 'warn':
      body = (
        <>
          <path
            d="M8 1.6l6.8 12.2H1.2z"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinejoin="round"
          />
          <path d="M8 6v3.6" stroke="var(--surface-raised)" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="8" cy="11.8" r="1" fill="var(--surface-raised)" />
        </>
      )
      break
    case 'skip':
      body = (
        <>
          <circle cx="8" cy="8" r="6.2" {...stroke} strokeWidth={1.4} />
          <path d="M5.2 8h5.6" {...stroke} />
        </>
      )
      break
    case 'none':
      body = <circle cx="8" cy="8" r="6.2" {...stroke} strokeWidth={1.4} strokeDasharray="2.4 2.2" />
      break
    case 'info':
      body = (
        <>
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path d="M8 7.2v4" stroke="var(--surface-raised)" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="8" cy="4.8" r="1" fill="var(--surface-raised)" />
        </>
      )
      break
    case 'star':
    case 'star-empty':
      body = (
        <path
          d="M8 1.4l1.95 4.1 4.5.55-3.3 3.1.85 4.45L8 11.4l-4 2.2.85-4.45-3.3-3.1 4.5-.55z"
          fill={kind === 'star' ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      )
      break
    case 'clock':
      body = (
        <>
          <circle cx="8" cy="8" r="6.3" {...stroke} strokeWidth={1.5} />
          <path d="M8 4.6V8l2.4 1.6" {...stroke} strokeWidth={1.5} />
        </>
      )
      break
    case 'arrow-right':
      body = <path d="M2.5 8h10M9 4.5L12.5 8 9 11.5" {...stroke} />
      break
    case 'arrow-down':
      body = <path d="M8 2.5v10M4.5 9L8 12.5 11.5 9" {...stroke} />
      break
    case 'up':
      body = <path d="M4 10l4-4 4 4" {...stroke} />
      break
    case 'down':
      body = <path d="M4 6l4 4 4-4" {...stroke} />
      break
    case 'plus':
      body = <path d="M8 3.5v9M3.5 8h9" {...stroke} />
      break
    case 'close':
      body = <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" {...stroke} />
      break
    case 'copy':
      body = (
        <>
          <rect x="5.2" y="5.2" width="8" height="8" rx="1.5" {...stroke} strokeWidth={1.5} />
          <path
            d="M10.8 3.4V3a1.2 1.2 0 00-1.2-1.2H3A1.2 1.2 0 001.8 3v6.6A1.2 1.2 0 003 10.8h.4"
            {...stroke}
            strokeWidth={1.5}
          />
        </>
      )
      break
    case 'user':
      body = (
        <>
          <circle cx="8" cy="5.2" r="2.8" {...stroke} strokeWidth={1.5} />
          <path d="M2.6 14c.6-2.9 2.8-4.4 5.4-4.4s4.8 1.5 5.4 4.4" {...stroke} strokeWidth={1.5} />
        </>
      )
      break
    case 'module':
      body = (
        <>
          <rect x="2" y="2" width="5" height="5" rx="1" {...stroke} strokeWidth={1.5} />
          <rect x="9" y="2" width="5" height="5" rx="1" {...stroke} strokeWidth={1.5} />
          <rect x="2" y="9" width="5" height="5" rx="1" {...stroke} strokeWidth={1.5} />
          <rect x="9" y="9" width="5" height="5" rx="1" {...stroke} strokeWidth={1.5} />
        </>
      )
      break
    case 'lock':
      body = (
        <>
          <rect x="3" y="7" width="10" height="7.2" rx="1.6" {...stroke} strokeWidth={1.5} />
          <path d="M5.4 7V5.2a2.6 2.6 0 015.2 0V7" {...stroke} strokeWidth={1.5} />
        </>
      )
      break
  }
  return (
    <svg {...common}>
      {title ? <title>{title}</title> : null}
      {body}
    </svg>
  )
}

export type Tone = 'success' | 'danger' | 'warning' | 'info' | 'neutral' | 'muted'

export function toneOf(status: string): Tone {
  switch (status) {
    case 'pass':
      return 'success'
    case 'fail':
      return 'danger'
    case 'warn':
      return 'warning'
    case 'info':
      return 'info'
    default:
      return 'muted'
  }
}

/** A status mark with its word: never colour alone. */
export function Status({ status, label, compact = false }: { status: string; label: string; compact?: boolean }) {
  const glyph: GlyphKind =
    status === 'pass' || status === 'fail' || status === 'warn' || status === 'skip' || status === 'info'
      ? status
      : 'none'
  return (
    <span className={`status tone-${toneOf(status)}${compact ? ' is-compact' : ''}`}>
      <Glyph kind={glyph} size={compact ? 14 : 16} />
      <span>{label}</span>
    </span>
  )
}

export function Pill({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`pill tone-${tone}`}>{children}</span>
}

export function Callout({
  tone = 'info',
  title,
  children,
  glyph
}: {
  tone?: Tone
  title?: ReactNode
  children?: ReactNode
  glyph?: GlyphKind
}) {
  const g: GlyphKind =
    glyph ?? (tone === 'success' ? 'pass' : tone === 'danger' ? 'fail' : tone === 'warning' ? 'warn' : 'info')
  return (
    <div className={`callout tone-${tone}`}>
      <Glyph kind={g} />
      <div className="callout-body">
        {title ? <p className="callout-title">{title}</p> : null}
        {children}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------------------------

export function Field({
  id,
  label,
  hint,
  children,
  inline = false
}: {
  id?: string
  label: ReactNode
  hint?: ReactNode
  children: ReactNode
  inline?: boolean
}) {
  return (
    <div className={`field${inline ? ' is-inline' : ''}`}>
      {id ? (
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
      ) : (
        <span className="field-label">{label}</span>
      )}
      {children}
      {hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  )
}

export interface Option {
  value: string
  label: string
  group?: string
  disabled?: boolean
}

export function Select({
  id,
  value,
  onChange,
  options,
  ariaLabel
}: {
  id: string
  value: string
  onChange: (v: string) => void
  options: Option[]
  ariaLabel?: string
}) {
  const groups: { name: string | undefined; items: Option[] }[] = []
  for (const o of options) {
    const last = groups[groups.length - 1]
    if (last && last.name === o.group) last.items.push(o)
    else groups.push({ name: o.group, items: [o] })
  }
  return (
    <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel}>
      {groups.map((g, i) =>
        g.name ? (
          <optgroup key={`${g.name}-${i}`} label={g.name}>
            {g.items.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ) : (
          g.items.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))
        )
      )}
    </select>
  )
}

export function TextInput({
  id,
  value,
  onChange,
  placeholder,
  suffix,
  mono = false,
  inputMode,
  ariaLabel
}: {
  id: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  suffix?: string
  mono?: boolean
  inputMode?: 'decimal' | 'numeric' | 'text'
  ariaLabel?: string
}) {
  return (
    <div className={`input-wrap${suffix ? ' has-suffix' : ''}`}>
      <input
        id={id}
        className={`input${mono ? ' is-mono' : ''}`}
        value={value}
        placeholder={placeholder}
        inputMode={inputMode}
        spellCheck={false}
        autoComplete="off"
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
      />
      {suffix ? <span className="input-suffix">{suffix}</span> : null}
    </div>
  )
}

/** Arrow keys, Home and End move between items of a group, wrapping around. */
function arrowIndex(key: string, i: number, n: number): number | null {
  if (key === 'ArrowRight' || key === 'ArrowDown') return (i + 1) % n
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (i - 1 + n) % n
  if (key === 'Home') return 0
  if (key === 'End') return n - 1
  return null
}

/** A row of mutually exclusive choices: a radio group with one tab stop and arrow keys. */
export function Segmented<T extends string>({
  id,
  value,
  onChange,
  options,
  label,
  size = 'md'
}: {
  id: string
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  label: string
  size?: 'sm' | 'md'
}) {
  const selected = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  )
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = arrowIndex(e.key, selected, options.length)
    if (next === null) return
    e.preventDefault()
    onChange(options[next].value)
    document.getElementById(`${id}-${options[next].value}`)?.focus()
  }
  return (
    <div className={`segmented is-${size}`} role="radiogroup" aria-label={label} id={id} onKeyDown={onKeyDown}>
      {options.map((o, i) => (
        <button
          key={o.value}
          id={`${id}-${o.value}`}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          tabIndex={i === selected ? 0 : -1}
          className={value === o.value ? 'is-on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** WAI-ARIA tabs: one tab stop, arrow keys select (automatic activation). Panels use tabPanelProps. */
export function Tabs<T extends string>({
  id,
  value,
  onChange,
  options,
  label
}: {
  id: string
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  label: string
}) {
  const selected = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  )
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = arrowIndex(e.key, selected, options.length)
    if (next === null) return
    e.preventDefault()
    onChange(options[next].value)
    document.getElementById(`${id}-tab-${options[next].value}`)?.focus()
  }
  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((o, i) => (
        <button
          key={o.value}
          id={`${id}-tab-${o.value}`}
          type="button"
          role="tab"
          aria-selected={i === selected}
          aria-controls={`${id}-panel-${o.value}`}
          tabIndex={i === selected ? 0 : -1}
          className={i === selected ? 'is-on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Props for the panel of a Tabs option. Pass active=false when the tabs are not in use (wide layouts). */
export function tabPanelProps(id: string, value: string, active: boolean) {
  return active
    ? { id: `${id}-panel-${value}`, role: 'tabpanel', 'aria-labelledby': `${id}-tab-${value}`, tabIndex: -1 }
    : { id: `${id}-panel-${value}` }
}

/** True while a media query matches. */
export function useMedia(query: string): boolean {
  const get = () => {
    try {
      return window.matchMedia(query).matches
    } catch {
      return false
    }
  }
  const [match, setMatch] = useState(get)
  useEffect(() => {
    let mq: MediaQueryList
    try {
      mq = window.matchMedia(query)
    } catch {
      return
    }
    const on = () => setMatch(mq.matches)
    on()
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [query])
  return match
}

export function Checkbox({
  id,
  checked,
  onChange,
  label,
  hint
}: {
  id: string
  checked: boolean
  onChange: (v: boolean) => void
  label: ReactNode
  hint?: ReactNode
}) {
  return (
    <label className="check" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="check-box" aria-hidden="true" />
      <span className="check-label">
        {label}
        {hint ? <span className="check-hint">{hint}</span> : null}
      </span>
    </label>
  )
}

export function Switch({
  id,
  checked,
  onChange,
  label
}: {
  id: string
  checked: boolean
  onChange: (v: boolean) => void
  label: ReactNode
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      className={`switch${checked ? ' is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
      <span className="switch-label">{label}</span>
    </button>
  )
}

const KIND_GROUPS: { kinds: EntityKind[]; group: string }[] = [
  { kinds: ['person'], group: 'People' },
  { kinds: ['service'], group: 'Services' },
  { kinds: ['module'], group: 'Modules' },
  { kinds: ['token', 'weth'], group: 'Tokens' },
  { kinds: ['safe'], group: 'This Safe' },
  { kinds: ['guard'], group: 'Policy Guard' },
  { kinds: ['multisend'], group: 'Batching' },
  { kinds: ['contract'], group: 'Other contracts' },
  { kinds: ['policy'], group: 'Policy contracts' }
]

export function addressOptions(world: World, kinds?: EntityKind[], engineer = false): Option[] {
  const out: Option[] = []
  for (const g of KIND_GROUPS) {
    if (g.kinds.includes('policy') && !engineer && !(kinds && kinds.includes('policy'))) continue
    const items = world.book.filter((e) => g.kinds.includes(e.kind) && (!kinds || kinds.includes(e.kind)))
    for (const e of items) {
      const label = e.kind === 'person' ? (e.label && e.label !== e.name ? e.label : e.name) : e.label || e.name
      out.push({ value: e.name, label, group: g.group })
    }
  }
  return out
}

const CUSTOM = '__custom'

/** Address picker over the address book, with a custom-address escape hatch. */
export function AddressSelect({
  id,
  world,
  value,
  onChange,
  kinds,
  allowCustom = true,
  ariaLabel
}: {
  id: string
  world: World
  value: string
  onChange: (v: string) => void
  kinds?: EntityKind[]
  allowCustom?: boolean
  ariaLabel?: string
}) {
  const engineer = useEngineer()
  const options = addressOptions(world, kinds, engineer)
  const key = keyOf(world, value)
  const known = options.some((o) => o.value === key)
  const [custom, setCustom] = useState(!known && value !== '')
  const showCustom = allowCustom && (custom || (!known && value !== ''))
  const opts = [...options]
  if (allowCustom) opts.push({ value: CUSTOM, label: 'Other address…', group: 'Other' })
  if (!known && !allowCustom && value) opts.unshift({ value: key, label: nameOf(world, value) })
  return (
    <div className="address-select">
      <Select
        id={id}
        ariaLabel={ariaLabel}
        value={showCustom ? CUSTOM : known ? key : (opts[0]?.value ?? '')}
        options={opts}
        onChange={(v) => {
          if (v === CUSTOM) {
            setCustom(true)
            onChange(isAddress(value) ? value : '')
          } else {
            setCustom(false)
            onChange(v)
          }
        }}
      />
      {showCustom ? (
        <TextInput
          id={`${id}-custom`}
          ariaLabel="Custom address"
          value={value}
          onChange={onChange}
          placeholder="0x…"
          mono
        />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------------------------

export function Button({
  id,
  children,
  onClick,
  variant = 'secondary',
  size = 'md',
  disabled,
  title,
  type = 'button'
}: {
  id?: string
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  title?: string
  type?: 'button' | 'submit'
}) {
  return (
    <button
      id={id}
      type={type}
      className={`btn is-${variant} is-${size}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  )
}

/** Copy to clipboard inside the click handler; if refused, select the text so the viewer can copy it. */
export function CopyText({ text, label = 'Copy' }: { text: string; label?: string }) {
  const ref = useRef<HTMLElement>(null)
  const [state, setState] = useState<'idle' | 'copied' | 'selected'>('idle')
  const uid = useId()
  const selectText = () => {
    const el = ref.current
    if (!el) return
    const range = document.createRange()
    range.selectNodeContents(el)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    setState('selected')
  }
  const copy = () => {
    try {
      const p = navigator.clipboard?.writeText(text)
      if (!p) return selectText()
      p.then(
        () => setState('copied'),
        () => selectText()
      )
    } catch {
      selectText()
    }
  }
  return (
    <div className="copy">
      <code ref={ref} className="code-block" id={`copy-${uid.replace(/:/g, '')}`}>
        {text}
      </code>
      <div className="copy-row">
        <Button size="sm" onClick={copy}>
          <Glyph kind="copy" size={14} />
          {label}
        </Button>
        <span className="copy-state" role="status">
          {state === 'copied' ? 'Copied' : state === 'selected' ? 'Selected. Press Ctrl+C or Cmd+C to copy.' : ''}
        </span>
      </div>
    </div>
  )
}

/** A small "copy link" control for a page fragment. Falls back to a selectable field. */
export function CopyLink({ id, label, fragment }: { id: string; label: string; fragment: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'show'>('idle')
  const full = () => {
    try {
      return window.location.href.split('#')[0] + fragment
    } catch {
      return fragment
    }
  }
  const copy = () => {
    const text = full()
    try {
      const p = navigator.clipboard?.writeText(text)
      if (!p) return setState('show')
      p.then(
        () => setState('copied'),
        () => setState('show')
      )
    } catch {
      setState('show')
    }
  }
  return (
    <span className="copy-link">
      <button type="button" id={id} className="link-button" onClick={copy}>
        <Glyph kind="copy" size={12} />
        {label}
      </button>
      <span className="muted small" role="status">
        {state === 'copied' ? 'Copied' : ''}
      </span>
      {state === 'show' ? (
        <input
          id={`${id}-text`}
          className="input is-mono copy-link-text"
          readOnly
          value={full()}
          aria-label={label}
          onFocus={(e) => e.currentTarget.select()}
          autoFocus
        />
      ) : null}
    </span>
  )
}

export function Stars({ count, max = 3, label }: { count: number; max?: number; label?: string }) {
  return (
    <span className="stars" role="img" aria-label={label ?? `${count} of ${max} stars`}>
      {Array.from({ length: max }, (_, i) => (
        <Glyph key={i} kind={i < count ? 'star' : 'star-empty'} />
      ))}
    </span>
  )
}
