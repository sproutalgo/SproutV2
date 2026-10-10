import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useWallet } from '@txnlab/use-wallet-react'
import { useToast } from '../context/ToastContext'
import { submitDirectoryEntry } from '../utils/api'
import ImageUpload from '../components/ImageUpload'

const CATEGORIES = ['DeFi', 'RWA', 'AI', 'NFT', 'Gaming', 'Infrastructure', 'Social', 'Other']

// Light URL validation (accepts blank, or an http/https URL).
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
  const { activeAddress, signTransactions } = useWallet()
  const { addToast } = useToast()

  const [form, setForm] = useState({
    name: '', tagline: '', description: '', category: 'DeFi',
    highlights: ['', '', ''], websiteUrl: '', imageUrl: '',
  })
  const [submitting, setSubmitting] = useState(false)

  const set   = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const setHi = (i) => (e) => { const h = [...form.highlights]; h[i] = e.target.value; setForm(f => ({ ...f, highlights: h })) }

  const urlErr = websiteError(form.websiteUrl)
  const canSubmit = form.name.trim() && form.tagline.trim() && !urlErr && !submitting

  async function handleSubmit() {
    if (!activeAddress) return addToast('Connect your wallet to submit', 'info')
    if (!form.name.trim()) return addToast('Project name is required', 'error')
    if (!form.tagline.trim()) return addToast('Tagline is required', 'error')
    if (urlErr) return addToast(urlErr, 'error')

    setSubmitting(true)
    try {
      await submitDirectoryEntry({
        address: activeAddress,
        signTransactions,
        meta: {
          name: form.name, tagline: form.tagline, description: form.description,
          category: form.category, websiteUrl: form.websiteUrl, imageUrl: form.imageUrl,
          highlights: form.highlights.filter(h => h.trim()),
        },
      })
      addToast('Submitted! Your listing will appear once an admin approves it.', 'success', 7000)
      navigate('/directory/mine')
    } catch (e) {
      addToast(e.message || 'Submission failed', 'error', 8000)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="container" style={{ paddingTop: 24, paddingBottom: 64, maxWidth: 720 }}>
      <Link to="/directory" className="back-link" style={{ display: 'inline-block', marginBottom: 16, color: 'var(--text-muted)' }}>
        ← Back to directory
      </Link>
      <h1 style={{ margin: '0 0 6px', fontSize: 28, letterSpacing: '-0.02em' }}>List your project</h1>
      <p style={{ margin: '0 0 28px', color: 'var(--text-muted)', fontSize: 15 }}>
        Free to list. You'll sign with your wallet to prove it's yours — no cost, no transaction fee.
        Entries are reviewed by an admin before going live.
      </p>

      {!activeAddress && (
        <div className="alert" style={{ marginBottom: 20 }}>
          Connect your wallet to submit a listing.
        </div>
      )}

      <div className="form-group">
        <label htmlFor="d-name">Project name *</label>
        <input id="d-name" className="input" maxLength={60} placeholder="e.g. AlgoSwap Protocol" value={form.name} onChange={set('name')} />
        <span className="field-hint" style={{ color: form.name.length >= 60 ? 'var(--danger)' : 'var(--text-muted)' }}>{form.name.length}/60 characters</span>
      </div>

      <div className="form-group">
        <label htmlFor="d-tagline">Tagline *</label>
        <input id="d-tagline" className="input" maxLength={120} placeholder="One sentence that captures your project" value={form.tagline} onChange={set('tagline')} />
        <span className="field-hint" style={{ color: form.tagline.length >= 120 ? 'var(--danger)' : 'var(--text-muted)' }}>{form.tagline.length}/120 characters</span>
      </div>

      <div className="form-group">
        <label htmlFor="d-category">Category</label>
        <select id="d-category" className="input" value={form.category} onChange={set('category')}>
          {CATEGORIES.map(c => <option key={c}>{c}</option>)}
        </select>
      </div>

      <div className="form-group">
        <label htmlFor="d-description">Description</label>
        <textarea id="d-description" className="textarea" maxLength={5000} placeholder="Describe your project, what it does, and your team background…" value={form.description} onChange={set('description')} />
        <span className="field-hint" style={{ color: form.description.length >= 5000 ? 'var(--danger)' : 'var(--text-muted)' }}>{form.description.length}/5000 characters</span>
      </div>

      <div className="form-group">
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

      <div className="form-group">
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

      <div className="form-group">
        <label>Logo / image</label>
        <ImageUpload value={form.imageUrl} onChange={(url) => setForm(f => ({ ...f, imageUrl: url }))} />
      </div>

      <div style={{ marginTop: 28, display: 'flex', gap: 12 }}>
        <button className="btn btn-primary" disabled={!canSubmit} onClick={handleSubmit}>
          {submitting ? 'Submitting…' : 'Submit listing'}
        </button>
        <Link to="/directory" className="btn btn-ghost">Cancel</Link>
      </div>
    </div>
  )
}
