import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchCycleStatus } from '../utils/cycleStatus'
import { fmtAlgo } from './UI'

// The cycle status strip — the backbone surface. Shows pool size, the current human
// phase, the next deadline countdown, and the single primary action for right now.
// Reused on the landing page and atop the Fund hub. Styled entirely with the existing
// design-system classes so it reads as native.
//
// Props:
//   variant="strip"  (default) — compact horizontal bar for atop a page
//   variant="hero"   — larger block for the landing page
//   onData(status)   — optional callback so a parent can read the status too
export default function CycleStatus({ variant = 'strip', onData }) {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const s = await fetchCycleStatus()
        if (!alive) return
        setStatus(s)
        if (onData) onData(s)
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    const t = setInterval(load, 45000)   // refresh ~45s; status needn't be to-the-second
    return () => { alive = false; clearInterval(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const phase = status?.phase
  const toneClass = {
    accent: 'badge-accent', success: 'badge-success', warn: 'badge-warn', muted: 'badge',
  }[phase?.tone || 'muted']

  // Where the primary action points.
  const actionTarget = {
    nominate: { to: '/directory', label: 'Nominate a project' },
    vote:     { to: '/fund/participate', label: 'Vote now' },
    none:     null,
  }[phase?.action || 'none']

  if (loading) {
    return (
      <div className={variant === 'hero' ? 'cycle-hero card' : 'cycle-strip card'}
           style={stripStyle(variant)}>
        <span style={{ color: 'var(--text-faint)' }}>Loading cycle status…</span>
      </div>
    )
  }

  const pool = fmtAlgo(status.poolMicro / 1_000_000)

  if (variant === 'hero') {
    return (
      <div className="card" style={{ padding: 28, display: 'grid', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className={`badge ${toneClass}`}><span className="badge-dot" />{phase.label}</span>
          {status.deadline && (
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {phase.key === 'voting' ? 'Voting closes' : phase.key === 'nominating' ? 'Nominations close' : 'Next'} in {status.deadline.label}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap' }}>
          <div className="stat">
            <span className="stat-val">{pool} ALGO</span>
            <span className="stat-lbl">Current prize pool</span>
          </div>
          {status.epochId > 0 && (
            <div className="stat">
              <span className="stat-val">#{status.epochId}</span>
              <span className="stat-lbl">Funding round</span>
            </div>
          )}
        </div>
        {actionTarget && (
          <div>
            <Link to={actionTarget.to} className="btn btn-primary">{actionTarget.label}</Link>
          </div>
        )}
      </div>
    )
  }

  // Compact strip.
  return (
    <div className="card" style={stripStyle(variant)}>
      <span className={`badge ${toneClass}`}><span className="badge-dot" />{phase.label}</span>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <strong style={{ fontSize: 15 }}>{pool} ALGO</strong>
        <span style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>pool</span>
      </span>
      {status.deadline && (
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {phase.key === 'voting' ? 'closes' : 'next'} in {status.deadline.label}
        </span>
      )}
      <span style={{ flex: 1 }} />
      {actionTarget && (
        <Link to={actionTarget.to} className="btn btn-soft btn-sm">{actionTarget.label}</Link>
      )}
    </div>
  )
}

function stripStyle(variant) {
  return {
    display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
    padding: variant === 'hero' ? 28 : '14px 18px',
  }
}
