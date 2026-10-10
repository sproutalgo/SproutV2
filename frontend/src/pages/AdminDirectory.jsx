import React, { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useWallet } from '@txnlab/use-wallet-react'
import { useToast } from '../context/ToastContext'
import { ADMIN_ADDRESS } from '../utils/algorand'
import { fetchPendingDirectoryEntries, setDirectoryEntryStatus } from '../utils/api'
import { shortAddr } from '../components/UI'

export default function AdminDirectory() {
  const { activeAddress, signTransactions } = useWallet()
  const { addToast } = useToast()
  const [entries, setEntries]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [actioningId, setActioningId] = useState(null)
  const isAdmin = activeAddress === ADMIN_ADDRESS

  const load = useCallback(async () => {
    if (!activeAddress || !isAdmin) { setLoading(false); return }
    setLoading(true)
    try {
      const list = await fetchPendingDirectoryEntries({ address: activeAddress, signTransactions })
      setEntries(Array.isArray(list) ? list : [])
    } catch (e) {
      addToast(e.message || 'Failed to load pending entries', 'error')
    } finally {
      setLoading(false)
    }
  }, [activeAddress, isAdmin, signTransactions, addToast])

  useEffect(() => { load() }, [load])

  async function review(id, status) {
    setActioningId(id)
    try {
      await setDirectoryEntryStatus({ address: activeAddress, id, status, signTransactions })
      addToast(status === 'approved' ? 'Entry approved — now live.' : 'Entry rejected.', 'success')
      setEntries(prev => prev.filter(e => e.id !== id))
    } catch (e) {
      addToast(e.message || 'Action failed', 'error')
    } finally {
      setActioningId(null)
    }
  }

  if (!activeAddress) return <div className="container" style={{ padding: 40 }}><div className="alert">Connect your wallet.</div></div>
  if (!isAdmin) return <div className="container" style={{ padding: 40 }}><div className="alert alert-error">Not authorized.</div></div>

  return (
    <div className="container" style={{ paddingTop: 24, paddingBottom: 64, maxWidth: 900 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 28, letterSpacing: '-0.02em' }}>Directory review queue</h1>
        <Link to="/admin" className="btn btn-ghost btn-sm">← Campaign admin</Link>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-muted)', padding: 20 }}>Loading…</div>
      ) : entries.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
          No entries waiting for review. 🎉
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {entries.map(e => (
            <div key={e.id} className="card" style={{ padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 18 }}>{e.name}</span>
                    {e.category && <span className="chip" style={{ fontSize: 11 }}>{e.category}</span>}
                  </div>
                  {e.tagline && <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>{e.tagline}</div>}
                  <div style={{ fontSize: 12.5, color: 'var(--text-faint)', marginTop: 6 }}>
                    by {shortAddr(e.wallet_address)}
                    {e.website_url && <> · <a href={e.website_url} target="_blank" rel="noopener noreferrer">{e.website_url.replace(/^https?:\/\//, '')}</a></>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexShrink: 0 }}>
                  <button className="btn btn-primary btn-sm" disabled={actioningId === e.id} onClick={() => review(e.id, 'approved')}>
                    {actioningId === e.id ? '…' : 'Approve'}
                  </button>
                  <button className="btn btn-ghost btn-sm" disabled={actioningId === e.id} onClick={() => review(e.id, 'rejected')}>
                    Reject
                  </button>
                </div>
              </div>

              {Array.isArray(e.highlights) && e.highlights.filter(Boolean).length > 0 && (
                <ul style={{ margin: '12px 0 0', paddingLeft: 20, color: 'var(--text-muted)', fontSize: 14 }}>
                  {e.highlights.filter(Boolean).map((h, i) => <li key={i}>{h}</li>)}
                </ul>
              )}
              {e.description && (
                <p style={{ margin: '12px 0 0', fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}>
                  {e.description}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
