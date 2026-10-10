import React from 'react'
import { Link } from 'react-router-dom'
import { Cover, categoryHue, shortAddr } from './UI'

/**
 * A directory entry card — the campaign card's presentation minus all funding
 * elements (no progress bar, goal, deadline, or status). Links to the entry's
 * detail page.
 */
export default function DirectoryCard({ entry }) {
  const hue = categoryHue(entry.category)
  return (
    <Link
      to={`/directory/${entry.id}`}
      className="pcard"
      aria-label={`${entry.name} — directory entry`}
    >
      <Cover hue={hue} label={entry.name} imageUrl={entry.image_url} />
      <div className="pcard-body">
        <div className="pcard-head">
          <h3 className="pcard-title">{entry.name}</h3>
          {entry.category && (
            <span className="chip" style={{ fontSize: 11 }}>{entry.category}</span>
          )}
        </div>
        {entry.tagline && <p className="pcard-tagline">{entry.tagline}</p>}
        {entry.website_url && (
          <div className="pcard-meta" style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            {entry.website_url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
          </div>
        )}
        <div className="pcard-foot" style={{ fontSize: 12, color: 'var(--text-faint)' }}>
          by {shortAddr(entry.wallet_address)}
        </div>
      </div>
    </Link>
  )
}
