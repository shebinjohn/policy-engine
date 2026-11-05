/**
 * Inline definitions for a small set of glossary terms (UX decision 12): the first use of each term
 * in a card gets a dotted underline and a definition on hover, focus or tap. Wrap a card in
 * <TermScope> and its texts in <Termed text="..." />. Outside a scope, text renders plain.
 */
import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { GLOSSARY } from '../lib/content.ts'

interface TermDef {
  key: string // one underline per key per card
  glossary: string // Term.term in src/content/glossary.ts
  pattern: string
}

// Longer phrases first, so "module guard" wins over "module".
const TERMS: TermDef[] = [
  { key: 'catch-all', glossary: 'Catch-All Rule', pattern: 'catch-all(?: rules?)?' },
  { key: 'waiting period', glossary: 'Delay', pattern: 'waiting periods?' },
  { key: 'change set', glossary: 'Configuration Change', pattern: 'change sets?' },
  { key: 'guard', glossary: 'Policy Guard', pattern: 'policy guards?' },
  { key: 'guard', glossary: 'Transaction Guard', pattern: 'transaction guards?' },
  { key: 'guard', glossary: 'Module Guard', pattern: 'module guards?' },
  { key: 'guard', glossary: 'Guard', pattern: 'guards?' },
  { key: 'module', glossary: 'Module', pattern: 'modules?' },
  { key: 'delegatecall', glossary: 'DELEGATECALL', pattern: 'delegatecalls?' },
  { key: 'calldata', glossary: 'Calldata', pattern: 'calldata' },
  { key: 'nonce', glossary: 'Nonce', pattern: 'nonces?' },
  { key: 'co-signer', glossary: 'Co-Signer', pattern: 'co-signers?|co-signatures?' }
]

const RE = new RegExp(TERMS.map((t) => `(?<![\\w-])(${t.pattern})(?![\\w-])`).join('|'), 'gi')

function definition(glossary: string): string | undefined {
  return GLOSSARY.find((g) => g.term.toLowerCase() === glossary.toLowerCase())?.plain
}

const ScopeContext = createContext<Map<string, string> | null>(null)

/** One card: each term is defined at most once inside it. */
export function TermScope({ children }: { children: ReactNode }) {
  const map = useRef(new Map<string, string>())
  return <ScopeContext.Provider value={map.current}>{children}</ScopeContext.Provider>
}

export function Termed({ text }: { text: string | undefined }) {
  const scope = useContext(ScopeContext)
  const id = useId()
  useEffect(
    () => () => {
      if (scope) for (const [k, owner] of scope) if (owner === id) scope.delete(k)
    },
    [scope, id]
  )
  if (!text) return null
  if (!scope) return <>{text}</>
  const parts: ReactNode[] = []
  const here = new Set<string>()
  let last = 0
  for (const m of text.matchAll(RE)) {
    const groupIndex = m.slice(1).findIndex((g) => g !== undefined)
    const def = TERMS[groupIndex]
    if (!def || here.has(def.key)) continue
    const owner = scope.get(def.key)
    if (owner && owner !== id) continue
    const plain = definition(def.glossary)
    if (!plain) continue
    scope.set(def.key, id)
    here.add(def.key)
    const at = m.index ?? 0
    if (at > last) parts.push(text.slice(last, at))
    parts.push(<TermRef key={at} label={m[0]} term={def.glossary} plain={plain} />)
    last = at + m[0].length
  }
  if (parts.length === 0) return <>{text}</>
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

function TermRef({ label, term, plain }: { label: string; term: string; plain: string }) {
  const [open, setOpen] = useState(false)
  const [shift, setShift] = useState(0)
  const pop = useRef<HTMLSpanElement>(null)
  const id = useId()
  useLayoutEffect(() => {
    if (!open || !pop.current) {
      setShift(0)
      return
    }
    const r = pop.current.getBoundingClientRect()
    const vw = document.documentElement.clientWidth
    const margin = 12
    let dx = 0
    if (r.right > vw - margin) dx = vw - margin - r.right
    if (r.left + dx < margin) dx = margin - r.left
    setShift((s) => (Math.abs(s - dx) > 0.5 ? s + dx : s))
  }, [open])
  return (
    <span className="term" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className="term-btn"
        aria-describedby={id}
        onClick={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
        }}
      >
        {label}
      </button>
      <span ref={pop} role="tooltip" id={id} className="term-pop" hidden={!open} style={shift ? { transform: `translateX(${shift}px)` } : undefined}>
        <strong>{term}.</strong> {plain}
      </span>
    </span>
  )
}
