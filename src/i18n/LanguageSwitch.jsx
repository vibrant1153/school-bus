import { useI18n } from './useI18n.js'

// dark: use on dark screens (the driver screen).
export default function LanguageSwitch({ dark = false }) {
  const { lang, setLang } = useI18n()
  const base = 'min-h-11 px-3 text-sm '
  const on = dark ? 'bg-amber font-semibold text-ink' : 'bg-ink font-semibold text-white'
  const off = dark ? 'bg-night-card text-white' : 'bg-white text-ink'
  return (
    <div role="group" aria-label="Language" className={'flex overflow-hidden rounded-[10px] border ' + (dark ? 'border-night-line' : 'border-line')}>
      <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')} className={base + 'min-w-12 ' + (lang === 'en' ? on : off)}>
        EN
      </button>
      <button type="button" aria-pressed={lang === 'am'} onClick={() => setLang('am')} lang="am" className={base + 'min-w-16 ' + (lang === 'am' ? on : off)}>
        አማርኛ
      </button>
    </div>
  )
}
