// The component kit. Small, dependency-free primitives every screen shares.

import { useEffect, useState, type ReactNode } from 'react'
import { X, type LucideIcon } from 'lucide-react'
import { tMinus } from '@/core/dates'
import { dismissToast, useToasts } from '@/state/toast'
import { TONES, cx, useEscape, type Tone } from './kit'

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={cx('select-none font-extrabold tracking-tight text-ink', className)}>
      thing<span className="italic text-accent text-glow">GLANCE</span>
    </span>
  )
}

export function Chip({ tone = 'dim', icon: Icon, children, className }: { tone?: Tone; icon?: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <span className={cx('chip', TONES[tone].soft, className)}>
      {Icon && <Icon size={11} strokeWidth={2.2} />}
      {children}
    </span>
  )
}

// The countdown badge: T-12d before an event, T+3d after it.
export function TBadge({ days, tone, className }: { days: number; tone: Tone; className?: string }) {
  return (
    <span className={cx('num inline-flex h-6 min-w-[3.6rem] items-center justify-center rounded-md border px-1.5 text-[11px] font-semibold', TONES[tone].soft, className)}>
      {tMinus(days)}
    </span>
  )
}

// Life-left ring. value is 0..1, or null for "no dates yet" (dashed track).
export function Ring({ value, size = 44, stroke = 4, tone = 'accent', children }: { value: number | null; size?: number; stroke?: number; tone?: Tone; children?: ReactNode }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(value ?? 0))
    return () => cancelAnimationFrame(id)
  }, [value])
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      {/* overflow-visible: the glow is a filter on the arc and would otherwise be cut off square at the svg's edge. */}
      <svg width={size} height={size} className="-rotate-90 overflow-visible">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-line/10" strokeDasharray={value == null ? '2 5' : undefined} />
        {value != null && (
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
            className={TONES[tone].stroke}
            strokeDasharray={c}
            strokeDashoffset={c * (1 - Math.max(0.02, shown))}
            style={{ transition: 'stroke-dashoffset 0.9s cubic-bezier(0.2, 0.7, 0.2, 1)', filter: 'drop-shadow(0 0 4px currentColor)' }}
          />
        )}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center">{children}</span>
    </span>
  )
}

export function Segmented<T extends string>({ value, onChange, options, size = 'md' }: { value: T; onChange: (v: T) => void; options: { id: T; label: ReactNode }[]; size?: 'sm' | 'md' }) {
  return (
    <div role="tablist" className="inline-flex rounded-lg border border-line/10 bg-bg/60 p-0.5">
      {options.map((o) => (
        <button
          key={o.id} role="tab" type="button" aria-selected={value === o.id} onClick={() => onChange(o.id)}
          className={cx(
            'rounded-md font-medium transition', size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]',
            value === o.id ? 'bg-accent/15 text-accent shadow-[inset_0_0_0_1px_rgb(var(--accent)/0.3)]' : 'text-dim hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-1">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-xs leading-relaxed text-dim">{hint}</span>}
      </span>
      <button
        type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={cx('relative mt-0.5 h-6 w-10 shrink-0 rounded-full border transition', checked ? 'border-accent/50 bg-accent/80' : 'border-line/20 bg-line/10')}
      >
        <span className={cx('absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow transition-all', checked ? 'left-[19px]' : 'left-0.5')} />
      </button>
    </label>
  )
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="label mb-1.5 block">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs leading-relaxed text-faint">{hint}</span>}
    </label>
  )
}

export function Empty({ icon: Icon, title, body, action }: { icon: LucideIcon; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-line/10 bg-raised/60 text-accent"><Icon size={22} /></span>
      <p className="text-sm font-semibold text-ink">{title}</p>
      {body && <p className="mt-1 max-w-sm text-sm leading-relaxed text-dim">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

// A modal: a bottom sheet on phones, a centred dialog from sm up.
export function Sheet({ title, subtitle, onClose, children, footer, width = 'max-w-lg', className }: {
  title: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: string
  // For a sheet that should hold one height (the max-height still caps it).
  className?: string
}) {
  useEscape(onClose)
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true">
      <div className="absolute inset-0 animate-fade-in bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
      <div className={cx('panel hud relative flex max-h-[92svh] w-full animate-slide-up flex-col rounded-b-none !bg-panel sm:max-h-[86svh] sm:animate-pop sm:rounded-b-2xl', width, className)}>
        <header className="flex items-start justify-between gap-4 border-b border-line/10 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-dim">{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn -mr-1.5 -mt-1 h-8 w-8" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </header>
        <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <footer className="safe-bottom flex items-center justify-end gap-2 border-t border-line/10 px-5 py-3">{footer}</footer>}
      </div>
    </div>
  )
}

export function Toasts() {
  const toasts = useToasts()
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-70 flex flex-col items-center gap-2 px-4 lg:bottom-6">
      {toasts.map((t) => (
        <div key={t.id} className="panel pointer-events-auto flex max-w-md animate-rise items-center gap-3 !bg-raised px-4 py-3 shadow-2xl">
          <span className={cx('h-2 w-2 shrink-0 rounded-full', TONES[t.tone ?? 'accent'].solid)} />
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">{t.title}</p>
            {t.body && <p className="text-xs leading-relaxed text-dim">{t.body}</p>}
          </div>
          {t.action && (
            <button type="button" className="btn-ghost h-7 shrink-0 px-2 text-xs text-accent" onClick={() => { t.action!.run(); dismissToast(t.id) }}>{t.action.label}</button>
          )}
        </div>
      ))}
    </div>
  )
}
