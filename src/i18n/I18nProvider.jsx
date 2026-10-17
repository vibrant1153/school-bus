import { useCallback, useEffect, useMemo, useState } from 'react'
import { I18nContext } from './i18nContext.js'
import { translations } from './translations.js'

const LANG_KEY = 'schoolbus.lang'

function initialLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY)
    if (saved === 'en' || saved === 'am') return saved
  } catch {
    // Storage can be blocked; fall back to the browser language.
  }
  return navigator.language?.toLowerCase().startsWith('am') ? 'am' : 'en'
}

export default function I18nProvider({ children }) {
  const [lang, setLangState] = useState(initialLang)

  // Tells the browser and screen readers which language the page is in.
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const setLang = useCallback((next) => {
    setLangState(next)
    try {
      localStorage.setItem(LANG_KEY, next)
    } catch {
      // The choice then lasts only for this visit.
    }
  }, [])

  const t = useCallback(
    (key, vars = {}) => {
      const text = translations[lang][key] ?? translations.en[key] ?? key
      return text.replace(/\{(\w+)\}/g, (_, name) => (vars[name] ?? `{${name}}`))
    },
    [lang],
  )

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
