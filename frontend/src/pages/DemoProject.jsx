/**
 * DemoProject.jsx
 * A static example of a fully populated project detail page.
 * Accessible at /project/demo — linked from the placeholder card on the explore page.
 * Shows creators exactly what their campaign page will look like.
 */
import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Cover, StatusBadge, Progress, Icon, Identicon,
  fmtAlgo, pctNum, categoryHue,
} from '../components/UI'

const DEMO = {
  meta: {
    name:        'Sprout',
    tagline:     'The grassroots Algorand crowdfunding platform.',
    description: `Sprout is a non-custodial crowdfunding platform built on the Algorand blockchain. We connect project creators with the community capital they need to bring their ideas to life.

Every campaign on Sprout is backed by a self contained smart contract — your funds are never held by us. Contributions are locked in the contract and returned in full if the campaign doesn't reach its goal.

Our mission is to make it easy for anyone building on Algorand to raise funds transparently, with real on-chain accountability and a community of backers who believe in the ecosystem.`,
    category:    'Infrastructure',
    token_name:  'SPRT',
    website_url: 'https://x.com/sproutalgo',
    image_url:   '',
    highlights:  [
      'Fully non-custodial — funds held in independent smart contracts, never by the platform.',
      'Transparent fee structure — 0.001% listing fee per day (min 10 ALGO), 4% success fee on funded campaigns only.',
      'Built for Algorand — instant finality, sub-cent fees, carbon-neutral infrastructure.',
    ],
  },
  gs: {
    goal:         50_000_000_000,   // 50,000 ALGO
    raised:       50_000_000_000,
    funded_round: 1,
    rate:         100,              // 100 SPRT per ALGO
    deadline:     99_999_999,
    asa_id:       1,
    days:         30,
  },
  creator: 'SPROUT...DEMO',
}

const goal        = DEMO.gs.goal
const raised      = DEMO.gs.raised
const pct         = pctNum(goal, goal)   // 100%
const hue         = categoryHue(DEMO.meta.category)
const tokensTotal = (goal / 1_000_000) * DEMO.gs.rate

export default function DemoProject() {
  const [showContract, setShowContract] = useState(false)
  const [contributeAmt, setContributeAmt] = useState('50')

  const presets = [10, 25, 50, 100]
  const amt     = Number(contributeAmt) || 0
  const tokens  = amt * DEMO.gs.rate

  return (
    <div className="wrap detail-top rise">
      <Link to="/" className="back-link"><Icon.arrow /> Back to campaigns</Link>

      {/* Demo banner */}
      <div style={{
        background: 'var(--accent-soft)',
        border: '1px solid var(--accent-line)',
        borderRadius: 'var(--r-md)',
        padding: '12px 20px',
        marginBottom: 24,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontSize: 13.5,
        color: 'var(--text-muted)',
      }}>
        <span style={{ fontSize: 18 }}>🌱</span>
        <div>
          <strong style={{ color: 'var(--text)' }}>This is a demo campaign.</strong>
          {' '}It shows how your project page will look to backers. No transactions are possible.
          {' '}<Link to="/create" style={{ color: 'var(--accent)' }}>Launch your own campaign →</Link>
        </div>
      </div>

      <div className="detail-grid">
        {/* ── Left — story ── */}
        <div>
          <Cover
            hue={hue}
            sym={DEMO.meta.token_name}
            imageUrl={DEMO.meta.image_url}
            className="detail-cover"
            style={{ height: 340 }}
          />

          <div className="detail-head">
            <span className="badge badge-accent">{DEMO.meta.category}</span>
            <StatusBadge status="funded" />
          </div>

          <h1 className="detail-title">{DEMO.meta.name}</h1>
          <p className="detail-tag">{DEMO.meta.tagline}</p>

          <div className="detail-creator">
            <Identicon seed={DEMO.creator} size={38} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>SPROUT…DEMO</div>
              <div className="faint" style={{ fontSize: 13 }}>Verified creator</div>
            </div>
          </div>

          <div className="detail-section">
            <h3>About this project</h3>
            {DEMO.meta.description.split('\n\n').map((para, i) => (
              <p key={i} className="detail-body" style={{ marginBottom: 12 }}>{para}</p>
            ))}
          </div>

          {DEMO.meta.highlights.length > 0 && (
            <div className="detail-section">
              <h3>Highlights</h3>
              <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {DEMO.meta.highlights.map((h, i) => (
                  <li key={i} style={{ fontSize: 14.5, lineHeight: 1.6, color: 'var(--text-muted)' }}>{h}</li>
                ))}
              </ul>
            </div>
          )}

          <div style={{ marginTop: 20 }}>
            <a href={DEMO.meta.website_url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
              <Icon.globe style={{ width: 15, height: 15 }} /> Visit website
            </a>
          </div>
        </div>

        {/* ── Right — funding panel ── */}
        <aside>
          <div className="card fund-panel">
            {/* Progress */}
            <div>
              <div className="fund-big">
                {pct}<span style={{ fontSize: 22, color: 'var(--text-muted)' }}>%</span>
                {' '}<span style={{ fontSize: 17, color: 'var(--text-muted)', fontWeight: 500 }}>funded</span>
              </div>
              <div style={{ margin: '16px 0 8px' }}>
                <Progress raised={goal} goal={goal} />
              </div>
              <div className="fund-of">{fmtAlgo(goal / 1_000_000)} of {fmtAlgo(goal / 1_000_000)} ALGO pledged</div>
            </div>

            <div className="fund-meta">
              <div className="stat">
                <div className="stat-val" style={{ fontSize: 21 }}>30</div>
                <div className="stat-lbl">days listed</div>
              </div>
              <div className="stat">
                <div className="stat-val" style={{ fontSize: 21 }}>{DEMO.gs.rate}</div>
                <div className="stat-lbl">tokens / ALGO</div>
              </div>
            </div>

            {/* Contribute section — shown as example but disabled */}
            <div style={{ opacity: 0.5, pointerEvents: 'none' }}>
              <div className="contribute-label" style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
                Contribute to this campaign
              </div>
              <div className="rate-pill" style={{
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                borderRadius: 'var(--r-sm)', padding: '8px 14px',
                fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
              }}>
                <span style={{ color: 'var(--text-muted)' }}>1 ALGO</span>
                <Icon.arrow style={{ width: 14, height: 14, color: 'var(--text-muted)' }} />
                <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{DEMO.gs.rate} {DEMO.meta.token_name}</span>
              </div>
              <div style={{ position: 'relative', marginBottom: 12 }}>
                <input
                  id="demo-contribute-amount"
                  name="demo-contribute-amount"
                  aria-label="Demo contribution amount"
                  className="input no-spin"
                  type="text"
                  value={contributeAmt}
                  readOnly
                  style={{ paddingRight: 60 }}
                />
                <span style={{
                  position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
                  fontSize: 13, color: 'var(--text-muted)', fontWeight: 600,
                }}>ALGO</span>
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                {presets.map(p => (
                  <button key={p} className="btn btn-ghost btn-sm" style={{ flex: 1 }}>{p}</button>
                ))}
              </div>
              {amt > 0 && (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12, textAlign: 'center' }}>
                  You receive ≈ {tokens.toLocaleString('en-US')} {DEMO.meta.token_name}
                </div>
              )}
              <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled>
                Back this project
              </button>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginTop: 8 }}>
                Refunded in full if the goal isn't met by the deadline.
              </p>
            </div>

            {/* Contract details */}
            <button
              className="btn btn-ghost btn-sm"
              style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}
              onClick={() => setShowContract(s => !s)}
            >
              {showContract ? 'Hide' : 'Show'} contract details
            </button>
            {showContract && (
              <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { l: 'App ID',         v: 'DEMO' },
                  { l: 'Goal',           v: `${fmtAlgo(goal / 1_000_000)} ALGO` },
                  { l: 'Rate',           v: `${DEMO.gs.rate} ${DEMO.meta.token_name} / ALGO` },
                  { l: 'Duration',       v: `${DEMO.gs.days} days` },
                  { l: 'Token supply',   v: `${tokensTotal.toLocaleString('en-US')} ${DEMO.meta.token_name}` },
                  { l: 'Creator',        v: 'SPROUT…DEMO' },
                ].map(({ l, v }) => (
                  <div key={l} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{l}</span>
                    <span style={{ color: 'var(--text)', fontWeight: 500 }}>{v}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
