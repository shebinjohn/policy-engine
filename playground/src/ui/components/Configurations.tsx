/** The rules a guard call carries: configureImmediately, requestConfiguration, applyConfiguration, invalidateRoot. */
import { useState } from 'react'
import type { RuleSpec, World } from '../../engine/types.ts'
import { plural } from '../lib/format.ts'
import { RuleEditor } from './RuleEditor.tsx'
import { RuleSpecList } from './Safe.tsx'
import { Button, Glyph } from './ui.tsx'

const HINT: Record<string, string> = {
  configureImmediately: 'Set at once, with no waiting period. Only works while no guard is installed.',
  requestConfiguration: 'Starts the waiting period for exactly these rules.',
  applyConfiguration: 'Must list a proposed change set exactly, in the same order, once its waiting period is over.',
  invalidateRoot: 'Must list a proposed change set exactly, in the same order.'
}

export function ConfigurationsEditor({
  id,
  world,
  fn,
  rules,
  onChange,
  changeSet
}: {
  id: string
  world: World
  fn: string
  rules: RuleSpec[]
  onChange: (rules: RuleSpec[]) => void
  changeSet: RuleSpec[]
}) {
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const roots = Object.values(world.roots)
  const usesRoot = fn === 'applyConfiguration' || fn === 'invalidateRoot'
  return (
    <div className="config-editor">
      <div>
        <p className="field-label">Rules in this call</p>
        {HINT[fn] ? <p className="field-hint">{HINT[fn]}</p> : null}
      </div>
      <RuleSpecList
        world={world}
        rules={rules}
        empty="No rules listed yet."
        actions={(_, i) => (
          <>
            <Button size="sm" variant="ghost" onClick={() => setEditing(i)}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onChange(rules.filter((__, j) => j !== i))}>
              Remove
            </Button>
          </>
        )}
      />
      {editing !== null ? (
        <RuleEditor
          key={`${id}-${editing}`}
          world={world}
          initial={editing === 'new' ? undefined : rules[editing]}
          idPrefix={`${id}-rule`}
          title={editing === 'new' ? 'New rule' : `Edit rule ${editing + 1}`}
          onSave={(r) => {
            onChange(editing === 'new' ? [...rules, r] : rules.map((x, j) => (j === editing ? r : x)))
            setEditing(null)
          }}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <div className="button-row">
          <Button id={`${id}-add`} size="sm" onClick={() => setEditing('new')}>
            <Glyph kind="plus" size={14} />
            Add rule
          </Button>
          {changeSet.length > 0 ? (
            <Button
              id={`${id}-copy-draft`}
              size="sm"
              variant="ghost"
              onClick={() => onChange(structuredClone(changeSet))}
            >
              Use my change set ({plural(changeSet.length, 'rule')})
            </Button>
          ) : null}
          {usesRoot
            ? roots.map((r, i) => (
                <Button
                  key={i}
                  id={`${id}-copy-root-${i}`}
                  size="sm"
                  variant="ghost"
                  onClick={() => onChange(structuredClone(r.configurations))}
                >
                  Use proposed change set {i + 1}
                </Button>
              ))
            : null}
        </div>
      )}
    </div>
  )
}
