import { Link, useNavigate } from 'react-router-dom'
import LanguageSwitch from '../i18n/LanguageSwitch.jsx'
import { useI18n } from '../i18n/useI18n.js'

export default function Login() {
  const navigate = useNavigate()
  const { t } = useI18n()

  // PROTOTYPE ONLY: there is no real sign-in yet (that comes with the
  // database and authentication step). This just opens the sample parent screen.
  function handleSubmit(event) {
    event.preventDefault()
    navigate('/home')
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-8 p-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-amber">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="3" y="5" width="18" height="12" rx="2" />
              <path d="M3 11h18" />
              <circle cx="8" cy="19" r="1.5" />
              <circle cx="16" cy="19" r="1.5" />
            </svg>
          </div>
          <span className="text-lg font-bold">SchoolBus Connect</span>
        </div>
        <LanguageSwitch />
      </header>

      <section className="mt-10 flex flex-col gap-2">
        <h1 className="text-3xl font-bold">{t('login.title')}</h1>
        <p className="text-base leading-snug text-muted">{t('login.subtitle')}</p>
      </section>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="identifier" className="text-[15px] font-semibold">
            {t('login.identifier')}
          </label>
          <input
            id="identifier"
            name="identifier"
            type="text"
            autoComplete="username"
            placeholder="name@example.com / 09xxxxxxxx"
            className="min-h-13 rounded-xl border border-field bg-white px-3.5 text-base"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-[15px] font-semibold">
            {t('login.password')}
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder={t('login.passwordPlaceholder')}
            className="min-h-13 rounded-xl border border-field bg-white px-3.5 text-base"
          />
        </div>
        <button type="submit" className="min-h-13.5 rounded-xl bg-amber text-[17px] font-bold text-ink">
          {t('login.submit')}
        </button>
        <p className="text-sm leading-relaxed text-muted">{t('login.forgot')}</p>
      </form>

      <p className="mt-auto text-[13px] leading-relaxed text-muted">{t('login.privacy')}</p>
      <p className="text-[13px] font-semibold text-muted">Prototype: no real sign-in yet.</p>
      <Link to="/driver" className="text-sm text-muted underline">
        Open the driver screen (prototype)
      </Link>
      <Link to="/manager" className="text-sm text-muted underline">
        Open the manager screens (prototype)
      </Link>
    </main>
  )
}
