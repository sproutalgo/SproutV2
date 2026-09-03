import React from 'react'
import { Link } from 'react-router-dom'
import { Icon } from './UI'

// Bump this key if you ever want the popup to auto-show again to everyone.
export const CHALLENGE_DISMISS_KEY = 'sprout-builder-challenge-2026'

// Controlled component: Home owns `open` and passes `onClose`. This lets both the
// auto-show-on-load logic and a "reopen" button live in Home and share one state.
export default function ChallengePopup({ open, onClose }) {
  if (!open) return null

  return (
    <div
      className="modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Sprout Builder Challenge"
    >
      <div className="modal-box" style={{ maxWidth: 560 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <span className="eyebrow" style={{ color: 'var(--accent)' }}>Sept 1 – Oct 31 · Limited window</span>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, margin: '8px 0 0' }}>
              The Sprout Builder Challenge
            </h3>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            aria-label="Close"
            style={{ padding: '4px 10px', marginTop: -2 }}
          >
            ✕
          </button>
        </div>

        <p style={{ color: 'var(--text-muted)', fontSize: 14.5, lineHeight: 1.6, margin: '14px 0 20px' }}>
          A <strong style={{ color: 'var(--text)' }}>25,000 ALGO</strong> prize pool
          rewarding the builders who launch during the challenge window. Two of the three
          awards are decided by transparent, on-chain outcomes — real funding and real
          backers, verifiable directly from the chain.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="card" style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
              <strong style={{ fontSize: 14.5 }}>Most Successful Campaign</strong>
              <span style={{ color: 'var(--accent)', fontWeight: 700, whiteSpace: 'nowrap' }}>10,000 ALGO</span>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              The largest campaign by ALGO raised that successfully hits its funding goal.
            </p>
          </div>

          <div className="card" style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
              <strong style={{ fontSize: 14.5 }}>Strongest Community Turnout</strong>
              <span style={{ color: 'var(--accent)', fontWeight: 700, whiteSpace: 'nowrap' }}>10,000 ALGO</span>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              The campaign that rallies the most backers — measured by unique backing wallets,
              counted transparently from on-chain data.
            </p>
          </div>

          <div className="card" style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
              <strong style={{ fontSize: 14.5 }}>Founder's Choice</strong>
              <span style={{ color: 'var(--accent)', fontWeight: 700, whiteSpace: 'nowrap' }}>5,000 ALGO</span>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              A personal favorite from the campaigns that launch — subjective, and chosen directly by the founder.
            </p>
          </div>
        </div>

        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55, margin: '16px 0 0' }}>
          Campaigns can win more than one award — the categories aren't mutually exclusive.
          To be eligible, a campaign must launch between <strong style={{ color: 'var(--text)' }}>September 1</strong> and
          {' '}<strong style={{ color: 'var(--text)' }}>October 31</strong>.
        </p>

        <div style={{ display: 'flex', gap: 12, marginTop: 22, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Maybe later</button>
          <Link to="/create" className="btn btn-primary" onClick={onClose}>
            Launch a campaign <Icon.arrow style={{ width: 16, height: 16 }} />
          </Link>
        </div>
      </div>
    </div>
  )
}
