import React, { useState } from 'react'
import { formatAlgoAmount } from '../utils/algorand'

// ── Icons ──────────────────────────────────────────────────────────────────────
export const Icon = {
  logo: (p) => (
    <svg viewBox="0 0 24 24" fill="none" {...p}>
      {/* Sprout icon — stem with two leaves */}
      <path d="M12 22V12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <path d="M12 12C12 12 7 11 5 7C7 3 12 4 12 7" fill="currentColor" opacity="0.85"/>
      <path d="M12 12C12 12 17 10 19 6C17 2 12 3 12 6" fill="currentColor"/>
    </svg>
  ),
  arrow:  (p) => <svg viewBox="0 0 24 24" fill="none" {...p}><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  plus:   (p) => <svg viewBox="0 0 24 24" fill="none" {...p}><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>,
  copy:   (p) => <svg viewBox="0 0 24 24" fill="none" {...p}><rect x="9" y="9" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.8"/><path d="M5 15V5a2 2 0 012-2h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>,
  check:  (p) => <svg viewBox="0 0 24 24" fill="none" {...p}><path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  clock:  (p) => <svg viewBox="0 0 24 24" fill="none" {...p}><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8"/><path d="M12 7v5l3.5 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>,
  users:  (p) => <svg viewBox="0 0 24 24" fill="none" {...p}><circle cx="9" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.8"/><path d="M3.5 19c.6-3.2 2.9-5 5.5-5s4.9 1.8 5.5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><path d="M16 5.2A3 3 0 0118 11M17.5 14c2 .6 3.5 2.4 4 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>,
  shield: (p) => <svg viewBox="0 0 24 24" fill="none" {...p}><path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  bolt:   (p) => <svg viewBox="0 0 24 24" fill="none" {...p}><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" fill="currentColor"/></svg>,
  refund: (p) => <svg viewBox="0 0 24 24" fill="none" {...p}><path d="M3 12a9 9 0 109-9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><path d="M3 4v4h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  globe:  (p) => <svg viewBox="0 0 24 24" fill="none" {...p}><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7"/><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" stroke="currentColor" strokeWidth="1.7"/></svg>,
  spark:  (p) => <svg viewBox="0 0 24 24" fill="none" {...p}><path d="M12 3v6M12 15v6M3 12h6M15 12h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>,
  search: (p) => <svg viewBox="0 0 24 24" fill="none" {...p}><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8"/><path d="M20 20l-3-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>,
  sun:    (p) => <svg viewBox="0 0 24 24" fill="none" {...p}><circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.8"/><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>,
  moon:   (p) => <svg viewBox="0 0 24 24" fill="none" {...p}><path d="M20.5 14.2A8.5 8.5 0 119.8 3.5a7 7 0 1010.7 10.7z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>,
  lock:   (p) => <svg viewBox="0 0 24 24" fill="none" {...p}><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" stroke="currentColor" strokeWidth="1.8"/><path d="M8 10.5V8a4 4 0 018 0v2.5" stroke="currentColor" strokeWidth="1.8"/></svg>,
  heart:  (p) => <svg viewBox="0 0 24 24" fill="none" {...p}><path d="M12 20.5S3.5 15.4 3.5 9.3A4.8 4.8 0 0112 6.2a4.8 4.8 0 018.5 3.1c0 6.1-8.5 11.2-8.5 11.2z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>,
  external: (p) => <svg viewBox="0 0 24 24" fill="none" {...p}><path d="M14 4h6v6M20 4l-8.5 8.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M19 13.5V18a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2h4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>,
  x:      (p) => <svg viewBox="0 0 24 24" fill="none" {...p}><path d="M5 4l14 16M19 4L5 20" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/></svg>,
  discord: (p) => <svg viewBox="0 0 24 24" fill="none" {...p}><path d="M6 8.5c2-1 4-1.5 6-1.5s4 .5 6 1.5c1 2.3 1.3 5.6.5 8.5-1.6 1.3-3.4 2-5.2 2.2l-.7-1.4c1-.3 1.9-.7 2.7-1.3-1.7.7-3.5 1-5.3 1s-3.6-.3-5.3-1c.8.6 1.7 1 2.7 1.3l-.7 1.4C5 18.6 3.2 17.9 1.6 16.6c-.8-2.9-.5-6.2.5-8.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><ellipse cx="9" cy="13" rx="1.1" ry="1.3" fill="currentColor"/><ellipse cx="15" cy="13" rx="1.1" ry="1.3" fill="currentColor"/></svg>,
}

// ── Brand ──────────────────────────────────────────────────────────────────────
export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark"><Icon.logo style={{ color: 'var(--accent)' }} /></span>
      Sprout
    </div>
  )
}

// ── Status badge ───────────────────────────────────────────────────────────────
const STATUS_MAP = {
  'needs-setup': { label: 'Needs setup',  cls: 'badge-warn'    },
  'active':      { label: 'Live',         cls: 'badge-accent'  },
  'funded':      { label: 'Funded',       cls: 'badge-success' },
  'distributed': { label: 'Distributed',  cls: 'badge-success' },
  'cancelled':   { label: 'Cancelled',    cls: 'badge-danger'  },
  'failed':      { label: 'Goal not met', cls: 'badge-danger'  },
}

export function StatusBadge({ status }) {
  const s = STATUS_MAP[status] || { label: status, cls: '' }
  return (
    <span className={`badge ${s.cls}`}>
      {status === 'active' && <span className="badge-dot" />}
      {s.label}
    </span>
  )
}

// ── Copyable ID tag ────────────────────────────────────────────────────────────
export function IdTag({ label, value, copyValue }) {
  const [copied, setCopied] = useState(false)
  const toCopy = copyValue ?? value
  function copy(e) {
    e.stopPropagation()
    navigator.clipboard?.writeText(toCopy)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }
  return (
    <span className="idtag" onClick={copy} title={`Copy: ${toCopy}`}>
      {label && <span style={{ color: 'var(--text-faint)' }}>{label}</span>}
      <span>{value}</span>
      {copied
        ? <Icon.check style={{ color: 'var(--success)' }} />
        : <Icon.copy />
      }
    </span>
  )
}

// ── Progress bar ───────────────────────────────────────────────────────────────
export function Progress({ raised, goal, animated = true }) {
  const p = Math.min(100, Math.round((raised / goal) * 100)) || 0
  const done = p >= 100
  const near = !done && p >= 85
  return (
    <div className={`progress${done ? ' done' : ''}${near ? ' near' : ''}`}>
      <i style={{ width: animated ? `${p}%` : `${p}%` }} />
    </div>
  )
}

// ── Cover art (seeded botanical identity per project) ──────────────────────────
// Same props API as before. When no image is set, renders a deterministic
// arrangement of Sprout leaves seeded from the project's symbol/label, tinted
// by category hue. Lightness adapts to the active theme via CSS variables.
const LEAF_PATH = 'M0 30 Q23.2 23.7 27 0 Q3.8 6.3 0 30 Z'

function seededRand(str) {
  let h = 2166136261
  const s = String(str)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return () => {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5
    return ((h >>> 0) % 10000) / 10000
  }
}

export function Cover({ hue = 280, label, style, sym, imageUrl, className = '' }) {
  if (imageUrl) {
    return (
      <div className={`cover-ph ${className}`} style={{ backgroundImage: `url(${imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center', ...style }}>
        {sym && <span className="ph-sym" style={{ color: 'rgba(255,255,255,0.9)', textShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>${sym}</span>}
        {label && <span className="ph-label">{label}</span>}
      </div>
    )
  }
  const rand = seededRand(`${sym || ''}|${label || ''}|${hue}`)
  const leaves = Array.from({ length: 6 }, (_, i) => ({
    x: 8 + rand() * 84,
    y: 8 + rand() * 64,
    s: 0.8 + rand() * 1.6,
    r: Math.round(rand() * 360),
    flip: rand() > 0.5 ? -1 : 1,
    key: i,
  }))
  return (
    <div className={`cover-ph ${className}`} style={{
      background: `linear-gradient(155deg, oklch(var(--cover-l1) 0.055 ${hue}), oklch(var(--cover-l2) 0.07 ${hue}))`,
      ...style,
    }}>
      <svg className="ph-leaves" viewBox="0 0 100 80" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        {leaves.map(l => (
          <g key={l.key} transform={`translate(${l.x} ${l.y}) rotate(${l.r}) scale(${l.s * l.flip} ${l.s})`}>
            <path d={LEAF_PATH} transform="scale(0.5)" fill={`oklch(var(--cover-leaf-l) 0.10 ${hue} / var(--cover-leaf-a))`} />
          </g>
        ))}
      </svg>
      {sym && <span className="ph-sym" style={{ color: `oklch(var(--cover-sym-l) 0.10 ${hue})` }}>${sym}</span>}
      {label && <span className="ph-label">{label}</span>}
    </div>
  )
}

// ── Identicon (deterministic avatar from a wallet address) ─────────────────────
export function Identicon({ seed = '', size = 20 }) {
  let h = 0
  const s = String(seed)
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0
  const hue = h % 360
  const init = (s.replace(/[^A-Z0-9]/gi, '').slice(0, 2) || '··').toUpperCase()
  return (
    <span
      className="identicon"
      aria-hidden="true"
      style={{
        width: size, height: size,
        background: `oklch(var(--idn-bg-l) 0.09 ${hue})`,
        color: `oklch(var(--idn-fg-l) 0.10 ${hue})`,
        fontSize: Math.max(8, Math.round(size * 0.42)),
      }}
    >{init}</span>
  )
}

// ── Stat block ─────────────────────────────────────────────────────────────────
export function Stat({ value, label, accent }) {
  return (
    <div className="stat">
      <div className="stat-val" style={accent ? { color: 'var(--accent)' } : undefined}>{value}</div>
      <div className="stat-lbl">{label}</div>
    </div>
  )
}

// ── Skeleton card ──────────────────────────────────────────────────────────────
export function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <div className="sk-hero sk-pulse" />
      <div className="sk-body">
        <div className="sk-line sk-title sk-pulse" />
        <div className="sk-line sk-subtitle sk-pulse" />
        <div className="sk-bar sk-pulse" style={{ marginTop: 8 }} />
      </div>
    </div>
  )
}

// ── Data helpers ───────────────────────────────────────────────────────────────
/**
 * Display an ALGO amount (whole ALGO, not microAlgos).
 *
 * Thin wrapper over the canonical formatAlgoAmount() in utils/algorand.js so
 * there is exactly ONE formatting policy in the app. Locale is pinned to
 * 'en-US' inside the canonical formatter — this fixes the bug where a European
 * browser rendered "45" as "45.000" (read as 45,000) via the old
 * locale-sensitive toLocaleString(undefined, …) path.
 *
 * Defaults to 0 decimals because every campaign amount on the platform is
 * whole ALGO (goals and contributions are integer-enforced), so
 * "250 of 50,000 ALGO" reads cleanest. Pass { decimals: 2 } for fractional
 * values (e.g. a listing fee) or { compact: true } to abbreviate ≥1000 as "k".
 */
export function fmtAlgo(n, opts = {}) {
  if (typeof opts === 'number') opts = { decimals: opts }
  const { decimals = 0, compact = false, smart = false } = opts
  return formatAlgoAmount(n, { decimals, compact, smart })
}

export function pctNum(raised, goal) {
  return Math.min(100, Math.round((raised / goal) * 100)) || 0
}

export function shortAddr(a) {
  if (!a) return ''
  const s = String(a)
  if (s.length < 10) return s
  return s.slice(0, 6) + '…' + s.slice(-4)
}

const ROUND_SECS = 2.8
export function daysLeftLabel(deadlineRound, currentRound) {
  if (!deadlineRound || !currentRound) return { text: '—', urgent: false, ended: false }
  const roundsLeft = deadlineRound - currentRound
  if (roundsLeft <= 0) return { text: 'Ended', urgent: false, ended: true }
  const secsLeft = roundsLeft * ROUND_SECS
  const days = Math.floor(secsLeft / 86400)
  const hrs  = Math.floor((secsLeft % 86400) / 3600)
  if (days >= 1) return { text: `${days} day${days > 1 ? 's' : ''} left`, urgent: days <= 3, ended: false }
  return { text: `${hrs}h left`, urgent: true, ended: false }
}

export function deriveProjectStatus(p, currentRound = 0) {
  if (!p) return 'active'
  const m = p.meta || {}
  if (m.is_distributed || (p.deleted && !m.is_refunded && !m.is_cancelled)) return 'distributed'
  if (m.is_funded) return 'funded'
  if (m.is_cancelled || Number(p.gs?.cancelled ?? 0) === 1) return 'cancelled'
  if (m.is_refunded) return 'failed'

  const raised      = Number(p.gs?.raised       ?? 0)
  const goal        = Number(p.gs?.goal         ?? 1)
  const fundedRound = Number(p.gs?.funded_round ?? 0)
  const deadline    = Number(p.gs?.deadline     ?? 0)

  // Terminal states must be decided BEFORE the needs-setup fallback, because a
  // failed campaign whose creator has reclaimed the token pool has asa_id reset
  // to 0 — it must still read as 'failed', never revert to 'needs-setup'.
  // funded_round is set permanently when the goal is first reached.
  if (fundedRound > 0 || raised >= goal) return 'funded'
  // Deadline passed without reaching goal — campaign failed (regardless of asa_id).
  if (deadline > 0 && currentRound > deadline) return 'failed'

  // Still active: only now does a missing ASA mean "not yet set up".
  if (!p.gs?.asa_id && !p.meta?.is_donation) return 'needs-setup'
  return 'active'
}

// Hue from category for cover art
const CATEGORY_HUE = {
  DeFi:           168,
  RWA:            45,
  AI:             220,
  NFT:            300,
  Gaming:         25,
  Infrastructure: 200,
  Social:         330,
  Other:          280,
}
export function categoryHue(category) {
  return CATEGORY_HUE[category] || 280
}
