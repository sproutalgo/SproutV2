import React, { useEffect, useState, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useWallet } from '@txnlab/use-wallet-react'
import { useToast } from '../context/ToastContext'
import {
  fetchDirectory, fetchNominationTally, fetchMyNomination,
  castNomination, withdrawNomination,
} from '../utils/api'
import DirectoryCard from '../components/DirectoryCard'
import { SkeletonCard } from '../components/UI'

const CATEGORIES = ['DeFi', 'RWA', 'AI', 'NFT', 'Gaming', 'Infrastructure', 'Social', 'Other']

// The directory is the funding engine's candidate roster: the community nominates
// projects here, the top 8 become each round's on-chain ballot. Each card carries its
// live nomination count and a nominate button (one vote per wallet, changeable). All the
// existing directory behavior — search, filter, list a project — is preserved.
export default function Directory() {
  const navigate = useNavigate()
  const { activeAddress, signTransactions } = useWallet()
  const { addToast } = useToast()

  const [entries, setEntries] = useState([])
  const [counts, setCounts]   = useState({})       // directory_entry_id -> votes
  const [round, setRound]     = useState(null)
  const [myVote, setMyVote]   = useState(null)      // directory_entry_id I'm backing
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [filter, setFilter]   = useState('All')
  const [search, setSearch]   = useState('')
  const [busyId, setBusyId]   = useState(null)

  const loadNominations = useCallback(async () => {
    try {
      const tally = await fetchNominationTally()
      setRound(tally.round)
      const m = {}
      for (const t of tally.tally || []) m[t.directory_entry_id] = t.votes
      setCounts(m)
      if (activeAddress) {
        const mine = await fetchMyNomination(activeAddress).catch(() => null)
        setMyVote(mine?.directory_entry_id ?? null)
      } else {
        setMyVote(null)
      }
    } catch { /* nomination layer is non-fatal to the directory */ }
  }, [activeAddress])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchDirectory({ page: 1, pageSize: 100 })
      .then(res => { if (!cancelled) { setEntries(res.entries ?? []); setError(null) } })
      .catch(e => { if (!cancelled) setError(e.message || 'Failed to load directory') })
      .finally(() => { if (!cancelled) setLoading(false) })
    loadNominations()
    return () => { cancelled = true }
  }, [loadNominations])

  async function nominate(entry) {
    if (!activeAddress) { addToast('Connect a wallet to nominate', 'error'); return }
    setBusyId(entry.id)
    try {
      await castNomination({ address: activeAddress, directoryEntryId: entry.id, signTransactions })
      addToast(`Nominated ${entry.name}`, 'success')
      await loadNominations()
    } catch (e) {
      addToast(e.message || 'Nomination failed', 'error')
    } finally { setBusyId(null) }
  }

  async function clearVote() {
    setBusyId('clear')
    try {
      await withdrawNomination({ address: activeAddress, signTransactions })
      addToast('Nomination withdrawn', 'success')
      await loadNominations()
    } catch (e) {
      addToast(e.message || 'Withdraw failed', 'error')
    } finally { setBusyId(null) }
  }

  const visible = entries
    .filter(e => filter === 'All' || (e.category || 'Other') === filter)
    .filter(e => {
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return (e.name || '').toLowerCase().includes(q) ||
             (e.tagline || '').toLowerCase().includes(q) ||
             (e.description || '').toLowerCase().includes(q)
    })
    // Sort by nomination count desc so the current shortlist floats to the top.
    .sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0))

  const catCounts = {}
  for (const e of entries) { const c = e.category || 'Other'; catCounts[c] = (catCounts[c] || 0) + 1 }
  const chips = CATEGORIES.filter(c => (catCounts[c] || 0) > 0 || c === filter)

  // Rank for the top-8 badge (by nomination count, only counting nominated projects).
  const ranked = [...entries].filter(e => (counts[e.id] || 0) > 0)
    .sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0))
  const topEight = new Set(ranked.slice(0, 8).map(e => e.id))

  return (
    <section className="section wrap">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, letterSpacing: '-0.02em' }}>Project Directory</h1>
          <p style={{ margin: '6px 0 0', color: 'var(--text-muted)', fontSize: 15, maxWidth: 580 }}>
            The candidate roster for the <Link to="/fund" style={{ color: 'var(--accent)' }}>funding engine</Link>.
            Back a project to help build the next ballot — one vote per wallet, change it anytime.
            {round != null && <> Nominating for round {round}.</>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Link to="/directory/mine" className="btn btn-ghost">My listings</Link>
          <button className="btn btn-primary" onClick={() => navigate('/directory/submit')}>
            List your project
          </button>
        </div>
      </div>

      {myVote && (
        <div style={{ marginBottom: 16 }}>
          <button className="btn btn-ghost btn-sm" disabled={busyId === 'clear'} onClick={clearVote}>
            {busyId === 'clear' ? 'Withdrawing…' : 'Withdraw my nomination'}
          </button>
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        <input className="input" placeholder="Search the directory…"
               value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 360 }} />
      </div>

      <div className="filters" style={{ marginBottom: 24 }}>
        <button className={`chip${filter === 'All' ? ' active' : ''}`} onClick={() => setFilter('All')}>All</button>
        {chips.map(c => (
          <button key={c} className={`chip${filter === c ? ' active' : ''}`} onClick={() => setFilter(c)}>{c}</button>
        ))}
      </div>

      {error && <div className="card" style={{ marginBottom: 16, padding: 14, color: 'var(--danger)', borderColor: 'var(--danger)' }}>{error}</div>}

      {loading ? (
        <div className="grid-cards">{Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}</div>
      ) : visible.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
          {entries.length === 0
            ? 'No projects in the directory yet. Be the first to list one!'
            : 'No projects match your filter.'}
        </div>
      ) : (
        <div className="grid-cards">
          {visible.map(e => (
            <div key={e.id} style={{ display: 'flex', flexDirection: 'column' }}>
              <DirectoryCard entry={e} />
              {/* Nominate bar — the directory's engine role, folded onto each card. */}
              <div className="card" style={{
                marginTop: -8, borderTop: 'none', borderTopLeftRadius: 0, borderTopRightRadius: 0,
                padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                  {counts[e.id] || 0}
                </span>
                <span style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>
                  nomination{(counts[e.id] || 0) === 1 ? '' : 's'}
                </span>
                {topEight.has(e.id) && <span className="badge badge-accent">Top 8</span>}
                <span style={{ flex: 1 }} />
                <button
                  className={myVote === e.id ? 'btn btn-primary btn-sm' : 'btn btn-soft btn-sm'}
                  disabled={!activeAddress || busyId === e.id || myVote === e.id}
                  onClick={() => nominate(e)}>
                  {busyId === e.id ? '…' : myVote === e.id ? 'Nominated' : 'Nominate'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
