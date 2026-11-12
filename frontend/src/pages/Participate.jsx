import React, { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useWallet } from '@txnlab/use-wallet-react'
import { useToast } from '../context/ToastContext'
// Governance (Sprout) staking + voting:
import {
  stake as stakeSprout, unstake as unstakeSprout, vote,
  fetchStaked, listCandidateIds, fetchCandidateWeight,
} from '../utils/governanceChain'
// Escrow (ALGO) pool staking:
import { deposit as depositAlgo, withdraw as withdrawAlgo, fetchMyPosition, fetchEscrowStats } from '../utils/stakingChain'
import { fetchDirectory } from '../utils/api'
import { fetchCycleStatus } from '../utils/cycleStatus'
import { fmtAlgo } from '../components/UI'
import CycleStatus from '../components/CycleStatus'

// Staking and voting are intrinsically connected, so they live on one page. Two distinct
// actions, kept visually separate so nobody conflates them:
//   • Grow the pool — stake ALGO into the escrow. This funds the prize pool.
//   • Vote — stake Sprout for voting weight, then vote on the ballot (voting window only).
// ALGO staking does NOT give a vote; Sprout staking does NOT grow the pool. The copy and
// layout make that boundary explicit.
const MICRO = 1_000_000
const MAX_DECIMALS = 6   // ALGO and Sprout both have 6 decimals

// Keep an amount field to a valid decimal with at most 6 fractional digits. Rejects a
// keystroke that would exceed 6 decimals (so 1.2345678 can't be entered), strips any
// non-numeric characters, and allows a lone trailing '.' while typing. Returns the
// previous value unchanged when the new input is invalid, so typing simply won't take.
function sanitizeAmount(next, prev) {
  if (next === '') return ''
  // digits with an optional single decimal point and up to 6 fractional digits
  if (!/^\d*\.?\d{0,6}$/.test(next)) return prev
  return next
}

export default function Participate() {
  const { activeAddress, signTransactions } = useWallet()
  const { addToast } = useToast()

  const [status, setStatus] = useState(null)
  // Total ALGO staked across ALL accounts in the escrow (= the escrow's principal).
  const [totalStakedMicro, setTotalStakedMicro] = useState(0)

  // ALGO (escrow) position. Depositing ALGO returns Sprout 1:1 as the principal receipt;
  // withdrawing returns that ALGO for the Sprout. So the user's pooled ALGO == their
  // escrow Sprout principal (fetchMyPosition.principalMicro).
  const [algoPos, setAlgoPos] = useState(null)      // { principalMicro, sproutMicro, optedIn }
  const [algoAmt, setAlgoAmt] = useState('')

  // Sprout (governance) stake + vote
  const [sprout, setSprout] = useState(null)        // { stakedMicro, hasVote, votedCandidate }
  const [sproutAmt, setSproutAmt] = useState('')
  const [candidates, setCandidates] = useState([])  // [{ id, weightMicro }]
  const [dirEntries, setDirEntries] = useState([])
  const [choice, setChoice] = useState('')

  const [busy, setBusy] = useState('')
  const [loading, setLoading] = useState(true)

  const nameFor = useCallback((id) => {
    const e = dirEntries.find(x => Number(x.candidate_number) === Number(id))
    return e ? e.name : `Candidate #${id}`
  }, [dirEntries])

  const reload = useCallback(async () => {
    try {
      const [s, sp, algo, dir, ids, escrowStats] = await Promise.all([
        fetchCycleStatus(),
        activeAddress ? fetchStaked(activeAddress).catch(() => null) : Promise.resolve(null),
        activeAddress ? fetchMyPosition(activeAddress).catch(() => null) : Promise.resolve(null),
        fetchDirectory({ page: 1, pageSize: 200 }).then(r => r.entries || []).catch(() => []),
        listCandidateIds().catch(() => []),
        fetchEscrowStats().catch(() => null),
      ])
      setStatus(s)
      setTotalStakedMicro(Number(escrowStats?.principalMicro) || 0)
      setSprout(sp)
      setAlgoPos(algo)
      setDirEntries(dir)
      const withW = await Promise.all(ids.map(async id => ({
        id, weightMicro: Number(await fetchCandidateWeight(id).catch(() => 0)) || 0,
      })))
      setCandidates(withW)
    } catch (e) {
      addToast(e.message || 'Failed to load', 'error')
    } finally { setLoading(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAddress])

  useEffect(() => { reload() }, [reload])

  const phaseKey = status?.phase?.key
  const votingOpen = phaseKey === 'voting'
  const sproutStakedMicro = sprout?.stakedMicro ?? 0
  // ALGO withdrawable RIGHT NOW = Sprout sitting in the wallet (1:1). Sprout staked for
  // voting must be unstaked from governance before it can redeem ALGO, so it's not
  // directly withdrawable here.
  const withdrawableMicro = algoPos?.principalMicro ?? 0
  // Your TOTAL ALGO in the pool = wallet Sprout + Sprout staked for voting. Both are
  // 1:1 claims on your deposited principal; staking Sprout for a vote moves the receipt
  // to the governance app but doesn't reduce what you have in the pool. Displaying only
  // the wallet balance made the pooled figure drop whenever Sprout was staked to vote.
  const algoStakedMicro = withdrawableMicro + sproutStakedMicro
  const hasSprout = sproutStakedMicro > 0
  const ranked = [...candidates].sort((a, b) => b.weightMicro - a.weightMicro)

  // ── ALGO (pool) actions ──
  async function doAlgoStake() {
    const micro = Math.round(Number(algoAmt) * MICRO)
    if (!micro || micro <= 0) { addToast('Enter an ALGO amount', 'error'); return }
    setBusy('algo-stake')
    try {
      await depositAlgo({ signTransactions, address: activeAddress, microAlgo: micro })
      addToast(`Staked ${algoAmt} ALGO to the pool`, 'success')
      setAlgoAmt(''); await reload()
    } catch (e) { addToast(e.message || 'Stake failed', 'error') } finally { setBusy('') }
  }
  async function doAlgoUnstake(micro) {
    if (!micro || micro <= 0) { addToast('Nothing to unstake', 'error'); return }
    setBusy('algo-unstake')
    try {
      // Withdraw returns ALGO 1:1 for the Sprout principal sent back (microSprout).
      await withdrawAlgo({ signTransactions, address: activeAddress, microSprout: micro })
      addToast('Unstaked ALGO', 'success')
      setAlgoAmt(''); await reload()
    } catch (e) { addToast(e.message || 'Unstake failed', 'error') } finally { setBusy('') }
  }

  // ── Sprout (vote weight) actions ──
  async function doSproutStake() {
    const micro = Math.round(Number(sproutAmt) * MICRO)
    if (!micro || micro <= 0) { addToast('Enter a SPROUT amount', 'error'); return }
    setBusy('sprout-stake')
    try {
      await stakeSprout({ signTransactions, address: activeAddress, microSprout: micro })
      addToast(`Staked ${sproutAmt} SPROUT for voting weight`, 'success')
      setSproutAmt(''); await reload()
    } catch (e) { addToast(e.message || 'Stake failed', 'error') } finally { setBusy('') }
  }
  async function doSproutUnstake(micro) {
    if (!micro || micro <= 0) { addToast('Nothing to unstake', 'error'); return }
    setBusy('sprout-unstake')
    try {
      await unstakeSprout({
        signTransactions, address: activeAddress, microSprout: micro,
        votedCandidateId: sprout?.hasVote ? sprout.votedCandidate : undefined,
      })
      addToast('Unstaked SPROUT', 'success')
      setSproutAmt(''); await reload()
    } catch (e) { addToast(e.message || 'Unstake failed', 'error') } finally { setBusy('') }
  }
  async function castVote() {
    if (!choice) { addToast('Choose a project', 'error'); return }
    setBusy('vote')
    try {
      await vote({
        signTransactions, address: activeAddress, candidateId: Number(choice),
        prevCandidateId: sprout?.hasVote ? sprout.votedCandidate : 0,
      })
      addToast(`Voted for ${nameFor(choice)}`, 'success'); await reload()
    } catch (e) { addToast(e.message || 'Vote failed', 'error') } finally { setBusy('') }
  }

  return (
    <div className="wrap" style={{ padding: '40px 32px 72px', maxWidth: 900 }}>
      <Link to="/fund" style={{ fontSize: 13, color: 'var(--text-muted)' }}>← Funding engine</Link>
      <h1 style={{ fontSize: 'clamp(30px, 4vw, 42px)', margin: '10px 0 0' }}>Stake &amp; vote</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 16, lineHeight: 1.6, marginTop: 12, maxWidth: 620 }}>
        Two ways to take part: stake <strong>ALGO</strong> to grow the prize pool, and stake
        <strong> Sprout</strong> to earn voting weight and vote on who wins. Neither is ever
        locked — withdraw any time.
      </p>

      <div style={{ margin: '22px 0 28px' }}>
        <CycleStatus variant="strip" onData={setStatus} />
      </div>

      {!activeAddress ? (
        <div className="card" style={{ padding: 22 }}>Connect a wallet to stake and vote.</div>
      ) : loading ? (
        <div className="card" style={{ padding: 22, color: 'var(--text-faint)' }}>Loading…</div>
      ) : (
        <div style={{ display: 'grid', gap: 22 }}>

          {/* ───────── Grow the pool: stake ALGO ───────── */}
          <section>
            <h2 style={{ fontSize: 22, margin: '0 0 4px' }}>Grow the pool</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 14px' }}>
              Stake ALGO into the reward escrow. This is what funds the prize pool that
              winners split. It does not give a vote — that's Sprout, below.
            </p>
            <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
              <div className="card" style={{ padding: 22, display: 'grid', gap: 14 }}>
                <div className="stat"><span className="stat-val">{fmtAlgo(algoStakedMicro / MICRO)} ALGO</span><span className="stat-lbl">Your ALGO in the pool</span></div>
                <div className="stat"><span className="stat-val" style={{ fontSize: 20 }}>{fmtAlgo(totalStakedMicro / MICRO)} ALGO</span><span className="stat-lbl">Total ALGO staked (all accounts)</span></div>
              </div>
              <div className="card" style={{ padding: 22, display: 'grid', gap: 12 }}>
                <div className="field">
                  <label>Amount (ALGO)</label>
                  <input className="input" inputMode="decimal" placeholder="0.0" value={algoAmt} onChange={e => setAlgoAmt(sanitizeAmount(e.target.value, algoAmt))} />
                </div>
                <button className="btn btn-primary btn-block" disabled={!!busy} onClick={doAlgoStake}>
                  {busy === 'algo-stake' ? 'Staking…' : 'Stake ALGO'}
                </button>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn btn-ghost btn-block" disabled={!!busy || withdrawableMicro === 0}
                          onClick={() => doAlgoUnstake(Math.round(Number(algoAmt) * MICRO))}>Unstake</button>
                  <button className="btn btn-ghost btn-block" disabled={!!busy || withdrawableMicro === 0}
                          onClick={() => doAlgoUnstake(withdrawableMicro)}>Unstake all</button>
                </div>
                {sproutStakedMicro > 0 && (
                  <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                    {fmtAlgo(sproutStakedMicro / MICRO)} ALGO of your pool is staked for voting — unstake your Sprout below to withdraw it.
                  </span>
                )}
              </div>
            </div>
          </section>

          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '4px 0' }} />

          {/* ───────── Vote: stake Sprout for weight, then vote ───────── */}
          <section>
            <h2 style={{ fontSize: 22, margin: '0 0 4px' }}>Vote on winners</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 14px' }}>
              Stake Sprout to earn voting weight, then back a ballot project. Your full
              staked Sprout backs one project; re-vote any time to switch.
            </p>

            <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
              {/* Sprout stake */}
              <div className="card" style={{ padding: 22, display: 'grid', gap: 12 }}>
                <div className="stat"><span className="stat-val">{fmtAlgo(sproutStakedMicro / MICRO)} SPROUT</span><span className="stat-lbl">Your voting weight (staked Sprout)</span></div>
                {sprout?.hasVote
                  ? <span className="badge badge-accent">Voting for {nameFor(sprout.votedCandidate)}</span>
                  : <span style={{ fontSize: 13, color: 'var(--text-faint)' }}>No active vote.</span>}
                <div className="field">
                  <label>Amount (SPROUT)</label>
                  <input className="input" inputMode="decimal" placeholder="0.0" value={sproutAmt} onChange={e => setSproutAmt(sanitizeAmount(e.target.value, sproutAmt))} />
                </div>
                <button className="btn btn-primary btn-block" disabled={!!busy} onClick={doSproutStake}>
                  {busy === 'sprout-stake' ? 'Staking…' : 'Stake Sprout'}
                </button>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn btn-ghost btn-block" disabled={!!busy || sproutStakedMicro === 0}
                          onClick={() => doSproutUnstake(Math.round(Number(sproutAmt) * MICRO))}>Unstake</button>
                  <button className="btn btn-ghost btn-block" disabled={!!busy || sproutStakedMicro === 0}
                          onClick={() => doSproutUnstake(sproutStakedMicro)}>Unstake all</button>
                </div>
              </div>

              {/* Ballot + cast */}
              <div className="card" style={{ padding: 22 }}>
                <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>The ballot</h3>

                {!votingOpen && (
                  <div style={{ marginBottom: 12 }}>
                    <span className="badge badge-warn"><span className="badge-dot" />Voting isn't open right now</span>
                    <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
                      {phaseKey === 'nominating'
                        ? <>Nominating the next ballot. <Link to="/directory" style={{ color: 'var(--accent)' }}>Nominate →</Link></>
                        : phaseKey === 'frozen' ? 'Votes are frozen, awaiting results.'
                        : phaseKey === 'between' ? 'No round open yet.'
                        : 'Results are being tallied.'}
                      {status?.deadline && phaseKey === 'nominating' && <> Voting opens in {status.deadline.label}.</>}
                    </p>
                  </div>
                )}

                {ranked.length === 0 ? (
                  <p style={{ color: 'var(--text-faint)', margin: 0, fontSize: 14 }}>No candidates this round yet.</p>
                ) : (
                  <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
                    {ranked.map((c, i) => {
                      const mine = sprout?.hasVote && Number(sprout.votedCandidate) === Number(c.id)
                      return (
                        <li key={c.id} style={{
                          display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px',
                          borderRadius: 'var(--r-sm)',
                          border: mine ? '1px solid var(--accent-line)' : '1px solid var(--border)',
                          background: mine ? 'var(--accent-soft)' : 'transparent',
                        }}>
                          <span style={{ width: 18, color: 'var(--text-faint)', fontWeight: 600, fontSize: 13 }}>{i + 1}</span>
                          <span style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{nameFor(c.id)}{mine && <span className="badge badge-accent" style={{ marginLeft: 6 }}>Yours</span>}</span>
                          <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)', fontSize: 13 }}>{fmtAlgo(c.weightMicro / MICRO)}</span>
                        </li>
                      )
                    })}
                  </ol>
                )}

                {votingOpen && hasSprout && ranked.length > 0 && (
                  <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
                    <select className="input" value={choice} onChange={e => setChoice(e.target.value)}>
                      <option value="">— choose a project —</option>
                      {ranked.map(c => <option key={c.id} value={c.id}>{nameFor(c.id)}</option>)}
                    </select>
                    <button className="btn btn-primary" disabled={!!busy || !choice} onClick={castVote}>
                      {busy === 'vote' ? 'Voting…' : sprout?.hasVote ? 'Change my vote' : 'Cast vote'}
                    </button>
                  </div>
                )}
                {votingOpen && !hasSprout && (
                  <p style={{ marginTop: 12, fontSize: 13, color: 'var(--text-muted)' }}>
                    Stake Sprout (left) to get voting weight, then vote.
                  </p>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
