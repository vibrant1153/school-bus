import { useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from './supabase.js'
import { AuthContext } from './authContext.js'
export function normalizeEthiopianPhone(input) {
  if (!input) return null
  let digits = input.replace(/\D/g, '')
  if (digits.startsWith('09') || digits.startsWith('07')) {
    digits = '251' + digits.slice(1)
  } else if ((digits.startsWith('9') || digits.startsWith('7')) && digits.length === 9) {
    digits = '251' + digits
  }
  if (digits.startsWith('251') && digits.length === 12) {
    return `+${digits}`
  }
  return input.trim()
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [role, setRole] = useState(null)
  const [loading, setLoading] = useState(() => Boolean(isSupabaseConfigured))
  const [authError, setAuthError] = useState(null)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      return
    }

    // 1. Fetch initial session
    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      setSession(initialSession)
      setUser(initialSession?.user ?? null)
      if (initialSession?.user) {
        fetchProfile(initialSession.user.id)
      } else {
        setLoading(false)
      }
    })

    // 2. Subscribe to auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, currentSession) => {
      setSession(currentSession)
      setUser(currentSession?.user ?? null)
      if (currentSession?.user) {
        await fetchProfile(currentSession.user.id)
      } else {
        setProfile(null)
        setRole(null)
        setLoading(false)
      }
    })

    return () => {
      subscription?.unsubscribe()
    }
  }, [])

  async function fetchProfile(userId) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, school_id, role, full_name, phone, language_pref, is_active')
        .eq('id', userId)
        .single()

      if (error) {
        console.error('Failed to load profile:', error.message)
        setAuthError('Profile not found. Contact administrator.')
        setProfile(null)
        setRole(null)
      } else if (!data.is_active) {
        // Enforce active lifecycle invariant: deactivated profiles cannot maintain an active session
        await supabase.auth.signOut()
        setAuthError('Your account has been deactivated. Please contact your school administrator.')
        setProfile(null)
        setRole(null)
      } else {
        setProfile(data)
        setRole(data.role)
        setAuthError(null)
      }
    } catch (err) {
      console.error('Error fetching profile:', err)
      setAuthError('Network error retrieving profile.')
    } finally {
      setLoading(false)
    }
  }


  async function signIn(identifier, password) {
    setAuthError(null)
    setLoading(true)

    // Normalize phone input to +251... format before building login identifier
    let email = identifier.trim()
    if (!email.includes('@')) {
      const normalizedPhone = normalizeEthiopianPhone(email)
      if (normalizedPhone && normalizedPhone.startsWith('+251')) {
        email = `user_${normalizedPhone.replace('+', '')}@schoolbus.local`
      }
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setLoading(false)
      setAuthError(error.message)
      return { success: false, error: error.message }
    }

    if (data.user) {
      await fetchProfile(data.user.id)
    }

    return { success: true, user: data.user }
  }

  async function signOut() {
    setLoading(true)
    await supabase.auth.signOut()
    setUser(null)
    setSession(null)
    setProfile(null)
    setRole(null)
    setAuthError(null)
    setLoading(false)
  }

  async function updatePassword(newPassword) {
    try {
      const currentSession = session || (await supabase.auth.getSession()).data.session
      if (!currentSession?.access_token) {
        return { success: false, error: 'Not authenticated' }
      }

      const { data, error } = await supabase.functions.invoke('change-password', {
        body: { new_password: newPassword },
      })

      if (error) {
        return { success: false, error: error.message || 'Failed to update password' }
      }
      if (!data?.success) {
        return { success: false, error: data?.error || 'Failed to update password' }
      }

      const { data: refreshed } = await supabase.auth.getUser()
      if (refreshed?.user) {
        setUser(refreshed.user)
      }
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }

  function signInDemo(demoRole) {
    const demoUser = {
      id: '00000000-0000-0000-0000-000000000001',
      email: `${demoRole}@demo.local`,
      user_metadata: { role: demoRole },
    }
    const demoProfile = {
      id: demoUser.id,
      school_id: '00000000-0000-0000-0000-000000000001',
      role: demoRole,
      full_name: `Demo ${demoRole.charAt(0).toUpperCase() + demoRole.slice(1)}`,
      is_active: true,
      language_pref: 'en',
    }
    setUser(demoUser)
    setProfile(demoProfile)
    setRole(demoRole)
    setAuthError(null)
  }

  const value = {
    session,
    user,
    profile,
    role,
    loading,
    authError,
    signIn,
    signInDemo,
    signOut,
    updatePassword,
    refreshProfile: () => user && fetchProfile(user.id),
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}
