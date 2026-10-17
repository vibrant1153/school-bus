import { useContext } from 'react'
import { I18nContext } from './i18nContext.js'

// Returns { lang, setLang, t }. Use t('key', { name: value }) to get text.
export function useI18n() {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>')
  return value
}
