import { useTranslation } from 'react-i18next'
import { setLanguage, storedLanguage } from '@/i18n'
import { languages, nativeLanguageName } from '@/locales'

// The one language picker. Its first option follows the device; the rest are
// the languages on disk, each named in its own language. The choice is kept
// on this device only: it is a display preference, not data.
export function LanguagePicker({ id, className }: { id?: string; className?: string }) {
  const { t, i18n } = useTranslation()
  // Read on every render: a change re-renders through the hook above.
  const chosen = storedLanguage()
  return (
    <select id={id} className={className} value={chosen ?? ''} data-language={i18n.language} onChange={(e) => void setLanguage(e.target.value || null)}>
      <option value="">{t('language.device')}</option>
      {languages.map((lng) => <option key={lng} value={lng}>{nativeLanguageName(lng)}</option>)}
    </select>
  )
}
