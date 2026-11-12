import React, { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { ToastProvider } from './context/ToastContext'
import Layout from './components/Layout'
import Landing from './pages/Landing'
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
import LegacyReclaim from './pages/LegacyReclaim'
import Stake from './pages/Stake'
import Directory       from './pages/Directory'
import DirectorySubmit from './pages/DirectorySubmit'
import DirectoryEntry  from './pages/DirectoryEntry'
import DirectoryMine   from './pages/DirectoryMine'
import AdminDirectory  from './pages/AdminDirectory'
import EscrowBootstrap from './pages/EscrowBootstrap'
import AdminVoting from './pages/AdminVoting'
import AdminNominations from './pages/AdminNominations'
// Funding engine (new)
import Fund        from './pages/Fund'
import Participate from './pages/Participate'   // combined stake (ALGO + Sprout) + vote
import Results     from './pages/Results'


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
            {/* Orientation landing (was Home) */}
            <Route path="/" element={<Landing />} />

            {/* Crowdfunding (the former home, now its own hub) */}
            <Route path="/campaigns" element={<Home />} />
            <Route path="/project/demo" element={<DemoProject />} />
            <Route path="/project/:appId" element={<ProjectDetail />} />
            <Route path="/create" element={<CreateProject />} />
            <Route path="/donate-setup" element={<DonationSetup />} />
            <Route path="/my-projects" element={<MyProjects />} />

            {/* Funding engine */}
            <Route path="/fund" element={<Fund />} />
            <Route path="/fund/participate" element={<Participate />} />
            <Route path="/fund/results" element={<Results />} />
            {/* Back-compat: old split routes resolve to the combined page */}
            <Route path="/fund/stake" element={<Participate />} />
            <Route path="/fund/vote" element={<Participate />} />

            {/* Directory (the engine's candidate roster; nominating happens inline here) */}
            <Route path="/directory" element={<Directory />} />
            <Route path="/directory/submit" element={<DirectorySubmit />} />
            <Route path="/directory/mine" element={<DirectoryMine />} />
            <Route path="/directory/:id/edit" element={<DirectorySubmit />} />
            <Route path="/directory/:id" element={<DirectoryEntry />} />

            {/* Standalone nominations page folded into the Directory — redirect any
                existing links so they land on the new inline experience. */}
            <Route path="/nominations" element={<Navigate to="/directory" replace />} />

            {/* Admin */}
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/directory" element={<AdminDirectory />} />
            <Route path="/admin/escrow" element={<EscrowBootstrap />} />
            <Route path="/admin/stake" element={<Stake />} />
            <Route path="/admin/voting" element={<AdminVoting />} />
            <Route path="/admin/nominations" element={<AdminNominations />} />

            {/* Static / misc */}
            <Route path="/cleanup" element={<CleanupWallet />} />
            <Route path="/faq"     element={<FAQ />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/terms"   element={<Terms />} />
            <Route path="/reclaim" element={<LegacyReclaim />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </ToastProvider>
  )
}
