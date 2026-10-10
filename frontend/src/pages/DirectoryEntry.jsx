import React, { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { fetchDirectoryEntry } from '../utils/api'
import { Cover, categoryHue, shortAddr } from '../components/UI'

export default function DirectoryEntry() {
  const { id } = useParams()
  const [entry, setEntry]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchDirectoryEntry(id)
      .then(e => { if (!cancelled) setEntry(e) })
      .catch(e => { if (!cancelled) setError(e.message || 'Not found') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id])

  if (loading) return <div className="container" style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</div>
  if (error || !entry) return (
    <div className="container" style={{ padding: 40 }}>
      <Link to="/directory" className="back-link">← Back to directory</Link>
      <p style={{ color: 'var(--text-muted)', marginTop: 20 }}>This listing couldn’t be found.</p>
    </div>
  )

  const hue = categoryHue(entry.category)
  const highlights = Array.isArray(entry.highlights) ? entry.highlights.filter(Boolean) : []

  return (
    <div className="container" style={{ paddingTop: 24, paddingBottom: 64, maxWidth: 820 }}>
      <Link to="/directory" className="back-link" style={{ display: 'inline-block', marginBottom: 16, color: 'var(--text-muted)' }}>
        ← Back to directory
      </Link>

      <Cover hue={hue} label={entry.name} imageUrl={entry.image_url} style={{ borderRadius: 'var(--r-md)', marginBottom: 20 }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {entry.category && <span className="chip">{entry.category}</span>}
        <span className="chip" style={{ background: 'var(--surface-2)' }}>Directory listing</span>
      </div>

      <h1 style={{ margin: '14px 0 6px', fontSize: 32, letterSpacing: '-0.02em' }}>{entry.name}</h1>
      {entry.tagline && <p style={{ margin: 0, fontSize: 17, color: 'var(--text-muted)' }}>{entry.tagline}</p>}

      <div style={{ margin: '16px 0', fontSize: 13.5, color: 'var(--text-faint)' }}>
        Listed by {shortAddr(entry.wallet_address)}
      </div>

      {entry.website_url && (
        <a href={entry.website_url} target="_blank" rel="noopener noreferrer" className="btn btn-soft" style={{ marginBottom: 24, display: 'inline-block' }}>
          Visit website ↗
        </a>
      )}

      {highlights.length > 0 && (
        <div style={{ margin: '24px 0' }}>
          <h3 style={{ fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>Highlights</h3>
          <ul style={{ paddingLeft: 20, lineHeight: 1.7 }}>
            {highlights.map((h, i) => <li key={i}>{h}</li>)}
          </ul>
        </div>
      )}

      {entry.description && (
        <div style={{ margin: '24px 0' }}>
          <h3 style={{ fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>About</h3>
          <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{entry.description}</p>
        </div>
      )}
    </div>
  )
}
