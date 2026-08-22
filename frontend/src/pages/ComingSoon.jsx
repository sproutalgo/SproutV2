import React from 'react'
import SproutLogo from '../components/SproutLogo'

/**
 * Launching-soon holding page. Shown when VITE_MAINTENANCE === 'true' unless the
 * visitor has the preview bypass (see App.jsx). Uses the app's own brand tokens
 * so it reads as Sprout, not a generic maintenance screen.
 */
export default function ComingSoon() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        color: 'var(--text)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '24px',
        fontFamily: 'var(--font-ui)',
      }}
    >
      <div style={{ marginBottom: 28, transform: 'scale(1.4)' }}>
        <SproutLogo />
      </div>

      <h1
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'clamp(2.2rem, 6vw, 3.4rem)',
          fontWeight: 400,
          lineHeight: 1.1,
          margin: '0 0 16px',
          color: 'var(--text)',
        }}
      >
        Something is growing here.
      </h1>

      <p
        style={{
          fontSize: '1.05rem',
          color: 'var(--text-muted)',
          maxWidth: 460,
          lineHeight: 1.6,
          margin: '0 0 32px',
        }}
      >
        Sprout is grassroots crowdfunding on Algorand — non-custodial, transparent,
        and built for the community. We're putting the finishing touches on our
        mainnet launch.
      </p>

      <a
        href="https://x.com/sproutalgo"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 22px',
          borderRadius: '10px',
          background: 'var(--accent)',
          color: 'var(--on-accent)',
          fontWeight: 600,
          fontSize: '0.95rem',
          textDecoration: 'none',
        }}
      >
        Follow @sproutalgo for launch
      </a>

      <div
        style={{
          marginTop: 40,
          fontSize: '0.8rem',
          color: 'var(--text-faint)',
          fontFamily: 'var(--font-mono)',
          letterSpacing: '0.04em',
        }}
      >
        Launching soon
      </div>
    </div>
  )
}
