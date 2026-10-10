import React from 'react'
import { Link } from 'react-router-dom'
import { Cover, Identicon, categoryHue, shortAddr } from './UI'

/**
 * A directory entry card — mirrors ProjectCard's frame, cover, and typography
 * exactly, minus all funding elements (no progress bar, goal, countdown, or
 * status). Uses the same .pcard / .pcard-body / .pcard-title / .pcard-tag
 * classes so it looks identical to a campaign card.
 */
export default function DirectoryCard({ entry }) {
  const hue = categoryHue(entry.category)
  return (
    <Link
      to={`/directory/${entry.id}`}
      className="pcard"
      aria-label={`${entry.name} — directory listing`}
    >
      <Cover
        hue={hue}
        imageUrl={entry.image_url}
        style={{ height: 150 }}
        label={undefined}
      />
      <div className="pcard-body">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span className="badge">{entry.category || 'Other'}</span>
          <span className="badge badge-accent">Directory</span>
        </div>
        <h3 className="pcard-title">{entry.name}</h3>
        {entry.wallet_address && (
          <div className="pcard-creator">
            <Identicon seed={entry.wallet_address} size={20} />
            <span className="mono">{shortAddr(entry.wallet_address)}</span>
          </div>
        )}
        <p className="pcard-tag">{entry.tagline || 'A project on Algorand.'}</p>
        {entry.website_url && (
          <div style={{ fontSize: 12.5, color: 'var(--text-faint)', marginTop: 'auto' }}>
            {entry.website_url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
          </div>
        )}
      </div>
    </Link>
  )
}
