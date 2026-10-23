import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/useAuth.js'

export default function ProtectedRoute({ children, allowedRoles }) {
  const { user, role, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-amber border-t-transparent" />
          <p className="text-sm font-medium text-muted">Checking authentication...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    // Redirect unauthenticated users to login with return path
    return <Navigate to="/" state={{ from: location }} replace />
  }

  if (allowedRoles && (!role || !allowedRoles.includes(role))) {
    // Role not authorized for this route: redirect to user's home screen
    if (role === 'owner') return <Navigate to="/owner" replace />
    if (role === 'manager') return <Navigate to="/manager" replace />
    if (role === 'driver') return <Navigate to="/driver" replace />
    return <Navigate to="/home" replace />
  }

  return children
}
