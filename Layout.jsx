import React, { useState, useRef, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useWallet } from '@txnlab/use-wallet-react'
import ConnectWallet from './ConnectWallet'
import { Brand, Icon, shortAddr } from './UI'
import { SproutLogo } from './SproutLogo'
import { ADMIN_ADDRESS } from '../utils/algorand'

export default function Layout({ children }) {
  const [walletOpen, setWalletOpen]   = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [mobileOpen, setMobileOpen]   = useState(false)
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('sprout-theme') || 'dark' } catch { return 'dark' }
  })
  const dropdownRef = useRef(null)
  const { activeAddress, wallets } = useWallet()
  const location = useLocation()
  const isAdmin = activeAddress === ADMIN_ADDRESS

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { localStorage.setItem('sprout-theme', theme) } catch { /* non-critical */ }
  }, [theme])

  useEffect(() => { setMobileOpen(false) }, [location.pathname])

  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setDropdownOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function handleDisconnect() {
    if (wallets) {
      const active = wallets.find(w => w.isActive)
      if (active) await active.disconnect()
      else { localStorage.removeItem('@txnlab/use-wallet:v3'); window.location.reload() }
    }
    setDropdownOpen(false)
  }

  const nav = [
    { label: 'Explore',   to: '/' },
    { label: 'My garden', to: '/my-projects' },
    { label: 'FAQ',       to: '/faq' },
    { label: 'Cleanup',   to: '/cleanup' },
    ...(isAdmin ? [{ label: 'Admin', to: '/admin', danger: true, icon: <Icon.shield style={{ width: 13, height: 13 }} /> }] : []),
  ]

  return (
    <div className="app" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <header className="nav">
        <div className="nav-inner">
          <Link to="/" aria-label="Sprout — home" style={{ textDecoration: 'none' }}>
            <SproutLogo height={22} color={theme === 'dark' ? '#EAF2EC' : '#11271B'} />
          </Link>

          <nav className="nav-links">
            {nav.map(n => (
              <Link
                key={n.to}
                to={n.to}
                className={[
                  'nav-link',
                  location.pathname === n.to ? 'active' : '',
                  n.danger ? 'danger' : '',
                ].filter(Boolean).join(' ')}
              >
                {n.icon && n.icon} {n.label}
              </Link>
            ))}
          </nav>

          <div className="nav-spacer" />

          <Link to="/create" className="nav-cta">Launch a project</Link>

          <button
            className="theme-toggle"
            onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
          >
            {theme === 'dark' ? <Icon.sun /> : <Icon.moon />}
          </button>

          <div style={{ position: 'relative' }} ref={dropdownRef}>
            {activeAddress ? (
              <>
                <button className="wallet" onClick={() => setDropdownOpen(v => !v)}>
                  <span className="dot" />
                  <span className="addr">{shortAddr(activeAddress)}</span>
                  <span className={`caret${dropdownOpen ? ' open' : ''}`}>▾</span>
                </button>
                {dropdownOpen && (
                  <div className="wallet-dropdown">
                    <div className="wallet-dropdown-header">
                      <div className="wallet-dropdown-label">Connected</div>
                      <div className="wallet-dropdown-addr">{shortAddr(activeAddress)}</div>
                    </div>
                    <hr className="divider" />
                    <button className="wallet-dropdown-item" onClick={() => { navigator.clipboard.writeText(activeAddress); setDropdownOpen(false) }}>
                      <Icon.copy style={{ width: 15, height: 15 }} /> Copy address
                    </button>
                    <button className="wallet-dropdown-item danger" onClick={handleDisconnect}>
                      <Icon.refund style={{ width: 15, height: 15 }} /> Disconnect
                    </button>
                  </div>
                )}
              </>
            ) : (
              <button className="btn btn-ghost btn-sm" onClick={() => setWalletOpen(true)}>
                Connect wallet
              </button>
            )}
          </div>

          <button className="hamburger" onClick={() => setMobileOpen(v => !v)} aria-label="Menu">
            <span className={`ham-bar${mobileOpen ? ' open' : ''}`} />
            <span className={`ham-bar${mobileOpen ? ' open' : ''}`} />
            <span className={`ham-bar${mobileOpen ? ' open' : ''}`} />
          </button>
        </div>

        {mobileOpen && (
          <div className="mobile-nav">
            {nav.map(n => (
              <Link key={n.to} to={n.to} className={['mobile-nav-link', location.pathname === n.to ? 'active' : '', n.danger ? 'danger' : ''].filter(Boolean).join(' ')}>
                {n.label}
              </Link>
            ))}
            <Link to="/create" className="mobile-nav-link" style={{ color: 'var(--accent)', fontWeight: 700 }}>Launch a project</Link>
            <button
              className="mobile-nav-link"
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }}
              onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
            >
              {theme === 'dark' ? <Icon.sun style={{ width: 15, height: 15 }} /> : <Icon.moon style={{ width: 15, height: 15 }} />}
              {theme === 'dark' ? 'Light theme' : 'Dark theme'}
            </button>
            {activeAddress ? (
              <>
                <div className="mobile-nav-link" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success)', flexShrink: 0 }} /> {shortAddr(activeAddress)}
                </div>
                <button
                  className="mobile-nav-link"
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }}
                  onClick={() => { navigator.clipboard.writeText(activeAddress); setMobileOpen(false) }}
                >
                  <Icon.copy style={{ width: 15, height: 15 }} /> Copy address
                </button>
                <button
                  className="mobile-nav-link danger"
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }}
                  onClick={() => { handleDisconnect(); setMobileOpen(false) }}
                >
                  <Icon.refund style={{ width: 15, height: 15 }} /> Disconnect
                </button>
              </>
            ) : (
              <button className="btn btn-primary btn-block" style={{ marginTop: 8 }} onClick={() => { setMobileOpen(false); setWalletOpen(true) }}>
                Connect wallet
              </button>
            )}
          </div>
        )}
      </header>

      <main className="main-content" style={{ flex: 1 }}>
        {children}
      </main>

      <footer className="footer">
        <div className="footer-inner wrap">
          <SproutLogo height={18} color={theme === 'dark' ? '#EAF2EC' : '#11271B'} />
          <span>Permissionless crowdfunding on Algorand Mainnet</span>
          <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
            <Link to="/privacy" style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Privacy Policy</Link>
            <Link to="/terms"   style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Terms &amp; Conditions</Link>
            <a href="https://x.com/SproutAlgo" target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--text-muted)' }}>
              <Icon.x style={{ width: 13, height: 13 }} /> X
            </a>
            <a href="https://discord.gg/5XPQhK7Kw" target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--text-muted)' }}>
              <Icon.discord style={{ width: 14, height: 14 }} /> Discord
            </a>
          </div>
        </div>
      </footer>

      <ConnectWallet openModal={walletOpen} closeModal={() => setWalletOpen(false)} />
    </div>
  )
}
