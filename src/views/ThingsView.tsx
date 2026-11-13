import { useMemo, useState } from 'react'
import { ChevronDown, Package, Plus, ShieldCheck, ShieldOff } from 'lucide-react'
import type { CategoryId, Thing } from '@/core/types'
import { category } from '@/core/categories'
import { fmtDay } from '@/core/dates'
import { nextEventFor } from '@/core/horizon'
import { ownership } from '@/core/health'
import { money } from '@/core/money'
import { useData } from '@/state/data'
import { useSettings } from '@/state/settings'
import { useUI } from '@/state/ui'
import { Chip, Empty, Ring, TBadge, TONES, cx, severityTone } from '@/components/ui'
import { LifeBar, ThingAvatar, VerdictChip, verdictTone } from '@/components/parts'
import { EVENT_ICONS } from '@/components/icons'

type Sort = 'window' | 'name' | 'newest' | 'price'

function ThingCard({ thing, i }: { thing: Thing; i: number }) {
  const d = useData()
  const ui = useUI()
  const { currency } = useSettings()
  const life = d.life.get(thing.id)!
  const tone = verdictTone(life.verdict)
  const next = nextEventFor(d.events, { thingId: thing.id })
  const NextIcon = next ? EVENT_ICONS[next.type] : null
  const own = ownership(thing, d.coveragesFor(thing.id), d.subsFor(thing.id))
  const owners = d.multiUser ? thing.ownerIds.map((id) => d.userName(id)).filter(Boolean) : []
  return (
    <button
      type="button" onClick={() => ui.openThing(thing.id)} style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
      className="panel group flex animate-rise flex-col p-4 text-left transition hover:-translate-y-0.5 hover:border-accent/35 hover:shadow-[0_18px_40px_-20px_rgb(var(--accent)/0.45)]"
    >
      <div className="flex items-start gap-3">
        <ThingAvatar thing={thing} size={46} />
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="truncate text-[15px] font-semibold leading-tight text-ink">{thing.name}</p>
          <p className="mt-0.5 truncate text-xs text-dim">{[thing.brand, thing.model].filter(Boolean).join(' · ') || category(thing.category).label}</p>
        </div>
        <Ring value={life.remaining} size={46} stroke={4} tone={tone}>
          <span className={cx('num text-[11px] font-semibold', TONES[tone].text)}>{life.remaining != null ? `${Math.round(life.remaining * 100)}` : '–'}</span>
        </Ring>
      </div>

      <div className="mt-4"><LifeBar life={life} /></div>
      <div className="label mt-1.5 flex justify-between !text-[9px]">
        <span>{life.start ? fmtDay(life.start, 'MMM YYYY') : 'no date'}</span>
        <span>{life.lifeEnd ? `${life.lifeEndReason === 'support' ? 'support ends' : 'replace'} ${fmtDay(life.lifeEnd, 'MMM YYYY')}` : ''}</span>
      </div>

      <div className="mb-4 mt-3 flex flex-wrap items-center gap-1.5">
        <VerdictChip verdict={life.verdict} />
        {thing.status === 'active' && (life.covered
          ? <Chip tone="ok" icon={ShieldCheck}>until {fmtDay(life.warrantyEnd, 'MMM YYYY')}</Chip>
          : <Chip tone="dim" icon={ShieldOff}>No coverage</Chip>)}
        {owners.map((n) => <Chip key={n} tone="dim">{n}</Chip>)}
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 border-t border-line/10 pt-3 text-xs">
        {next && NextIcon
          ? <span className="flex min-w-0 items-center gap-1.5 text-dim"><NextIcon size={13} className="shrink-0 text-faint" /><span className="truncate">{next.title}</span></span>
          : <span className="text-faint">{own.perDay != null ? <><span className="num text-dim">{money(own.perDay, currency, { cents: true })}</span> a day so far</> : 'Nothing scheduled'}</span>}
        {next && <TBadge days={next.days} tone={severityTone(next.severity)} />}
      </div>
    </button>
  )
}

export function ThingsView() {
  const d = useData()
  const ui = useUI()
  const [cat, setCat] = useState<CategoryId | 'all'>('all')
  const [sort, setSort] = useState<Sort>('window')
  const [showRetired, setShowRetired] = useState(false)

  const cats = useMemo(() => {
    const counts = new Map<CategoryId, number>()
    for (const t of d.activeThings) counts.set(t.category, (counts.get(t.category) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [d.activeThings])

  const list = useMemo(() => {
    const l = d.activeThings.filter((t) => cat === 'all' || t.category === cat)
    const by: Record<Sort, (a: Thing, b: Thing) => number> = {
      window: (a, b) => (d.life.get(a.id)?.daysLeft ?? 1e9) - (d.life.get(b.id)?.daysLeft ?? 1e9),
      name: (a, b) => a.name.localeCompare(b.name),
      newest: (a, b) => (b.purchaseDate ?? '').localeCompare(a.purchaseDate ?? ''),
      price: (a, b) => (b.price ?? 0) - (a.price ?? 0),
    }
    return [...l].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || by[sort](a, b))
  }, [d.activeThings, d.life, cat, sort])

  if (d.ready && d.visibleThings.length === 0) {
    return (
      <div className="panel hud mx-auto mt-10 max-w-xl">
        <Empty icon={Package} title="No things yet" body="Computers, phones, tablets, anything with a warranty, a plan or a shelf life."
          action={<button type="button" className="btn-primary" onClick={() => ui.open({ type: 'thing' })}><Plus size={16} /> Add a thing</button>} />
      </div>
    )
  }

  return (
    <div className="space-y-4 lg:space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Things</h1>
          <p className="text-sm text-dim">{d.activeThings.length} in service{d.retiredThings.length ? ` · ${d.retiredThings.length} retired` : ''}. The ring is how much of its window is left.</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="input h-9 w-auto pr-8 text-[13px]" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
            <option value="window">Closing soonest</option>
            <option value="name">Name</option>
            <option value="newest">Newest</option>
            <option value="price">Price</option>
          </select>
        </div>
      </div>

      {cats.length > 1 && (
        <div className="scrollbar-none -mx-4 flex gap-1.5 overflow-x-auto px-4 lg:mx-0 lg:flex-wrap lg:px-0">
          {[['all', d.activeThings.length] as const, ...cats].map(([id, n]) => (
            <button key={id} type="button" onClick={() => setCat(id)}
              className={cx('inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition',
                cat === id ? 'border-accent/40 bg-accent/15 text-accent' : 'border-line/10 bg-raised/50 text-dim hover:text-ink')}>
              {id === 'all' ? 'All' : category(id).plural}<span className="num text-[11px] opacity-70">{n}</span>
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:gap-4 xl:grid-cols-3 2xl:grid-cols-4">
        {list.map((t, i) => <ThingCard key={t.id} thing={t} i={i} />)}
        <button type="button" onClick={() => ui.open({ type: 'thing', category: cat === 'all' ? undefined : cat })}
          className="flex min-h-[150px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line/20 text-sm text-dim transition hover:border-accent/50 hover:bg-accent/5 hover:text-accent">
          <Plus size={20} /> Add a thing
        </button>
      </div>

      {d.retiredThings.length > 0 && (
        <section>
          <button type="button" className="label flex items-center gap-1.5 py-2 hover:text-ink" onClick={() => setShowRetired((v) => !v)}>
            <ChevronDown size={12} className={cx('transition', !showRetired && '-rotate-90')} /> Retired · {d.retiredThings.length}
          </button>
          {showRetired && (
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:gap-4 xl:grid-cols-3 2xl:grid-cols-4">
              {d.retiredThings.map((t, i) => <ThingCard key={t.id} thing={t} i={i} />)}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
