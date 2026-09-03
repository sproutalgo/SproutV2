import React, { useEffect, useState, useCallback } from 'react'
import { algodClient, fetchOnChainBatch, gsFromCache } from '../utils/algorand'
import { Link } from 'react-router-dom'
import { fetchPublicProjects, fetchPublicStats } from '../utils/api'
import ProjectCard from '../components/ProjectCard'
import ChallengePopup, { CHALLENGE_DISMISS_KEY } from '../components/ChallengePopup'
import { SkeletonCard, Icon, Stat, deriveProjectStatus, fmtAlgo } from '../components/UI'

const CATEGORIES = ['DeFi', 'RWA', 'AI', 'NFT', 'Gaming', 'Infrastructure', 'Social', 'Other']
const PAGE_SIZE  = 50

export default function Home() {
  const [projects, setProjects]     = useState([])
  const [loading, setLoading]       = useState(true)
  const [filter, setFilter]         = useState('All')
  const [showDonations, setShowDonations] = useState(true)
  const [showCancelled, setShowCancelled] = useState(true)
  const [search, setSearch]         = useState('')
  const [error, setError]           = useState(null)
  const [page, setPage]             = useState(1)
  const [total, setTotal]           = useState(0)
  const [allProjects, setAllProjects] = useState([])
  const [platformStats, setPlatformStats] = useState(null)
  const [currentRound, setCurrentRound] = useState(0)

  // Builder Challenge popup: auto-shows once per visitor (remembered via
  // localStorage); the hero button below can reopen it any time.
  const [challengeOpen, setChallengeOpen] = useState(false)
  useEffect(() => {
    try {
      if (!localStorage.getItem(CHALLENGE_DISMISS_KEY)) setChallengeOpen(true)
    } catch { setChallengeOpen(true) }
  }, [])
  const closeChallenge = () => {
    try { localStorage.setItem(CHALLENGE_DISMISS_KEY, '1') } catch { /* non-critical */ }
    setChallengeOpen(false)
  }
  const openChallenge = () => setChallengeOpen(true)

  // Fetch current round once on mount for accurate expiry display.
  // A single algod call rather than per-project — good tradeoff.
  useEffect(() => {
    algodClient.status().do()
      .then(s => setCurrentRound(Number(s['last-round'] ?? s.lastRound ?? 0)))
      .catch(() => {}) // non-critical — falls back to 0, sync job covers it
  }, [])  // all loaded so far for stats/hero

  const totalPages = Math.ceil(total / PAGE_SIZE)

  const loadPage = useCallback(async (pageNum, currentFilter, currentSearch) => {
    setLoading(true)
    setError(null)
    try {
      // Step 1: fetch page of metadata from Supabase (sorted newest-first, paginated)
      const result = await fetchPublicProjects({ page: pageNum, pageSize: PAGE_SIZE })
      const metaList = Array.isArray(result.projects) ? result.projects : (Array.isArray(result) ? result : [])
      setTotal(result.total ?? metaList.length)

      if (metaList.length === 0) {
        setProjects([])
        return
      }

      // Step 2: use cached on_chain_* columns from Supabase where available.
      // Fall back to direct algod calls for any records without a populated cache.
      // ROLLBACK: remove the cache block and restore fetchOnChainBatch for all IDs.
      const cachedMap = {}
      const uncachedIds = []

      for (const meta of metaList) {
        const id = Number(meta.app_id)
        // Skip deleted contracts entirely — no algod call needed
        if (meta.on_chain_deleted) {
          cachedMap[id] = { gs: {}, deleted: true }
          continue
        }
        const cached = gsFromCache(meta)
        if (cached) {
          cachedMap[id] = { gs: cached, deleted: false }
        } else {
          uncachedIds.push(id)
        }
      }

      // Fetch algod only for records with no cache yet
      const algodResults = uncachedIds.length > 0
        ? await fetchOnChainBatch(uncachedIds)
        : {}

      // Step 3: merge — prefer cache, fall back to algod
      const merged = metaList.map(meta => {
        const id = Number(meta.app_id)
        const { gs, deleted } = cachedMap[id] ?? algodResults[id] ?? { gs: {}, deleted: true }
        return { id, gs, meta, deleted }
      })

      setProjects(merged)
      // Accumulate all loaded projects for hero stats (first page is enough)
      if (pageNum === 1) setAllProjects(merged)
    } catch (e) {
      console.error(e)
      setError('Could not load projects. Check your connection.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPage(page, filter, search)
  }, [page, loadPage])

  // Fetch platform-wide aggregate stats once on mount (independent of pagination).
  // Non-fatal: on failure, the hero falls back to the page-1 client computation.
  useEffect(() => {
    let cancelled = false
    fetchPublicStats()
      .then(s => { if (!cancelled) setPlatformStats(s) })
      .catch(e => console.error('Failed to load platform stats:', e))
    return () => { cancelled = true }
  }, [])

  // Reload when the tab becomes visible again — catches the case where
  // a creator deployed a contract then navigated back to explore.
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        setPage(1)
        loadPage(1, filter, search)
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [filter, search, loadPage])

  // Scroll to top on page navigation so new results start at the top
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [page])

  // Reset to page 1 when filter or search changes
  useEffect(() => {
    if (page !== 1) {
      setPage(1)
    } else {
      loadPage(1, filter, search)
    }
  }, [filter, search]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Client-side visibility (everything except the category filter) ──
  const baseVisible = projects.filter(p => {
    const m = p.meta || {}
    const status = deriveProjectStatus(p, currentRound)
    const isCancelled = status === 'cancelled'
    if (m.is_hidden) return false
    if (isCancelled && !showCancelled) return false
    // Hide only campaigns that genuinely still need setup — NOT failed campaigns
    // whose asa_id reset to 0 after the creator reclaimed the pool, since backers
    // must still be able to reach those for refunds.
    if (status === 'needs-setup') return false
    if (m.is_donation && !showDonations) return false
    if (search) {
      const q = search.toLowerCase()
      if (!m.name?.toLowerCase().includes(q) && !m.tagline?.toLowerCase().includes(q) && !String(p.id).includes(q)) return false
    }
    return true
  })

  // Filter chips derive from what's actually visible — empty categories
  // never render, so the row is self-pruning as the platform grows.
  const catCounts = baseVisible.reduce((acc, p) => {
    const cat = p.meta?.category || 'Other'
    acc[cat] = (acc[cat] || 0) + 1
    return acc
  }, {})
  const chips = CATEGORIES.filter(c => (catCounts[c] || 0) > 0 || c === filter)

  const filtered = filter === 'All'
    ? baseVisible
    : baseVisible.filter(p => (p.meta?.category || 'Other') === filter)

  // ── Hero data ──
  const statsBase = allProjects.length > 0 ? allProjects : projects
  const totalPledgedClient = Math.round(statsBase.reduce((s, p) => s + Number(p.gs?.raised ?? 0), 0) / 1_000_000)
  const fundedCountClient = statsBase.filter(p => {
    const s = deriveProjectStatus(p, currentRound)
    return s === 'funded' || s === 'distributed'
  }).length
  // Prefer platform-wide server aggregates; fall back to page-1 client sums.
  const totalPledged = platformStats
    ? Math.round(Number(platformStats.totalRaisedMicro ?? 0) / 1_000_000)
    : totalPledgedClient
  const fundedCount = platformStats
    ? Number(platformStats.fundedCount ?? 0)
    : fundedCountClient
  const liveCount = statsBase.filter(p => deriveProjectStatus(p, currentRound) === 'active').length
  const hasStats = totalPledged > 0 || liveCount > 0 || fundedCount > 0

  const featuredProjects = [...statsBase]
    .filter(p => p.meta?.is_featured)
    .sort((a, b) => (a.meta?.feature_order ?? 0) - (b.meta?.feature_order ?? 0))
    .slice(0, 3)
  const visibleForHero = statsBase.filter(p => {
    const m = p.meta || {}
    const status = deriveProjectStatus(p, currentRound)
    return !m.is_hidden && status !== 'cancelled' && (p.gs?.asa_id || m.is_donation || status === 'distributed')
  })
  const heroProject = featuredProjects[0] ?? visibleForHero[0] ?? null

  return (
    <div className="rise">
      <ChallengePopup open={challengeOpen} onClose={closeChallenge} />
      {/* ── Hero ── */}
      <section className="hero wrap">
        <div className="hero-grid">
          <div>
            <span className="badge badge-success">
              <span className="badge-dot" style={{ animation: 'pulse-dot 2s infinite' }} />
              Live on Algorand Mainnet
            </span>
            <h1 style={{ marginTop: 22 }}>
              Algorand's own — <span className="accent">grassroots</span> crowdfunding platform.<br />
              Back projects you believe in.
            </h1>
            <p className="hero-sub">
              Refunds are guaranteed by the smart contract — if a campaign
              misses its goal, you claim yours back in one click. 
            </p>
            <div className="hero-actions">
              <a href="#explore-grid" className="btn btn-primary btn-lg">
                Explore campaigns <Icon.arrow style={{ width: 18, height: 18 }} />
              </a>
              <Link to="/faq" className="btn btn-ghost btn-lg">
                How escrow works
              </Link>
              <button type="button" className="btn btn-outline btn-lg" onClick={openChallenge}>
                🏆 Builder Challenge — 25K ALGO
              </button>
            </div>
            {hasStats && (
              <div className="hero-stats">
                {totalPledged > 0 && (
                  <Stat
                    value={fmtAlgo(totalPledged, { compact: true })}
                    label="ALGO pledged"
                    accent
                  />
                )}
                {liveCount > 0 && <Stat value={liveCount} label="Growing now" />}
                {fundedCount > 0 && <Stat value={fundedCount} label="Fully funded" />}
              </div>
            )}
          </div>

          {/* Featured campaign — a real, clickable card */}
          {loading && !heroProject ? (
            <div className="hero-featured" aria-hidden="true"><SkeletonCard /></div>
          ) : heroProject ? (
            <div className="hero-featured">
              <span className="featured-flag">Featured</span>
              <ProjectCard project={heroProject} currentRound={currentRound} />
            </div>
          ) : (
            <div className="first-wave">
              <Icon.spark style={{ width: 26, height: 26, color: 'var(--accent)' }} />
              <h3>The first wave starts here</h3>
              <p>
                Sprout is brand new — no campaigns have launched yet. Deploy yours
                and it will be the first thing every visitor sees.
              </p>
              <Link to="/create" className="btn btn-primary" style={{ alignSelf: 'flex-start', marginTop: 4 }}>
                Launch a project
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* ── Trust strip ── */}
      <div className="trust-strip">
        <div className="trust-strip-inner">
          <Link to="/faq" className="trust-item">
            <Icon.lock /> Funds held in non-custodial contract escrow
          </Link>
          <Link to="/faq" className="trust-item">
            <Icon.refund /> Full refunds, enforced by contract, if the goal is missed
          </Link>
          <Link to="/faq" className="trust-item">
            <Icon.check /> 4% fee — charged only on success
          </Link>
        </div>
      </div>

      {/* ── Explore grid ── */}
      <section className="section wrap" id="explore-grid">
        {(loading || projects.length > 0) && (
          <Link to="/project/demo" className="demo-strip">
            <span><strong>New here?</strong> See a full example of what a campaign page looks like. </span> 
            <span className="demo-strip-cta">View the example campaign <Icon.arrow style={{ width: 14, height: 14 }} /></span> 
          </Link>
        )}
        <div className="section-head">
          <div>
            <br />
            <span className="eyebrow">Discover</span>
            <h2 className="section-title" style={{ marginTop: 10 }}>Growing now</h2>
          </div>
          <div className="search">
            <Icon.search />
            <input
              id="explore-search"
              name="explore-search"
              type="search"
              autoComplete="off"
              aria-label="Search projects"
              placeholder="Search projects…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="filters" style={{ marginBottom: 24 }}>
          <button className={`chip${filter === 'All' ? ' active' : ''}`} onClick={() => setFilter('All')}>
            All {baseVisible.length > 0 && <span className="n">{baseVisible.length}</span>}
          </button>
          {chips.map(c => (
            <button key={c} className={`chip${filter === c ? ' active' : ''}`} onClick={() => setFilter(c)}>
              {c} <span className="n">{catCounts[c] || 0}</span>
            </button>
          ))}
        </div>

        <div className="filters-end" style={{ marginBottom: 24 }}>
          <button
            className={`chip${showDonations ? ' active' : ''}`}
            onClick={() => setShowDonations(s => !s)}
            aria-pressed={showDonations}
          >
            <Icon.heart /> {showDonations ? 'Hide Contribution Campaigns' : 'Show Contribution Campaigns'}
          </button>
          <button
            className={`chip${showCancelled ? ' active' : ''}`}
            onClick={() => setShowCancelled(s => !s)}
            aria-pressed={showCancelled}
          >
            {showCancelled ? 'Hide Cancelled' : 'Show Cancelled'}
          </button>
        </div>

        {loading ? (
          <div className="grid-cards">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : error ? (
          <div className="error-box">⚠ {error}</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden="true">
              <circle cx="32" cy="32" r="31" stroke="var(--border-strong)" strokeWidth="1.5" strokeDasharray="4 4" />
              <path d="M32 48V34" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M32 36c0-7 5-12 12-13-1 7-5 12-12 13z" fill="var(--accent)" opacity="0.7" />
              <path d="M32 40c0-5-4-9-9-10 1 5 4 9 9 10z" fill="var(--accent)" opacity="0.45" />
            </svg>
            <h3>{projects.length === 0 ? 'Nothing planted yet' : 'Nothing matches'}</h3>
            <p>
              {projects.length === 0
                ? 'Be the first to launch a crowdfunding campaign on Sprout.'
                : 'Try a different filter or clear your search.'}
            </p>
            {projects.length === 0 && (
              <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                <Link to="/create" className="btn btn-primary">Launch a project</Link>
                <Link to="/project/demo" className="btn btn-ghost">See an example campaign</Link>
              </div>
            )}
          </div>
        ) : (
          <div className="grid-cards">
            {filtered.map(p => <ProjectCard key={p.id} project={p} currentRound={currentRound} />)}
          </div>
        )}

        {/* Pagination controls */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 40 }}>
            <button
              className="btn btn-ghost btn-sm"
              disabled={page === 1 || loading}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            >
              ← Previous
            </button>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Page {page} of {totalPages} · {total} campaigns
            </span>
            <button
              className="btn btn-ghost btn-sm"
              disabled={page === totalPages || loading}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            >
              Next →
            </button>
          </div>
        )}

        <p className="grid-foot">
          Listings refresh about every two minutes — open any campaign for live on-chain figures.
        </p>
      </section>

      {/* ── How it works ── */}
      <section className="section wrap">
        <span className="eyebrow">How it works</span>
        <h2 className="section-title" style={{ marginTop: 10, marginBottom: 32 }}>Community-funded, contract-enforced</h2>
        <div className="hiw">
          {[
            { ic: <Icon.spark />, n: '01', t: 'Launch your campaign', d: 'Set your funding goal, token rate, and deadline. Deploy a crowdfunding contract to Algorand in minutes.' },
            { ic: <Icon.users />, n: '02', t: 'Backers contribute', d: 'Anyone with an Algorand wallet opts in and contributes before the deadline. Every contribution is held in a non-custodial smart contract.' },
            { ic: <Icon.bolt />, n: '03', t: 'Goal reached → tokens', d: 'Hit your funding goal and backers receive the agreed upon project token. You receive the raised ALGO, minus a 4% fee.' },
            { ic: <Icon.refund />, n: '04', t: 'Missed → full refund', d: "If the goal isn't met by the deadline, every backer is refunded in full. No funds are ever stranded." },
          ].map(s => (
            <div className="hiw-step" key={s.n}>
              <div className="hiw-ic">{s.ic}</div>
              <span className="hiw-num">{s.n}</span>
              <h4>{s.t}</h4>
              <p>{s.d}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
