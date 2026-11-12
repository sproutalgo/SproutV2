import React, { useEffect, useState, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useWallet } from '@txnlab/use-wallet-react'
import { useToast } from '../context/ToastContext'
import { ADMIN_ADDRESS } from '../utils/algorand'
import { fetchNominationShortlist, resetNominations } from '../utils/api'
import { shortAddr } from '../components/UI'

// Admin view of the community nomination tally: the top-8 shortlist (with payout
// addresses) to register on-chain, and a Reset button that starts a fresh round.
export default function AdminNominations() {
  const { activeAddress, signTransactions } = useWallet()
  const { addToast } = useToast()
  const [round, setRound]     = useState(null)
  const [top, setTop]         = useState([])
  const [tie, setTie]         = useState(false)
  const [loading, setLoading] = useState(true)
  const [resetting, setResetting] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const isAdmin = activeAddress === ADMIN_ADDRESS

  // signTransactions / addToast change reference each render; read them via refs so the
  // load effect doesn't re-run and trigger an endless signature-prompt loop (same
  // pattern as AdminDirectory).
  const signRef  = useRef(signTransactions)
  const toastRef = useRef(addToast)
  useEffect(() => { signRef.current = signTransactions }, [signTransactions])
  useEffect(() => { toastRef.current = addToast }, [addToast])

  const reload = useCallback(async () => {
    if (!activeAddress || !isAdmin) { setLoading(false); return }
    setLoading(true)
    try {
      const { round, top, tie } = await fetchNominationShortlist({
        address: activeAddress, signTransactions: signRef.current, n: 8,
      })
      setRound(round)
      setTop(Array.isArray(top) ? top : [])
      setTie(!!tie)
    } catch (e) {
      toastRef.current(e.message || 'Failed to load shortlist', 'error')
    } finally {
      setLoading(false)
    }
  }, [activeAddress, isAdmin])

  useEffect(() => {
    if (!activeAddress || !isAdmin) { setLoading(false); return }
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAddress, isAdmin])

  async function doReset() {
    setResetting(true)
    try {
      const res = await resetNominations({ address: activeAddress, signTransactions: signRef.current })
      addToast(`Tally reset — now on round ${res.currentRound}`, 'success')
      setConfirming(false)
      await reload()
    } catch (e) {
      addToast(e.message || 'Reset failed', 'error')
    } finally {
      setResetting(false)
    }
  }

  if (!activeAddress) {
    return <div style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}>Connect your admin wallet.</div>
  }
  if (!isAdmin) {
    return <div style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}>Not authorized.</div>
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 16px' }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>Nomination shortlist (admin)</h1>
        <p style={{ color: 'var(--text-muted)', marginTop: 8 }}>
          The current community top 8, with payout addresses. Register these on-chain in
          the <Link to="/admin/voting">voting admin</Link>, then reset to start a fresh
          nomination round.
        </p>
        {round != null && (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Current round: {round}</div>
        )}
      </header>

      {tie && (
        <div style={{ padding: 12, borderRadius: 8, background: 'var(--surface-2, #fff8e6)', border: '1px solid #e8c766', marginBottom: 14, fontSize: 14 }}>
          <strong>Tie at the cutoff.</strong> {top.length} projects are shown because some
          are tied with 8th place on votes. Only 8 can go on the on-chain ballot — the
          tied rows (marked below) are yours to choose among.
        </div>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : top.length === 0 ? (
        <p>No votes cast this round yet.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border, #e3e3e3)' }}>
              <th style={{ padding: '8px 6px', width: 36 }}>#</th>
              <th style={{ padding: '8px 6px' }}>Project</th>
              <th style={{ padding: '8px 6px', width: 64 }}>Cand #</th>
              <th style={{ padding: '8px 6px', width: 64, textAlign: 'right' }}>Votes</th>
              <th style={{ padding: '8px 6px' }}>Payout</th>
            </tr>
          </thead>
          <tbody>
            {top.map((t) => (
              <tr key={t.directory_entry_id}
                  style={{
                    borderBottom: '1px solid var(--border, #f0f0f0)',
                    background: t.tiedAtCutoff ? 'var(--surface-2, #fff8e6)' : 'transparent',
                  }}>
                <td style={{ padding: '8px 6px', color: 'var(--text-muted)' }}>{t.rank}</td>
                <td style={{ padding: '8px 6px', fontWeight: 600 }}>
                  {t.name}
                  {t.tiedAtCutoff && <span style={{ fontSize: 11, marginLeft: 8, padding: '2px 6px', borderRadius: 6, background: '#e8c766', color: '#000' }}>TIED — over 8</span>}
                </td>
                <td style={{ padding: '8px 6px' }}>{t.candidate_number ?? '—'}</td>
                <td style={{ padding: '8px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{t.votes}</td>
                <td style={{ padding: '8px 6px', fontFamily: 'monospace', fontSize: 12 }}>
                  {t.payout_address ? shortAddr(t.payout_address) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--border, #e3e3e3)' }}>
        <h3 style={{ margin: '0 0 8px' }}>Reset the tally</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 0 }}>
          Starts a fresh nomination round. The public tally clears and voters re-nominate.
          Past votes are kept as history (round {round}). Do this after you've registered
          this round's shortlist on-chain.
        </p>
        {!confirming ? (
          <button className="btn" onClick={() => setConfirming(true)}>Reset tally…</button>
        ) : (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 14 }}>Start round {round != null ? round + 1 : '?'}? This clears the live standings.</span>
            <button className="btn btn-primary" disabled={resetting} onClick={doReset}>
              {resetting ? 'Resetting…' : 'Confirm reset'}
            </button>
            <button className="btn btn-ghost" disabled={resetting} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  )
}
