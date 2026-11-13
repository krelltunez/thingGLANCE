// The household part of a form: whose it is, who deals with it, who can see
// it. Shared by the thing form and the plan form so the two cannot drift.

import type { ReactNode } from 'react'
import { useData } from '@/state/data'
import { Field, Toggle } from './ui'
import { cx, type WhoDraft } from './kit'

const chip = (on: boolean) =>
  cx('h-8 rounded-full border px-3 text-[13px] font-medium transition', on ? 'border-accent/40 bg-accent/15 text-accent' : 'border-line/10 bg-bg/40 text-dim hover:text-ink')

// One of the household's members, or the household itself ('').
export function MemberPicker({ label, value, onChange, hint }: { label: string; value: string; onChange: (id: string) => void; hint?: ReactNode }) {
  const d = useData()
  return (
    <div>
      <span className="label mb-1.5 block">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" aria-pressed={value === ''} className={chip(value === '')} onClick={() => onChange('')}>Household</button>
        {d.members.map((m) => (
          <button key={m.id} type="button" aria-pressed={value === m.id} className={chip(value === m.id)} onClick={() => onChange(m.id)}>{m.name}</button>
        ))}
      </div>
      {hint && <p className="mt-1.5 text-xs text-faint">{hint}</p>}
    </div>
  )
}

// Any number of members.
export function MembersPicker({ label, value, onChange, hint }: { label: string; value: string[]; onChange: (ids: string[]) => void; hint?: ReactNode }) {
  const d = useData()
  return (
    <div>
      <span className="label mb-1.5 block">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {d.members.map((m) => {
          const on = value.includes(m.id)
          return <button key={m.id} type="button" aria-pressed={on} className={chip(on)} onClick={() => onChange(on ? value.filter((x) => x !== m.id) : [...value, m.id])}>{m.name}</button>
        })}
      </div>
      {hint && <p className="mt-1.5 text-xs text-faint">{hint}</p>}
    </div>
  )
}

// `holderLabel` is the question the first picker asks: a thing has an owner, a
// plan has a payer. Whoever that is, is who a private item stays visible to.
export function HouseholdFields({ value, onChange, holderLabel, holderHint, noun }: {
  value: WhoDraft
  onChange: (next: WhoDraft) => void
  holderLabel: string
  holderHint?: ReactNode
  noun: 'thing' | 'plan'
}) {
  const d = useData()
  if (!d.multiUser || d.members.length === 0) return null
  const users = d.members.filter((m) => d.userIds.has(m.id))
  const holderIsUser = !!value.holder && d.userIds.has(value.holder)
  // Someone who was responsible and has since lost their last device stays in
  // the list, marked, so saving the form does not silently reassign.
  const stale = value.responsible && !d.userIds.has(value.responsible) ? d.members.find((m) => m.id === value.responsible) : undefined

  return (
    <div className="space-y-4">
      <MemberPicker
        label={holderLabel} value={value.holder} hint={holderHint}
        // Private needs a user to be private to.
        onChange={(holder) => onChange({ ...value, holder, isPrivate: value.isPrivate && d.userIds.has(holder) })}
      />
      {(users.length > 0 || stale) && (
        <Field label="Who deals with it?" hint="The person asked about its dates. Only members who use the app can be picked.">
          <select className="input" value={value.responsible} onChange={(e) => onChange({ ...value, responsible: e.target.value })}>
            <option value="">Anyone</option>
            {users.map((m) => <option key={m.id} value={m.id}>{m.name}{m.id === d.meId ? ' (you)' : ''}</option>)}
            {stale && <option value={stale.id}>{stale.name} (no device)</option>}
          </select>
        </Field>
      )}
      {holderIsUser && (
        <div className="rounded-xl border border-line/10 bg-bg/40 px-3 py-2">
          <Toggle
            checked={value.isPrivate} onChange={(isPrivate) => onChange({ ...value, isPrivate })}
            label="Private"
            hint={`Only shows on ${d.memberName(value.holder) ?? 'their'}${value.holder === d.meId ? ' (your)' : ''} devices. This hides the ${noun} from the rest of the household; it is not separately encrypted.`}
          />
        </div>
      )}
    </div>
  )
}
