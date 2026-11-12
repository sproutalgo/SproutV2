import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import CycleStatus from '../components/CycleStatus'
import { Icon } from '../components/UI'
import ProjectCard from '../components/ProjectCard'
import { fetchPublicProjects } from '../utils/api'
import { algodClient, fetchOnChainBatch, gsFromCache } from '../utils/algorand'

// The orientation landing page. Its job is to tell a visitor in seconds what Sprout is,
// show where the funding cycle stands, surface the featured campaign(s), and route to one
// of two products — the funding engine or crowdfunding. Not a marketing wall; a router
// with a pulse. Uses the existing design-system classes throughout so it matches the site
// aesthetic.
export default function Landing() {
  // Featured campaigns — fetched + merged with on-chain state exactly like the Campaigns
  // page (Home.jsx) so the cards render identically. Falls back to nothing if none are
  // featured, so the section just doesn't appear rather than leaving an empty slot.
  const [featured, setFeatured] = useState([])
  const [currentRound, setCurrentRound] = useState(0)

  useEffect(() => {
    algodClient.status().do()
      .then(s => setCurrentRound(Number(s['last-round'] ?? s.lastRound ?? 0)))
      .catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const result = await fetchPublicProjects({ page: 1, pageSize: 50 })
        const metaList = Array.isArray(result.projects) ? result.projects : (Array.isArray(result) ? result : [])
        // Only the featured rows need on-chain data for the card.
        const featuredMetas = metaList
          .filter(m => m.is_featured)
          .sort((a, b) => (a.feature_order ?? 0) - (b.feature_order ?? 0))
          .slice(0, 3)
        if (featuredMetas.length === 0) { if (!cancelled) setFeatured([]); return }

        // Merge cached on-chain columns where present; fetch algod for the rest — same
        // strategy as Home.jsx, scoped to just the featured set.
        const cachedMap = {}
        const uncachedIds = []
        for (const meta of featuredMetas) {
          const id = Number(meta.app_id)
          if (meta.on_chain_deleted) { cachedMap[id] = { gs: {}, deleted: true }; continue }
          const cached = gsFromCache(meta)
          if (cached) cachedMap[id] = { gs: cached, deleted: false }
          else uncachedIds.push(id)
        }
        const algodResults = uncachedIds.length > 0 ? await fetchOnChainBatch(uncachedIds) : {}
        const merged = featuredMetas.map(meta => {
          const id = Number(meta.app_id)
          const { gs, deleted } = cachedMap[id] ?? algodResults[id] ?? { gs: {}, deleted: true }
          return { id, gs, meta, deleted }
        })
        if (!cancelled) setFeatured(merged)
      } catch {
        if (!cancelled) setFeatured([])
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  return (
    <>
      {/* Hero */}
      <section className="hero wrap">
        <div style={{ maxWidth: 680 }}>
          <h1 style={{ fontSize: 'clamp(40px, 5.4vw, 64px)', lineHeight: 1.05, margin: 0 }}>
            Algorand's own — <span className="accent" style={{ color: 'var(--accent)', fontStyle: 'italic' }}>grassroots</span> funding platform
          </h1>
          <p className="hero-sub" style={{ maxWidth: 540 }}>
            Back projects you believe in. Stake ALGO to grow a shared prize pool, nominate
            and vote to direct it, or launch and back individual campaigns. All
            non-custodial, on mainnet.
          </p>
        </div>

        {/* Live cycle status — the pulse */}
        <div style={{ marginTop: 32, maxWidth: 680 }}>
          <CycleStatus variant="hero" />
        </div>
      </section>

      {/* Featured campaign(s) — same cards as the Campaigns page. Hidden entirely when
          nothing is featured. */}
      {featured.length > 0 && (
        <section className="wrap" style={{ paddingBottom: 24 }}>
          <div style={{ maxWidth: 680 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span className="eyebrow">Featured</span>
              <Link to="/campaigns" style={{ fontSize: 13, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                All campaigns →
              </Link>
            </div>
            <div style={{ display: 'grid', gap: 20, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
              {featured.map(p => (
                <div key={p.id} className="hero-featured" style={{ position: 'relative' }}>
                  <span className="featured-flag">Featured</span>
                  <ProjectCard project={p} currentRound={currentRound} />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Two paths — capped to the same 680px column as the hero/status above so the
          left and right edges line up with the status box. */}
      <section className="wrap" style={{ paddingBottom: 24 }}>
        <div style={{ maxWidth: 680, display: 'grid', gap: 20, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {/* Engine */}
          <div className="card" style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h2 style={{ margin: 0, fontSize: 26 }}>Fund &amp; direct the pool</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 15, lineHeight: 1.6, margin: 0, flex: 1 }}>
              Stake ALGO to grow the prize pool. The community nominates projects; stakers
              vote on who wins with staked Sprout. The top projects split the pool each round.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Link to="/fund" className="btn btn-primary">Enter the engine</Link>
              <Link to="/directory" className="btn btn-ghost">Browse projects</Link>
            </div>
          </div>

          {/* Crowdfunding */}
          <div className="card" style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h2 style={{ margin: 0, fontSize: 26 }}>Launch or back a campaign</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 15, lineHeight: 1.6, margin: 0, flex: 1 }}>
              Run your own crowdfunding campaign, or back someone else's. Permissionless,
              non-custodial, and funds release straight to the creator on-chain.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Link to="/campaigns" className="btn btn-ghost">Explore campaigns</Link>
              <Link to="/create" className="btn btn-soft">Launch a project</Link>
            </div>
          </div>
        </div>
      </section>

      {/* How the pool works */}
      <section className="wrap" style={{ paddingBottom: 64 }}>
        <div className="card" style={{ maxWidth: 680, padding: 28 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 20 }}>How the pool works</h3>
          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            {[
              { n: '1', t: 'Stake ALGO', d: 'Holders stake ALGO into the escrow, growing the shared prize pool.' },
              { n: '2', t: 'Nominate', d: 'The community backs projects in the directory; the top 8 form the ballot.' },
              { n: '3', t: 'Vote', d: 'Stakers stake Sprout for voting weight and vote on the ballot.' },
              { n: '4', t: 'Payout', d: 'The top projects split the pool. Then it resets and repeats.' },
            ].map(s => (
              <div key={s.n} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span className="badge badge-accent" style={{ alignSelf: 'flex-start' }}>{s.n}</span>
                <strong style={{ fontSize: 16 }}>{s.t}</strong>
                <span style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>{s.d}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  )
}
