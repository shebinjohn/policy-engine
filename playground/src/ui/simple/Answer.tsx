/** The answer to "Will this pass?": stamp, one reason, the rule used, the mini path, and every step on request. */
import { useState } from 'react'
import type { SimResult, TxSpec, World } from '../../engine/types.ts'
import { simpleReason } from '../lib/simpleReason.ts'
import { ResultView } from '../components/Result.tsx'
import { MiniPath, Rulebook, Stamp, litOf } from './Pieces.tsx'

export function Answer({
  result,
  tx,
  world,
  compact = false,
  animate = false,
  id,
  reason
}: {
  result: SimResult
  tx: TxSpec
  /** The world the transaction ran on. */
  world: World
  /** Stamp and reason only. */
  compact?: boolean
  animate?: boolean
  id: string
  /** An authored sentence to show instead of the generated one. */
  reason?: string
}) {
  const [open, setOpen] = useState(false)
  const lit = litOf(result, tx)
  const used = lit.access || lit.noneOp
  return (
    <div className={`answer${animate ? ' is-build' : ''}`} id={id}>
      <div className="answer-verdict" tabIndex={-1} id={`${id}-verdict`}>
        <Stamp ok={result.ok} />
        <p className="answer-reason">{reason ?? simpleReason(result, tx, world)}</p>
      </div>
      {compact ? null : (
        <>
          <div className="answer-rule">
            <p className="answer-label">Rule used</p>
            {used ? (
              <Rulebook world={world} lit={lit} only id={`${id}-rule`} />
            ) : (
              <p className="muted">{result.trace.some((e) => e.depth === 0 && e.id === 'safe.noGuard') ? 'None. No guard checked it.' : 'None. It was stopped before the rulebook.'}</p>
            )}
          </div>
          <MiniPath result={result} world={world} animate={animate} />
          <div>
            <button type="button" className="link-button" id={`${id}-steps`} aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? 'Hide every step' : 'Show every step'}
            </button>
          </div>
          {open ? (
            <div className="answer-steps">
              <ResultView result={result} tx={tx} world={world} showSummary={false} edges={false} showVerdict={false} headingLevel={4} />
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
