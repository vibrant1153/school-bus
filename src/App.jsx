import { Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login.jsx'
import ParentHome from './pages/ParentHome.jsx'
import ParentMap from './pages/ParentMap.jsx'
import Alerts from './pages/Alerts.jsx'
import Driver from './pages/Driver.jsx'
import ManagerLayout from './manager/ManagerLayout.jsx'
import Dashboard from './manager/Dashboard.jsx'
import Students from './manager/Students.jsx'
import BusesRoutes from './manager/BusesRoutes.jsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/home" element={<ParentHome />} />
      <Route path="/map" element={<ParentMap />} />
      <Route path="/alerts" element={<Alerts />} />
      <Route path="/driver" element={<Driver />} />
      <Route path="/manager" element={<ManagerLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="students" element={<Students />} />
        <Route path="buses" element={<BusesRoutes />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
