import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { fetchNominationRound, fetchNominationRoundResults } from '../utils/api'
import { fmtAlgo } from '../components/UI'

// Public record of nomination rounds and funding outcomes. Builds trust: a visible
// track record of fair payouts is what makes a newcomer comfortable staking.
//
// Nomination history is live today (the round-stamped nomination votes). On-chain
// funding winners/amounts are shown when a funding_results source is available; until
// that recording step is added to the admin finalize flow, this page shows the
// nomination side and notes where winners will appear.
export default function Results() {
  const [currentRound, setCurrentRound] = useState(null)
  const [rounds, setRounds] = useState([])          // [{ round, totalVotes, results:[...] }]
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const { round } = await fetchNominationRound()
        if (!alive) return
        setCurrentRound(round)
        // Fetch this round and up to the 5 previous rounds of nomination standings.
        const start = Math.max(1, round - 5)
        const nums = []
        for (let n = round; n >= start; n--) nums.push(n)
        const fetched = await Promise.all(
          nums.map(n => fetchNominationRoundResults(n).catch(() => null))
        )
        if (!alive) return
        setRounds(fetched.filter(Boolean))
      } catch (e) {
        // non-fatal; page still renders its explanation
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => { alive = false }
  }, [])

  return (
    <div className="wrap" style={{ padding: '40px 32px 72px', maxWidth: 820 }}>
      <Link to="/fund" style={{ fontSize: 13, color: 'var(--text-muted)' }}>← Funding engine</Link>
      <h1 style={{ fontSize: 'clamp(30px, 4vw, 42px)', margin: '10px 0 0' }}>Results & history</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 16, lineHeight: 1.6, marginTop: 12, maxWidth: 580 }}>
        The record of past funding rounds — which projects the community nominated and,
        once recorded, which won and how much they received.
      </p>

      {loading ? (
        <div className="card" style={{ padding: 22, marginTop: 24, color: 'var(--text-faint)' }}>Loading…</div>
      ) : rounds.length === 0 ? (
        <div className="card" style={{ padding: 22, marginTop: 24 }}>
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>No rounds recorded yet.</p>
        </div>
      ) : (
        <div style={{ marginTop: 24, display: 'grid', gap: 18 }}>
          {rounds.map(r => (
            <div key={r.round} className="card" style={{ padding: 22 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 18 }}>
                  Round {r.round}
                  {r.round === currentRound && <span className="badge badge-success" style={{ marginLeft: 10 }}><span className="badge-dot" />Current</span>}
                </h3>
                <span style={{ fontSize: 13, color: 'var(--text-faint)' }}>{r.totalVotes} nomination vote{r.totalVotes === 1 ? '' : 's'}</span>
              </div>
              {(!r.results || r.results.length === 0) ? (
                <p style={{ color: 'var(--text-faint)', margin: 0, fontSize: 14 }}>No nominations in this round.</p>
              ) : (
                <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
                  {r.results.map((p, i) => (
                    <li key={p.directory_entry_id} style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px',
                      borderRadius: 'var(--r-sm)',
                      background: i < 8 ? 'var(--surface-2)' : 'transparent',
                    }}>
                      <span style={{ width: 22, color: 'var(--text-faint)', fontWeight: 600 }}>{i + 1}</span>
                      <span style={{ flex: 1, fontWeight: i < 8 ? 600 : 400 }}>
                        {p.name}
                        {i < 8 && <span className="badge badge-accent" style={{ marginLeft: 8 }}>Top 8</span>}
                        {/* When funding_results is wired, show the awarded amount here:
                            {p.awardedMicro != null && <span>{fmtAlgo(p.awardedMicro/1e6)} ALGO</span>} */}
                      </span>
                      <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)', fontSize: 14 }}>
                        {p.votes} vote{p.votes === 1 ? '' : 's'}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="card" style={{ marginTop: 22, padding: 20 }}>
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          On-chain funding amounts appear here once the admin records a round's winners at
          finalize. Nomination standings above are the community signal that produced each
          round's ballot.
        </p>
      </div>
    </div>
  )
}
