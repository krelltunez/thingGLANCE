import { ArrowDownToLine, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useUpdateNotice } from '@/state/useUpdateNotice'

// A small card in the corner when a newer desktop release can be downloaded.
// Download opens the release page in the browser: there is no auto-update.
export function UpdateNotice() {
  const { t } = useTranslation()
  const { update, dismiss } = useUpdateNotice()
  if (!update) return null
  return (
    <div role="status" className="fixed bottom-4 right-4 z-[70] flex max-w-xs items-center gap-3 rounded-xl border border-line/15 bg-panel py-2.5 pl-4 pr-2 shadow-lg">
      <ArrowDownToLine size={16} className="shrink-0 text-accent" />
      <p className="min-w-0 flex-1 text-sm text-ink">{t('update.available', { version: update.version })}</p>
      <button type="button" className="btn-primary shrink-0 !px-3 !py-1.5 !text-xs" onClick={() => { window.open(update.url, '_blank'); dismiss() }}>{t('update.download')}</button>
      <button type="button" className="shrink-0 rounded-lg p-1.5 text-faint hover:text-ink" aria-label={t('update.dismiss')} onClick={dismiss}><X size={14} /></button>
    </div>
  )
}
