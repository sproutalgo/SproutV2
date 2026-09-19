import React, { useRef, useState } from 'react'
import { uploadCampaignImage } from '../utils/api'

// Client-side mirror of the server's limits (server is the real enforcement).
const MAX_BYTES = 2 * 1024 * 1024
const ALLOWED = ['image/png', 'image/jpeg', 'image/webp']

/**
 * Campaign banner uploader. Validates type/size in the browser (for instant
 * feedback), uploads via the backend (which re-enforces the limits and stores
 * the file in Supabase Storage), and reports the resulting public URL via
 * onChange. Shows a 2.4:1 preview so creators see roughly how it will be
 * cropped on the card and detail page.
 *
 * Props:
 *   value    - current image URL ('' if none)
 *   onChange - (url: string) => void
 *   onError  - (msg: string) => void  (optional; e.g. wire to a toast)
 */
export default function ImageUpload({ value, onChange, onError }) {
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)

  function fail(msg) {
    if (onError) onError(msg)
  }

  async function handleFile(file) {
    if (!file) return
    if (!ALLOWED.includes(file.type)) {
      return fail('Please choose a PNG, JPG, or WebP image.')
    }
    if (file.size > MAX_BYTES) {
      return fail('Image is too large. Maximum size is 2 MB.')
    }
    setBusy(true)
    try {
      const url = await uploadCampaignImage(file)
      onChange(url)
    } catch (e) {
      fail(e?.message || 'Upload failed. Please try again.')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = '' // allow re-picking same file
    }
  }

  return (
    <div>
      <div className="field-label">Campaign banner</div>

      {/* Preview box at 2.4:1 — matches the wide banner Sprout renders. */}
      <div
        style={{
          width: '100%',
          aspectRatio: '2.4 / 1',
          borderRadius: 'var(--r-md)',
          border: '1px dashed var(--border-strong)',
          background: value
            ? `center / cover no-repeat url(${value})`
            : 'var(--surface-2)',
          display: 'grid',
          placeItems: 'center',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {!value && !busy && (
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            No banner yet
          </span>
        )}
        {busy && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.35)' }}>
            <div className="sk-pulse" style={{ width: 36, height: 36, borderRadius: '50%' }} />
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          style={{ display: 'none' }}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        <button
          type="button"
          className="btn btn-soft btn-sm"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? 'Uploading…' : value ? 'Replace image' : 'Upload image'}
        </button>
        {value && !busy && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onChange('')}
            style={{ color: 'var(--danger)' }}
          >
            Remove
          </button>
        )}
      </div>

      <span className="field-hint">
        Recommended: wide landscape, ~2.4:1 (e.g. 1700×700). PNG, JPG, or WebP, up to 2 MB.
        Images are center-cropped to fit, so keep logos and text centered.
      </span>
    </div>
  )
}
