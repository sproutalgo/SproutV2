import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useWallet } from '@txnlab/use-wallet-react'
import { fetchMyDirectoryEntries } from '../utils/api'
import { shortAddr } from '../components/UI'

const STATUS_STYLE = {
  approved: { bg: 'var(--success-soft)', fg: 'var(--success)', label: 'Approved · live' },
  pending:  { bg: 'var(--surface-2)',    fg: 'var(--text-muted)', label: 'Pending review' },
  rejected: { bg: 'var(--danger-soft)',  fg: 'var(--danger)', label: 'Not approved' },
}

export default function DirectoryMine() {
  const { activeAddress } = useWallet()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!activeAddress) { setEntries([]); return }
    let cancelled = false
    setLoading(true)
    fetchMyDirectoryEntries(activeAddress)
      .then(list => { if (!cancelled) setEntries(Array.isArray(list) ? list : []) })
      .catch(() => { if (!cancelled) setEntries([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [activeAddress])

  return (
    <div className="section wrap" style={{ maxWidth: 820 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 28, letterSpacing: '-0.02em' }}>My directory listings</h1>
        <Link to="/directory/submit" className="btn btn-primary">List another project</Link>
      </div>

      {!activeAddress ? (
        <div className="card" style={{ padding: 14, color: 'var(--text-muted)' }}>Connect your wallet to see your listings.</div>
      ) : loading ? (
        <div style={{ color: 'var(--text-muted)', padding: 20 }}>Loading…</div>
      ) : entries.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
          You haven’t listed any projects yet. <Link to="/directory/submit">List one now →</Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {entries.map(e => {
            const s = STATUS_STYLE[e.status] || STATUS_STYLE.pending
            return (
              <div key={e.id} className="card" style={{ padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 16 }}>{e.name}</div>
                  {e.tagline && <div style={{ color: 'var(--text-muted)', fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.tagline}</div>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                  <span style={{ background: s.bg, color: s.fg, padding: '4px 10px', borderRadius: 'var(--r-sm)', fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {s.label}
                  </span>
                  {(e.status === 'approved' || e.status === 'pending') && (
                    <Link to={`/directory/${e.id}/edit`} className="btn btn-ghost btn-sm">Edit</Link>
                  )}
                  {e.status === 'approved' && <Link to={`/directory/${e.id}`} className="btn btn-ghost btn-sm">View</Link>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
