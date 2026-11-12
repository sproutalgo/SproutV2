import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import CycleStatus from '../components/CycleStatus'
import { Icon } from '../components/UI'

// The funding engine hub. Status strip at top, then phase-aware tiles for the four
// activities (stake, nominate, vote, results). The current phase's action is
// highlighted; actions that aren't available right now are shown with a "why/when"
// note rather than a dead button — so the user is always oriented.
export default function Fund() {
  const [status, setStatus] = useState(null)
  const phaseKey = status?.phase?.key

  // Is voting live right now? (Only then is the stake-&-vote tile the primary action.)
  const votingLive = phaseKey === 'voting'

  const tiles = [
    {
      key: 'pool',
      title: 'Grow the pool',
      body: 'Stake ALGO into the reward escrow to fund the prize pool. Never locked — withdraw anytime.',
      to: '/fund/participate',
      cta: 'Stake ALGO',
      note: null,
    },
    {
      key: 'nominate',
      title: 'Nominate projects',
      body: 'Back a project in the directory to help build the ballot. Any connected wallet — no stake needed. Always open.',
      to: '/directory',
      cta: 'Browse & nominate',
      note: 'Open now',
      live: true,
    },
    {
      key: 'vote',
      title: 'Stake Sprout & vote',
      body: 'Stake Sprout for voting weight, then vote on which ballot projects win funding.',
      to: '/fund/participate',
      cta: votingLive ? 'Vote now' : 'Stake & view ballot',
      note: votingLive
        ? 'Voting is open'
        : status?.deadline && phaseKey === 'nominating'
          ? `Voting opens in ${status.deadline.label}`
          : 'Voting opens with the next round',
      live: votingLive,
    },
    {
      key: 'results',
      title: 'Results',
      body: 'See which projects won past rounds and how much each received from the pool.',
      to: '/fund/results',
      cta: 'View past rounds',
      note: null,
    },
  ]

  return (
    <div className="wrap" style={{ padding: '40px 32px 72px' }}>
      <div style={{ maxWidth: 760, marginBottom: 10 }}>
        <h1 style={{ fontSize: 'clamp(32px, 4vw, 46px)', margin: 0 }}>The funding engine</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 16, lineHeight: 1.6, marginTop: 12 }}>
          Stake ALGO to grow a shared prize pool. The community nominates projects onto the
          ballot; stakers vote on who wins with staked Sprout. Top projects split the pool each round.
        </p>
      </div>

      <div style={{ margin: '24px 0 32px' }}>
        <CycleStatus variant="strip" onData={setStatus} />
      </div>

      <div style={{
        display: 'grid', gap: 18,
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
      }}>
        {tiles.map(t => (
          <div key={t.key} className="card"
               style={{
                 padding: 22, display: 'flex', flexDirection: 'column', gap: 12,
                 borderColor: t.live ? 'var(--accent-line)' : 'var(--border)',
               }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 19 }}>{t.title}</h3>
              {t.note && (
                <span className={`badge ${t.live ? 'badge-success' : 'badge'}`} style={{ whiteSpace: 'nowrap' }}>
                  {t.live && <span className="badge-dot" />}{t.note}
                </span>
              )}
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.55, margin: 0, flex: 1 }}>
              {t.body}
            </p>
            <div>
              <Link to={t.to} className={t.live ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}>
                {t.cta}
              </Link>
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 28, padding: 22 }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 17 }}>How a round works</h3>
        <ol style={{ margin: 0, paddingLeft: 20, color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.7 }}>
          <li><strong style={{ color: 'var(--text)' }}>Stake ALGO</strong> — holders stake ALGO into the escrow, growing the shared prize pool.</li>
          <li><strong style={{ color: 'var(--text)' }}>Nominate</strong> — the community backs projects in the directory; the top 8 become the ballot.</li>
          <li><strong style={{ color: 'var(--text)' }}>Vote</strong> — stakers stake Sprout for weight and vote on the ballot.</li>
          <li><strong style={{ color: 'var(--text)' }}>Payout</strong> — the top projects split the pool. Then it resets and repeats.</li>
        </ol>
      </div>
    </div>
  )
}
