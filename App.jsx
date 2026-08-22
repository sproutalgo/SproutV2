import React, { useEffect } from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { ToastProvider } from './context/ToastContext'
import Layout from './components/Layout'
import Home from './pages/Home'
import ProjectDetail from './pages/ProjectDetail'
import CreateProject from './pages/CreateProject'
import MyProjects from './pages/MyProjects'
import AdminDashboard from './pages/AdminDashboard'
import CleanupWallet from './pages/CleanupWallet'
import FAQ          from './pages/FAQ'
import PrivacyPolicy from './pages/PrivacyPolicy'
import Terms         from './pages/Terms'
import DemoProject   from './pages/DemoProject'
import DonationSetup from './pages/DonationSetup'
import ComingSoon    from './pages/ComingSoon'

/**
 * Maintenance gate. When VITE_MAINTENANCE === 'true' the public sees ComingSoon.
 * Bypass: visit any URL with ?preview=<VITE_PREVIEW_KEY> once; it's remembered
 * in sessionStorage so you can browse the live site normally afterward.
 * Note: this is a soft gate (client-side) — fine for holding the public off
 * before launch, not a security boundary.
 */
function useMaintenanceGate() {
  const maintenance = import.meta.env.VITE_MAINTENANCE === 'true'
  if (!maintenance) return false

  const previewKey = import.meta.env.VITE_PREVIEW_KEY || 'preview'
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('preview') === previewKey) {
      sessionStorage.setItem('sprout_preview', '1')
    }
    if (sessionStorage.getItem('sprout_preview') === '1') return false
  } catch {
    // sessionStorage unavailable — fall through to showing the gate
  }
  return true
}

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pathname])
  return null
}

export default function App() {
  if (useMaintenanceGate()) {
    return <ComingSoon />
  }

  return (
    <ToastProvider>
      <BrowserRouter>
        <ScrollToTop />
        <Layout>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/project/demo" element={<DemoProject />} />
            <Route path="/project/:appId" element={<ProjectDetail />} />
            <Route path="/create" element={<CreateProject />} />
            <Route path="/donate-setup" element={<DonationSetup />} />
            <Route path="/my-projects" element={<MyProjects />} />
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/cleanup" element={<CleanupWallet />} />
            <Route path="/faq"     element={<FAQ />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/terms"   element={<Terms />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </ToastProvider>
  )
}
