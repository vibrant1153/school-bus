import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './lib/AuthContext.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import Login from './pages/Login.jsx'
import ParentHome from './pages/ParentHome.jsx'
import ParentMap from './pages/ParentMap.jsx'
import Alerts from './pages/Alerts.jsx'
import Driver from './pages/Driver.jsx'
import OwnerDashboard from './pages/OwnerDashboard.jsx'
import ManagerLayout from './manager/ManagerLayout.jsx'
import Dashboard from './manager/Dashboard.jsx'
import Students from './manager/Students.jsx'
import BusesRoutes from './manager/BusesRoutes.jsx'
import Settings from './manager/Settings.jsx'
import AuditLog from './manager/AuditLog.jsx'

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public Login Route */}
        <Route path="/" element={<Login />} />

        {/* Platform Owner Routes */}
        <Route
          path="/owner"
          element={
            <ProtectedRoute allowedRoles={['owner']}>
              <OwnerDashboard />
            </ProtectedRoute>
          }
        />

        {/* Parent Routes */}
        <Route
          path="/home"
          element={
            <ProtectedRoute allowedRoles={['parent']}>
              <ParentHome />
            </ProtectedRoute>
          }
        />
        <Route
          path="/map"
          element={
            <ProtectedRoute allowedRoles={['parent']}>
              <ParentMap />
            </ProtectedRoute>
          }
        />
        <Route
          path="/alerts"
          element={
            <ProtectedRoute allowedRoles={['parent']}>
              <Alerts />
            </ProtectedRoute>
          }
        />

        {/* Driver Routes */}
        <Route
          path="/driver"
          element={
            <ProtectedRoute allowedRoles={['driver']}>
              <Driver />
            </ProtectedRoute>
          }
        />

        {/* Manager Routes */}
        <Route
          path="/manager"
          element={
            <ProtectedRoute allowedRoles={['manager']}>
              <ManagerLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="students" element={<Students />} />
          <Route path="buses" element={<BusesRoutes />} />
          <Route path="settings" element={<Settings />} />
          <Route path="audit" element={<AuditLog />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
