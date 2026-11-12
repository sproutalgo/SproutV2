import React, { useState, useEffect, useCallback } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import { useToast } from '../context/ToastContext'
import {
  fetchNominationTally, fetchMyNomination,
  castNomination, withdrawNomination,
} from '../utils/api'

// Community nomination voting (off-chain). One wallet = one vote = one project,
// changeable anytime. The tally is public and live; the admin reads the top 8 and
// registers them on-chain, then resets to start a fresh round.
export default function Nominations() {
  const { activeAddress, signTransactions } = useWallet()
  const { addToast } = useToast()

  const [round, setRound] = useState(null)
  const [totalVotes, setTotalVotes] = useState(0)
  const [tally, setTally] = useState([])
  const [myVote, setMyVote] = useState(null)      // directory_entry_id this wallet backs
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)      // project being voted on

  const load = useCallback(async () => {
    try {
      const t = await fetchNominationTally()
      setRound(t.round)
      setTotalVotes(t.totalVotes)
      setTally(t.tally)
      if (activeAddress) {
        const mine = await fetchMyNomination(activeAddress)
        setMyVote(mine?.directory_entry_id ?? null)
      } else {
        setMyVote(null)
      }
    } catch (e) {
      addToast(e.message || 'Failed to load nominations', 'error')
    } finally {
      setLoading(false)
    }
  }, [activeAddress, addToast])

  useEffect(() => { load() }, [load])

  async function vote(entry) {
    if (!activeAddress) { addToast('Connect a wallet to vote', 'error'); return }
    setBusyId(entry.directory_entry_id)
    try {
      await castNomination({ address: activeAddress, directoryEntryId: entry.directory_entry_id, signTransactions })
      addToast(`Voted for ${entry.name}`, 'success')
      await load()
    } catch (e) {
      addToast(e.message || 'Vote failed', 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function clearVote() {
    if (!activeAddress) return
    setBusyId('clear')
    try {
      await withdrawNomination({ address: activeAddress, signTransactions })
      addToast('Vote withdrawn', 'success')
      await load()
    } catch (e) {
      addToast(e.message || 'Withdraw failed', 'error')
    } finally {
      setBusyId(null)
    }
  }

  const topEight = new Set(
    tally.filter(t => t.votes > 0).slice(0, 8).map(t => t.directory_entry_id)
  )

  return (
    <div className="nominations-page" style={{ maxWidth: 820, margin: '0 auto', padding: '24px 16px' }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>Nominate the next ballot</h1>
        <p style={{ color: 'var(--text-muted)', marginTop: 8 }}>
          Connect your wallet and back one project. The top 8 get put forward to the admin
          for the next on-chain funding round. One vote per wallet — change it anytime.
        </p>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {round != null && <>Round {round} · </>}{totalVotes} vote{totalVotes === 1 ? '' : 's'} cast
          {myVote && <> · you're backing a project below</>}
        </div>
      </header>

      {!activeAddress && (
        <div className="notice" style={{ padding: 12, borderRadius: 8, background: 'var(--surface-2, #f3f3f3)', marginBottom: 16 }}>
          Connect a wallet to vote. You can still see the live standings below.
        </div>
      )}

      {myVote && (
        <button className="btn btn-ghost" disabled={busyId === 'clear'} onClick={clearVote} style={{ marginBottom: 16 }}>
          {busyId === 'clear' ? 'Withdrawing…' : 'Withdraw my vote'}
        </button>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : tally.length === 0 ? (
        <p>No approved projects to nominate yet.</p>
      ) : (
        <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
          {tally.map((t, i) => {
            const mine = myVote === t.directory_entry_id
            const inTop8 = topEight.has(t.directory_entry_id)
            return (
              <li key={t.directory_entry_id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px',
                    borderRadius: 10, border: mine ? '2px solid var(--accent, #2d7)' : '1px solid var(--border, #e3e3e3)',
                    background: inTop8 ? 'var(--surface-2, #f7faf7)' : 'transparent',
                  }}>
                <div style={{ fontSize: 20, fontWeight: 700, width: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
                  {i + 1}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>
                    {t.name}
                    {inTop8 && <span style={{ fontSize: 11, marginLeft: 8, padding: '2px 6px', borderRadius: 6, background: 'var(--accent, #2d7)', color: '#fff' }}>TOP 8</span>}
                  </div>
                  {t.tagline && <div style={{ fontSize: 13, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.tagline}</div>}
                </div>
                <div style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, minWidth: 48, textAlign: 'right' }}>
                  {t.votes}
                </div>
                <button
                  className={mine ? 'btn btn-primary' : 'btn'}
                  disabled={!activeAddress || busyId === t.directory_entry_id || mine}
                  onClick={() => vote(t)}
                  style={{ minWidth: 92 }}>
                  {busyId === t.directory_entry_id ? '…' : mine ? 'Your vote' : 'Vote'}
                </button>
              </li>
            )
          })}
        </ol>
      )}

      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 20 }}>
        Highlighted rows are the current top 8. Standings are advisory — the admin reviews
        them before registering projects for the on-chain funding vote.
      </p>
    </div>
  )
}
