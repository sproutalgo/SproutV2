import React, { useState, useEffect } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useWallet } from '@txnlab/use-wallet-react'
import { useToast } from '../context/ToastContext'
import { submitDirectoryEntry, updateDirectoryEntry, fetchDirectoryEntry } from '../utils/api'
import ImageUpload from '../components/ImageUpload'

const CATEGORIES = ['DeFi', 'RWA', 'AI', 'NFT', 'Gaming', 'Infrastructure', 'Social', 'Other']

function websiteError(url) {
  if (!url || !url.trim()) return null
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Must start with http:// or https://'
    return null
  } catch { return 'Enter a valid URL (including https://)' }
}

export default function DirectorySubmit() {
  const navigate = useNavigate()
  const { id } = useParams()            // present when editing an existing listing
  const isEdit = !!id
  const { activeAddress } = useWallet()
  const { addToast } = useToast()

  const [form, setForm] = useState({
    name: '', tagline: '', description: '', category: 'DeFi',
    highlights: ['', '', ''], websiteUrl: '', imageUrl: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading]       = useState(isEdit)
  const [loadError, setLoadError]   = useState(null)

  // In edit mode, load the existing entry to pre-fill the form.
  useEffect(() => {
    if (!isEdit) return
    let cancelled = false
    setLoading(true)
    fetchDirectoryEntry(id)
      .then(entry => {
        if (cancelled || !entry) return
        const hi = Array.isArray(entry.highlights) ? entry.highlights.filter(Boolean) : []
        setForm({
          name:        entry.name || '',
          tagline:     entry.tagline || '',
          description: entry.description || '',
          category:    entry.category || 'DeFi',
          highlights:  [hi[0] || '', hi[1] || '', hi[2] || ''],
          websiteUrl:  entry.website_url || '',
          imageUrl:    entry.image_url || '',
        })
      })
      .catch(() => { if (!cancelled) setLoadError('Could not load this listing.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id, isEdit])

  const set   = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const setHi = (i) => (e) => { const h = [...form.highlights]; h[i] = e.target.value; setForm(f => ({ ...f, highlights: h })) }

  const urlErr = websiteError(form.websiteUrl)
  const canSubmit = form.name.trim() && form.tagline.trim() && !urlErr && !submitting

  async function handleSubmit() {
    if (!activeAddress) return addToast('Connect your wallet to continue', 'info')
    if (!form.name.trim()) return addToast('Project name is required', 'error')
    if (!form.tagline.trim()) return addToast('Tagline is required', 'error')
    if (urlErr) return addToast(urlErr, 'error')

    setSubmitting(true)
    const meta = {
      name: form.name, tagline: form.tagline, description: form.description,
      category: form.category, websiteUrl: form.websiteUrl, imageUrl: form.imageUrl,
      highlights: form.highlights.filter(h => h.trim()),
    }
    try {
      if (isEdit) {
        await updateDirectoryEntry({ address: activeAddress, id, meta })
        addToast('Updated! Your edited listing will reappear once an admin re-approves it.', 'success', 8000)
      } else {
        await submitDirectoryEntry({ address: activeAddress, meta })
        addToast('Submitted! Your listing will appear once an admin approves it.', 'success', 7000)
      }
      navigate('/directory/mine')
    } catch (e) {
      addToast(e.message || (isEdit ? 'Update failed' : 'Submission failed'), 'error', 8000)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <section className="section wrap" style={{ maxWidth: 720 }}><div style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</div></section>
  }
  if (loadError) {
    return (
      <section className="section wrap" style={{ maxWidth: 720 }}>
        <Link to="/directory/mine" style={{ color: 'var(--text-muted)' }}>← Back to my listings</Link>
        <div className="card" style={{ padding: 14, marginTop: 16, color: 'var(--danger)' }}>{loadError}</div>
      </section>
    )
  }

  return (
    <section className="section wrap" style={{ maxWidth: 720 }}>
      <Link to={isEdit ? '/directory/mine' : '/directory'} style={{ display: 'inline-block', marginBottom: 16, color: 'var(--text-muted)' }}>
        ← {isEdit ? 'Back to my listings' : 'Back to directory'}
      </Link>
      <h1 style={{ margin: '0 0 6px', fontSize: 28, letterSpacing: '-0.02em' }}>
        {isEdit ? 'Edit your listing' : 'List your project'}
      </h1>
      <p style={{ margin: '0 0 24px', color: 'var(--text-muted)', fontSize: 15 }}>
        {isEdit
          ? "Connect your wallet to confirm the change. Edited listings go back to admin review before reappearing publicly."
          : "Free to list. Just connect your wallet — no signing, no transaction fee. Entries are reviewed by an admin before going live."}
      </p>

      {!activeAddress && (
        <div className="card" style={{ padding: 14, marginBottom: 20, color: 'var(--text-muted)', fontSize: 14 }}>
          Connect your wallet to {isEdit ? 'save changes' : 'submit a listing'}.
        </div>
      )}

      <div className="card form-card">
        <div className="form-stack">
          <div className="field">
            <label htmlFor="d-name">Project name *</label>
            <input id="d-name" className="input" maxLength={60} placeholder="e.g. AlgoSwap Protocol" value={form.name} onChange={set('name')} />
            <span className="field-hint" style={{ color: form.name.length >= 60 ? 'var(--danger)' : 'var(--text-faint)' }}>{form.name.length}/60 characters</span>
          </div>

          <div className="field">
            <label htmlFor="d-tagline">Tagline *</label>
            <input id="d-tagline" className="input" maxLength={120} placeholder="One sentence that captures your project" value={form.tagline} onChange={set('tagline')} />
            <span className="field-hint" style={{ color: form.tagline.length >= 120 ? 'var(--danger)' : 'var(--text-faint)' }}>{form.tagline.length}/120 characters</span>
          </div>

          <div className="field">
            <label htmlFor="d-category">Category</label>
            <select id="d-category" className="input" value={form.category} onChange={set('category')}>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>

          <div className="field">
            <label htmlFor="d-description">Description</label>
            <textarea id="d-description" className="textarea" maxLength={5000} placeholder="Describe your project, what it does, and your team background…" value={form.description} onChange={set('description')} />
            <span className="field-hint" style={{ color: form.description.length >= 5000 ? 'var(--danger)' : 'var(--text-faint)' }}>{form.description.length}/5000 characters</span>
          </div>

          <div className="field">
            <div className="field-label">Highlights</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {form.highlights.map((h, i) => (
                <input
                  key={i}
                  id={`d-highlight-${i}`}
                  aria-label={`Highlight ${i + 1}`}
                  className="input"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                  maxLength={500}
                  placeholder={['e.g. Live on mainnet since 2024', 'e.g. 1,400+ active wallets', 'e.g. Open source'][i]}
                  value={h}
                  onChange={setHi(i)}
                />
              ))}
            </div>
            <span className="field-hint">Up to 3 scannable reasons your project stands out.</span>
          </div>

          <div className="field">
            <label htmlFor="d-website">Website</label>
            <input
              id="d-website"
              className={`input${urlErr && form.websiteUrl ? ' input-error' : ''}`}
              maxLength={200}
              placeholder="https://yourproject.xyz"
              value={form.websiteUrl}
              onChange={set('websiteUrl')}
            />
            {urlErr && form.websiteUrl && <span className="field-hint" style={{ color: 'var(--danger)' }}>{urlErr}</span>}
          </div>

          <div className="field">
            <label>Logo / image</label>
            <ImageUpload value={form.imageUrl} onChange={(url) => setForm(f => ({ ...f, imageUrl: url }))} />
          </div>
        </div>
      </div>

      <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
        <button className="btn btn-primary" disabled={!canSubmit} onClick={handleSubmit}>
          {submitting ? (isEdit ? 'Saving…' : 'Submitting…') : (isEdit ? 'Save changes' : 'Submit listing')}
        </button>
        <Link to={isEdit ? '/directory/mine' : '/directory'} className="btn btn-ghost">Cancel</Link>
      </div>
    </section>
  )
}
