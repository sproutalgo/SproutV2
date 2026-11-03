// Stake.jsx — test interface for the live staking escrow. Opt in, deposit ALGO
// (mints Sprout 1:1), see your position + pool stats, withdraw principal.
//
// Route it at e.g. /admin/stake while testing. Reads the live App ID + ASA ID from
// VITE_ESCROW_APP_ID / VITE_SPROUT_ASA_ID via stakingChain.

import React, { useEffect, useMemo, useState, useRef } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import { useToast } from '../context/ToastContext'
import {
  optInSprout, deposit, withdraw,
  fetchMyPosition, fetchEscrowStats, IDS,
} from '../utils/stakingChain'

const MICRO = 1_000_000
const toAlgo = (m) => (Number(m || 0) / MICRO).toLocaleString(undefined, { maximumFractionDigits: 2 })

export default function Stake() {
  const { activeAddress, signTransactions } = useWallet()
  const { addToast } = useToast()

  const [pos, setPos] = useState(null)
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [amount, setAmount] = useState('')

  const addrRef = useRef(activeAddress); addrRef.current = activeAddress

  async function load() {
    try {
      setLoading(true)
      const [s, me] = await Promise.all([
        fetchEscrowStats(),
        addrRef.current ? fetchMyPosition(addrRef.current) : Promise.resolve(null),
      ])
      setStats(s); setPos(me)
    } catch (e) {
      addToast(String(e?.message ?? e ?? 'Could not load'), 'error', 8000)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [activeAddress])

  const amountMicro = useMemo(() => {
    const n = Number(amount)
    return Number.isFinite(n) && n > 0 ? Math.round(n * MICRO) : 0
  }, [amount])

  function requireWallet() {
    if (!activeAddress) { addToast('Connect your wallet first', 'info'); return false }
    return true
  }
  async function run(label, fn) {
    if (!requireWallet()) return
    try { setBusy(label); await fn(); addToast('Done', 'success'); await load() }
    catch (e) { addToast(String(e?.message ?? e ?? 'Transaction failed'), 'error', 9000) }
    finally { setBusy('') }
  }

  const onOptIn = () => run('optin', async () => {
    const sent = await optInSprout({ signTransactions, address: activeAddress })
    if (!sent) addToast('Already opted in', 'info')
  })
  const onDeposit = () => run('deposit', () => {
    if (!amountMicro) throw new Error('Enter an ALGO amount')
    return deposit({ signTransactions, address: activeAddress, microAlgo: amountMicro })
  })
  const onWithdraw = () => run('withdraw', () => {
    if (!amountMicro) throw new Error('Enter an amount to withdraw')
    if (pos && amountMicro > pos.principalMicro) throw new Error('More than your staked principal')
    return withdraw({ signTransactions, address: activeAddress, microSprout: amountMicro })
  })
  const setMax = () => setAmount(pos ? String(pos.principalMicro / MICRO) : '')

  if (loading) {
    return <section className="section wrap" style={{ maxWidth: 720 }}><div style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</div></section>
  }

  return (
    <section className="section wrap" style={{ maxWidth: 720 }}>
      <h1 style={{ margin: '0 0 6px', fontSize: 28, letterSpacing: '-0.02em' }}>Stake ALGO (test)</h1>
      <p style={{ margin: '0 0 8px', color: 'var(--text-muted)', fontSize: 15 }}>
        Deposit ALGO into the escrow and receive Sprout 1:1. Withdraw your principal any time.
      </p>
      <p style={{ margin: '0 0 24px', color: 'var(--text-faint)', fontSize: 12 }}>
        Escrow App {IDS.ESCROW_APP_ID} · Sprout ASA {IDS.SPROUT_ASA_ID}
      </p>

      {(!IDS.ESCROW_APP_ID || !IDS.SPROUT_ASA_ID) && (
        <div className="card" style={{ padding: 14, marginBottom: 20, color: 'var(--danger)' }}>
          VITE_ESCROW_APP_ID / VITE_SPROUT_ASA_ID aren't set. Add them to your env and rebuild.
        </div>
      )}

      {/* Pool-wide stats */}
      <div className="card" style={{ padding: 18, marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
          <Stat label="Total staked" value={`${toAlgo(stats?.principalMicro)} ALGO`} />
          <Stat label="Yield awaiting harvest" value={`${toAlgo(stats?.surplusMicro)} ALGO`} />
          <Stat label="Escrow balance" value={`${toAlgo(stats?.balanceMicro)} ALGO`} />
        </div>
      </div>

      {/* Your position */}
      <div className="card" style={{ padding: 18, marginBottom: 20 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Your position</h2>
        {!activeAddress ? (
          <p style={{ color: 'var(--text-muted)' }}>Connect your wallet to see your balance.</p>
        ) : (
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
            <Stat label="Your principal" value={`${toAlgo(pos?.principalMicro)} ALGO`} />
            <Stat label="Sprout held" value={`${toAlgo(pos?.sproutMicro)} SPRT`} />
            <Stat label="Opted in" value={pos?.optedIn ? 'Yes' : 'No'} />
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="card form-card">
        <div className="form-stack">
          {activeAddress && pos && !pos.optedIn && (
            <div className="card" style={{ padding: 12, fontSize: 14, color: 'var(--text-muted)' }}>
              You're not opted into Sprout yet. Depositing opts you in automatically, or do it now:
              <button className="btn btn-ghost" style={{ marginLeft: 10 }} disabled={!!busy} onClick={onOptIn}>
                {busy === 'optin' ? 'Opting in…' : 'Opt in to Sprout'}
              </button>
            </div>
          )}

          <div className="field">
            <label htmlFor="s-amount">Amount (ALGO)</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input id="s-amount" className="input" inputMode="decimal" placeholder="e.g. 10"
                value={amount} onChange={e => setAmount(e.target.value)} style={{ flex: 1 }} />
              <button className="btn btn-ghost" type="button" onClick={setMax} disabled={!pos?.principalMicro}>Max</button>
            </div>
            <span className="field-hint">1 ALGO ⇄ 1 Sprout. Deposit mints Sprout; withdraw burns it back to ALGO.</span>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" disabled={!!busy} onClick={onDeposit}>
              {busy === 'deposit' ? 'Depositing…' : 'Deposit ALGO'}
            </button>
            <button className="btn btn-ghost" disabled={!!busy} onClick={onWithdraw}>
              {busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw principal'}
            </button>
            <button className="btn btn-ghost" disabled={!!busy} onClick={load}>Refresh</button>
          </div>
        </div>
      </div>
    </section>
  )
}

function Stat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
    </div>
  )
}
