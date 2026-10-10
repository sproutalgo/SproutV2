import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { fetchDirectory } from '../utils/api'
import DirectoryCard from '../components/DirectoryCard'
import { SkeletonCard } from '../components/UI'

const CATEGORIES = ['DeFi', 'RWA', 'AI', 'NFT', 'Gaming', 'Infrastructure', 'Social', 'Other']

export default function Directory() {
  const navigate = useNavigate()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [filter, setFilter]   = useState('All')
  const [search, setSearch]   = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchDirectory({ page: 1, pageSize: 100 })
      .then(res => { if (!cancelled) { setEntries(res.entries ?? []); setError(null) } })
      .catch(e => { if (!cancelled) setError(e.message || 'Failed to load directory') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const visible = entries
    .filter(e => filter === 'All' || (e.category || 'Other') === filter)
    .filter(e => {
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return (e.name || '').toLowerCase().includes(q) ||
             (e.tagline || '').toLowerCase().includes(q) ||
             (e.description || '').toLowerCase().includes(q)
    })

  const catCounts = {}
  for (const e of entries) { const c = e.category || 'Other'; catCounts[c] = (catCounts[c] || 0) + 1 }
  const chips = CATEGORIES.filter(c => (catCounts[c] || 0) > 0 || c === filter)

  return (
    <div className="container" style={{ paddingTop: 24, paddingBottom: 64 }}>
      {/* Campaigns | Directory tabs */}
      <div className="filters" style={{ marginBottom: 20, display: 'flex', gap: 8 }}>
        <Link to="/" className="chip">Campaigns</Link>
        <span className="chip active">Directory</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, letterSpacing: '-0.02em' }}>Project Directory</h1>
          <p style={{ margin: '6px 0 0', color: 'var(--text-muted)', fontSize: 15, maxWidth: 560 }}>
            A free directory of Algorand projects. Not a funding campaign — just a place to be discovered.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/directory/submit')}>
          List your project
        </button>
      </div>

      <div style={{ marginBottom: 20 }}>
        <input
          className="input"
          placeholder="Search the directory…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: 360 }}
        />
      </div>

      <div className="filters" style={{ marginBottom: 24 }}>
        <button className={`chip${filter === 'All' ? ' active' : ''}`} onClick={() => setFilter('All')}>All</button>
        {chips.map(c => (
          <button key={c} className={`chip${filter === c ? ' active' : ''}`} onClick={() => setFilter(c)}>{c}</button>
        ))}
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

      {loading ? (
        <div className="grid">{Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}</div>
      ) : visible.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
          {entries.length === 0
            ? 'No projects in the directory yet. Be the first to list one!'
            : 'No projects match your filter.'}
        </div>
      ) : (
        <div className="grid">
          {visible.map(e => <DirectoryCard key={e.id} entry={e} />)}
        </div>
      )}
    </div>
  )
}
