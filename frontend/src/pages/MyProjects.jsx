import React, { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useWallet } from '@txnlab/use-wallet-react'
import algosdk from 'algosdk'
import {
  algodClient, fetchOnChainBatch, gsFromCache,
  algoToMicro, signAndSend,
} from '../utils/algorand'
import { fetchCreatorProjectsMeta } from '../utils/api'
import { buildSetupGroup, buildSetupPrepGroup, encodeUnsignedTxns } from '../utils/transactions'
import { useToast } from '../context/ToastContext'
import {
  Cover, StatusBadge, Progress, IdTag, Icon, SkeletonCard,
  fmtAlgo, pctNum, daysLeftLabel, deriveProjectStatus, categoryHue, shortAddr,
} from '../components/UI'

export default function MyProjects() {
  const { activeAddress, signTransactions } = useWallet()
  const { addToast } = useToast()
  const [projects, setProjects]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [filter, setFilter]       = useState('All')
  const [setupModal, setSetupModal] = useState(null)
  const [setupTab, setSetupTab]     = useState('existing') // 'existing' | 'create'
  const [setupForm, setSetupForm]   = useState({ asaId: '', goalAlgo: '', ratePerAlgo: '', algoPerBundle: '1' })
  const [settingUp, setSettingUp]   = useState(false)
  const [asaInfo, setAsaInfo]       = useState(null)
  const [asaFetching, setAsaFetching] = useState(false)
  const [asaError, setAsaError]     = useState(null)
  const [asaDecimals, setAsaDecimals] = useState(0) // for decimal-aware rate display

  // ASA creation form
  const [createAsaForm, setCreateAsaForm] = useState({ name: '', unitName: '', total: '', decimals: '0' })
  const [creatingAsa, setCreatingAsa]     = useState(false)
  const [createdAsaId, setCreatedAsaId]   = useState(null)

  // Milestone completion
  const [completingMilestone, setCompletingMilestone] = useState(null)

  const loadProjects = useCallback(async () => {
    if (!activeAddress) { setLoading(false); return }
    setLoading(true)
    try {
      // Supabase-first: fetch metadata then use cached on_chain_* columns.
      // Falls back to direct algod calls for uncached records.
      // ROLLBACK: remove cache block and restore fetchOnChainBatch for all IDs.
      const metas = await fetchCreatorProjectsMeta(activeAddress)
      const metaList = Array.isArray(metas) ? metas : []

      const cachedMap = {}
      const uncachedIds = []
      for (const meta of metaList) {
        const id = Number(meta.app_id)
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
      const algodResults = uncachedIds.length > 0
        ? await fetchOnChainBatch(uncachedIds)
        : {}

      const merged = metaList.map(meta => {
        const id = Number(meta.app_id)
        const { gs, deleted } = cachedMap[id] ?? algodResults[id] ?? { gs: {}, deleted: true }
        return { id, gs, meta, deleted }
      })
      setProjects(merged)
    } catch (e) {
      console.error(e)
    } finally { setLoading(false) }
  }, [activeAddress])

  useEffect(() => {
    if (setupModal) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [setupModal])

  useEffect(() => { loadProjects() }, [loadProjects])

  function openSetup(p) {
    setSetupModal({ appId: p.id, gs: p.gs, meta: p.meta })
    setSetupForm({
      asaId: '',
      goalAlgo: p.meta?.goal_micro ? (Number(p.meta.goal_micro) / 1_000_000).toString() : ((Number(p.gs?.goal) || 0) / 1_000_000).toString(),
      ratePerAlgo: p.meta?.rate_per_algo != null ? String(p.meta.rate_per_algo) : (Number(p.gs?.tpb) || '').toString(),
      algoPerBundle: p.meta?.algo_per_bundle != null ? String(p.meta.algo_per_bundle) : (Number(p.gs?.apb) || 1).toString(),
    })
    setAsaInfo(null)
    setAsaError(null)
  }

  async function fetchAsaInfo(rawId) {
    const id = parseInt(rawId)
    if (!id || id <= 0) { setAsaInfo(null); setAsaError(null); setAsaDecimals(0); return }
    setAsaFetching(true)
    setAsaError(null)
    setAsaInfo(null)
    setAsaDecimals(0)
    try {
      const asset = await algodClient.getAssetByID(id).do()
      const p = asset.asset?.params ?? asset.params ?? asset
      const decimals = Number(p.decimals ?? 0)

      // The contract rejects rug-capable tokens at setup: a token is incompatible
      // if it has a clawback address, a freeze address, or is default-frozen.
      // We mirror that check here so the creator sees a clear reason before
      // wasting a setup transaction that the contract would reject anyway.
      // algosdk v3 returns camelCase fields; addresses may be Address objects or
      // strings, and a disabled role is absent, empty, or the zero address.
      const ZERO = algosdk.encodeAddress(new Uint8Array(32))
      const addrStr = (a) => (a == null ? '' : (typeof a === 'string' ? a : a.toString()))
      const isSet = (a) => { const s = addrStr(a); return !!s && s !== ZERO }
      const clawback      = p.clawback ?? p['clawback']
      const freeze        = p.freeze ?? p['freeze']
      const defaultFrozen = Boolean(p.defaultFrozen ?? p['default-frozen'] ?? false)
      const hasClawback   = isSet(clawback)
      const hasFreeze     = isSet(freeze)

      if (hasClawback || hasFreeze || defaultFrozen) {
        const reasons = []
        if (hasClawback)   reasons.push('a clawback address')
        if (hasFreeze)     reasons.push('a freeze address')
        if (defaultFrozen) reasons.push('default-frozen enabled')
        setAsaError(
          `This token has ${reasons.join(' and ')}, which Sprout doesn't allow — ` +
          `these let the token creator claw back or freeze backers' tokens after ` +
          `funding. Use a token with clawback and freeze permanently disabled (set to empty).`
        )
        setAsaInfo(null)
        setAsaDecimals(0)
        return
      }

      setAsaDecimals(decimals)
      setAsaInfo({
        symbol: p['unit-name'] ?? p.unitName ?? '',
        name:   p.name ?? '',
        decimals,
      })
    } catch {
      setAsaError(`ASA ${id} not found on-chain`)
    } finally {
      setAsaFetching(false)
    }
  }

  async function handleCreateAsa() {
    if (!activeAddress) return
    const { name, unitName, total, decimals } = createAsaForm
    if (!name || !unitName || !total) return addToast('Fill in all token fields', 'error')
    setCreatingAsa(true)
    try {
      const { buildAsaCreateTxn } = await import('../utils/transactions')
      const txn = await buildAsaCreateTxn({
        sender: activeAddress,
        assetName: name,
        unitName,
        total: Math.round(Number(total) * Math.pow(10, Number(decimals))),
        decimals: Number(decimals),
      })
      const result = await signAndSend(signTransactions, [txn.toByte()])
      const asaId = Number(result['asset-index'] ?? result.assetIndex ?? 0)
      setCreatedAsaId(asaId)
      // Switch to existing tab and pre-fill the ASA ID
      setSetupTab('existing')
      setSetupForm(f => ({ ...f, asaId: String(asaId) }))
      await fetchAsaInfo(String(asaId))
      addToast(`Token created! ASA ID: ${asaId}`, 'success')
    } catch (e) {
      addToast(e?.message || 'Token creation failed', 'error')
    } finally { setCreatingAsa(false) }
  }

  async function handleMilestoneComplete(appId) {
    setCompletingMilestone(appId)
    try {
      const { markMilestoneComplete } = await import('../utils/api')
      await markMilestoneComplete({ address: activeAddress, appId, signTransactions })
      addToast('Milestone marked as complete!', 'success')
      loadProjects()
    } catch (e) {
      addToast(e?.message || 'Failed to mark milestone complete', 'error')
    } finally { setCompletingMilestone(null) }
  }

  async function handleSetup() {
    if (!activeAddress || !setupModal) return
    const { appId } = setupModal
    const asaId = parseInt(setupForm.asaId)
    const goalAlgo = parseFloat(setupForm.goalAlgo)
    const tokensPerBundle = parseInt(setupForm.ratePerAlgo)
    const algoPerBundle = parseInt(setupForm.algoPerBundle) || 1
    if (!goalAlgo || !tokensPerBundle) return addToast('Fill in all fields', 'error')
    if (algoPerBundle < 1) return addToast('ALGO per bundle must be at least 1', 'error')
    if (!asaId || asaId <= 0) return addToast('Enter a valid ASA ID first', 'error')
    if (asaError) return addToast(asaError, 'error')
    if (!asaInfo) return addToast('Wait for ASA info to load, or re-enter the ASA ID', 'error')
    setSettingUp(true)
    try {
      const appAddress = algosdk.getApplicationAddress(appId)
      const goalMicroAlgos = algoToMicro(goalAlgo)

      // The contract reads ASA decimals on-chain and computes dec_factor itself.
      // The builder needs decimals only to compute the token pool amount to send.
      const decimals = asaInfo.decimals ?? 0

      // ── Prompt 1: combined prep group (idempotent / retry-safe) ────────────
      // Funds the exact min-balance shortfall and includes only the opt-ins that
      // are still needed. On a retry after a prompt-2 failure, already-done steps
      // are skipped — no re-sending 0.4 ALGO, no double opt-in. If everything is
      // already in place, prompt 1 is skipped entirely.
      addToast('Step 1/2: Preparing app (fund + opt-ins)…', 'info', 3000)
      const prep = await buildSetupPrepGroup({ sender: activeAddress, appId, asaId })
      if (!prep.skipped) {
        await signAndSend(signTransactions, encodeUnsignedTxns(prep.txns))
      } else {
        addToast('Step 1/2: App already prepared — skipping…', 'info', 2000)
      }

      // ── Prompt 2: setup group (unchanged, group_size==2) ───────────────────
      addToast('Step 2/2: Sending setup (token pool)…', 'info', 3000)
      const txns = await buildSetupGroup({ sender: activeAddress, appId, asaId, goalMicroAlgos, tokensPerBundle, algoPerBundle, asaDecimals: decimals, appAddress })
      const encoded = encodeUnsignedTxns(txns)
      await signAndSend(signTransactions, encoded)
      if (asaInfo.symbol) {
        try {
          const { updateProjectMeta } = await import('../utils/api')
          await updateProjectMeta({ address: activeAddress, appId, meta: { tokenName: asaInfo.symbol, asaId } })
        } catch { /* non-critical */ }
      }
      addToast('Contract set up! Refreshing…', 'success')
      setSetupModal(null)
      await new Promise(r => setTimeout(r, 2000))
      loadProjects()
    } catch (e) {
      console.error(e)
      const msg = e?.message || ''
      if (msg.includes('underflow') || msg.includes('overspend') || msg.includes('below min')) {
        addToast('Insufficient token balance. You need at least Goal × Rate tokens in your wallet to fund the token pool. Check your wallet balance and try again.', 'error', 8000)
      } else {
        addToast(msg || 'Setup failed', 'error')
      }
    } finally { setSettingUp(false) }
  }

  const FILTERS = ['All', 'Needs setup', 'Live', 'Funded', 'Cancelled']
  const filterMap = { 'All': null, 'Needs setup': ['needs-setup'], 'Live': ['active'], 'Funded': ['funded', 'distributed'], 'Cancelled': ['cancelled'] }

  const list = projects.filter(p => {
    const f = filterMap[filter]
    if (!f) return true
    return f.includes(deriveProjectStatus(p))
  })

  const needsSetupCount = projects.filter(p => deriveProjectStatus(p) === 'needs-setup').length
  const cancelledCount  = projects.filter(p => deriveProjectStatus(p) === 'cancelled').length
  const totalRaised = projects.reduce((s, p) => s + Number(p.gs?.raised ?? 0), 0)

  if (!activeAddress) {
    return (
      <div className="wrap rise">
        <div className="empty-state" style={{ paddingTop: 100 }}>
          <div style={{ fontSize: 48, color: 'var(--accent)' }}>◈</div>
          <h3>Connect your wallet</h3>
          <p>Connect to see your deployed crowdfunding campaigns.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="wrap rise">
      <div className="page-head">
        <div>
          <span className="eyebrow">Dashboard</span>
          <h1 style={{ marginTop: 10 }}>My Projects</h1>
          <p>
            {projects.length} campaign{projects.length !== 1 ? 's' : ''} · {fmtAlgo(totalRaised / 1_000_000)} ALGO raised
            {needsSetupCount > 0 && ` · ${needsSetupCount} need${needsSetupCount > 1 ? '' : 's'} setup`}
            {cancelledCount > 0 && ` · ${cancelledCount} cancelled`}
          </p>
        </div>
        <Link to="/create" className="btn btn-primary btn-lg">
          <Icon.plus style={{ width: 17, height: 17 }} /> New project
        </Link>
      </div>

      <div className="mp-filters">
        {FILTERS.map(f => (
          <button key={f} className={`chip${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[1,2,3].map(i => <div key={i} className="sk-pulse" style={{ height: 88, borderRadius: 'var(--r-md)' }} />)}
        </div>
      ) : list.length === 0 ? (
        <div className="empty-state">
          <Icon.spark style={{ width: 48, height: 48, color: 'var(--accent)' }} />
          <h3>{projects.length === 0 ? 'No campaigns yet' : 'Nothing in this filter'}</h3>
          <p>{projects.length === 0 ? "Deploy your first campaign to get started." : "Try a different filter."}</p>
          {projects.length === 0 && <Link to="/create" className="btn btn-primary" style={{ marginTop: 8 }}>Launch a project</Link>}
        </div>
      ) : (
        <div className="mp-list">
          {list.map(p => {
            const status = deriveProjectStatus(p)
            const hue    = categoryHue(p.meta?.category)
            const raised = Number(p.gs?.raised ?? 0)
            const goal   = Number(p.gs?.goal   ?? p.meta?.goal_micro ?? 1)
            const pct    = pctNum(raised, goal)
            const days   = daysLeftLabel(Number(p.gs?.deadline ?? 0), 0)
            const needsSetup = status === 'needs-setup'
            const untitled   = !p.meta?.tagline

            return (
              <div className="mp-row" key={p.id}>
                <Cover hue={hue} sym={p.meta?.token_name} imageUrl={p.meta?.image_url} className="mp-thumb" label="" style={{ width: 52, height: 52 }} />

                <div className="mp-main">
                  <div className="mp-name-row">
                    <span className={`mp-name${untitled ? ' untitled' : ''}`}>{untitled ? 'Untitled campaign' : p.meta?.name}</span>
                    <StatusBadge status={status} />
                  </div>
                  {!untitled && <div className="mp-tag">{p.meta?.tagline}</div>}
                  <div className="mp-meta">
                    <span className="badge" style={{ padding: '2px 9px', fontSize: 11 }}>{p.meta?.category || 'Other'}</span>
                    <IdTag label="App" value={String(p.id)} />
                    {!days.ended && !needsSetup && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <Icon.clock style={{ width: 13, height: 13 }} /> {days.text}
                      </span>
                    )}
                  </div>
                </div>

                <div className="mp-fund">
                  {needsSetup ? (
                    <span className="faint" style={{ fontSize: 13 }}>Not set up</span>
                  ) : (
                    <>
                      <div className="mp-fund-top">
                        <b>{fmtAlgo(raised / 1_000_000)}</b>
                        <span className="faint">/ {fmtAlgo(goal / 1_000_000)} ALGO</span>
                        <span className="mono faint" style={{ fontSize: 12 }}>{pct}%</span>
                      </div>
                      <Progress raised={raised} goal={goal} />
                    </>
                  )}
                </div>

                <div className="mp-actions">
                  {needsSetup && !p.meta?.is_donation
                    ? <button className="btn btn-primary btn-sm" onClick={() => openSetup(p)}>Set up contract</button>
                    : needsSetup && p.meta?.is_donation
                    ? <span className="faint" style={{ fontSize: 12 }}>Contribution — no setup needed</span>
                    : <Link to={`/project/${p.id}`} className="btn btn-ghost btn-sm">View campaign</Link>
                  }
                  {p.meta?.milestone_title && !p.meta?.milestone_completed_at && (status === 'distributed' || status === 'funded') && (
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: 12, color: 'var(--success)' }}
                      disabled={completingMilestone === p.id}
                      onClick={() => handleMilestoneComplete(p.id)}
                    >
                      {completingMilestone === p.id ? 'Marking…' : '✓ Mark milestone complete'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Setup modal */}
      {setupModal && createPortal(
        <div className="setup-modal-overlay" onClick={e => { if (e.target === e.currentTarget) setSetupModal(null) }}>
          <div className="setup-modal rise">
            <h2>Set up contract</h2>
            <p className="faint" style={{ fontSize: 14, marginTop: 4 }}>App #{setupModal.appId}</p>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', marginBottom: 20, marginTop: 16 }}>
              {[
                { k: 'existing', l: 'I have a token' },
                { k: 'create',   l: 'Create new token' },
              ].map(({ k, l }) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSetupTab(k)}
                  style={{
                    padding: '8px 16px', fontSize: 13, fontWeight: setupTab === k ? 600 : 400,
                    borderBottom: setupTab === k ? '2px solid var(--accent)' : '2px solid transparent',
                    color: setupTab === k ? 'var(--accent)' : 'var(--text-muted)',
                    background: 'none', border: 'none', cursor: 'pointer',
                  }}
                >
                  {l}
                </button>
              ))}
            </div>

            {setupTab === 'existing' && (
              <div className="setup-modal-fields">
                <div className="field">
                  <label htmlFor="mp-asa-id">ASA / Token ID *</label>
                  <input
                    id="mp-asa-id"
                    className="input"
                    type="text"
                    inputMode="numeric"
                    placeholder="e.g. 123456789"
                    value={setupForm.asaId}
                    onChange={e => {
                      const v = e.target.value.replace(/[^0-9]/g, '')
                      setSetupForm(f => ({ ...f, asaId: v }))
                      setAsaInfo(null)
                      setAsaError(null)
                    }}
                    onBlur={e => fetchAsaInfo(e.target.value)}
                  />
                  {asaFetching && <span className="field-hint">Looking up ASA…</span>}
                  {asaInfo && (
                    <span className="field-hint" style={{ color: 'var(--success)' }}>
                      ✓ {asaInfo.name}{asaInfo.symbol ? ` (${asaInfo.symbol})` : ''}
                      {asaInfo.decimals > 0 ? ` · ${asaInfo.decimals} decimals` : ''} found on-chain
                    </span>
                  )}
                  {asaError && <span className="field-hint" style={{ color: 'var(--danger)' }}>{asaError}</span>}
                  {!asaFetching && !asaInfo && !asaError && (
                    <span className="field-hint">The Algorand Standard Asset ID for your project token.</span>
                  )}
                  {createdAsaId && (
                    <span className="field-hint" style={{ color: 'var(--accent)' }}>
                      ← Pre-filled from newly created token (ASA {createdAsaId})
                    </span>
                  )}
                </div>

                <div className="field">
                  <div className="field-label">Funding Goal (ALGO)</div>
                  <div className="readonly-field">{setupForm.goalAlgo || '—'} ALGO</div>
                  <span className="field-hint">Set at project creation — cannot be changed.</span>
                </div>

                <div className="field">
                  <div className="field-label">Exchange Rate</div>
                  <div className="readonly-field">
                    {setupForm.ratePerAlgo || '—'} token{setupForm.ratePerAlgo === '1' ? '' : 's'} per {setupForm.algoPerBundle || '1'} ALGO
                  </div>
                  <span className="field-hint">
                    Set at project creation — cannot be changed. Contributions below the
                    ratio round down to whole tokens. Token decimals are read on-chain
                    automatically during setup.
                  </span>
                </div>

                {setupForm.goalAlgo && setupForm.ratePerAlgo && (
                  <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: 14, fontSize: 13, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Tokens to provide:</span>
                      <span className="mono" style={{ color: 'var(--text)' }}>
                        {(Math.floor((+setupForm.goalAlgo || 0) * (+setupForm.ratePerAlgo || 0) / (+setupForm.algoPerBundle || 1)) * Math.pow(10, asaDecimals)).toLocaleString('en-US')}
                        {asaInfo?.symbol ? ` ${asaInfo.symbol}` : ''} base units
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                      Success fee (4%) is deducted from your payout when you claim. Listing fee was paid at deployment.
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                      Note: 0.4 ALGO is sent to the contract account to cover Algorand minimum balance requirements.
                    </div>
                  </div>
                )}
              </div>
            )}

            {setupTab === 'create' && (
              <div className="setup-modal-fields">
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.5 }}>
                  Create a new Algorand Standard Asset for your project. You will sign one transaction to deploy the token, then proceed to setup.
                </p>
                <div className="field">
                  <label htmlFor="mp-asa-name">Token name *</label>
                  <input id="mp-asa-name" className="input" placeholder="e.g. AlgoSwap Token" value={createAsaForm.name} onChange={e => setCreateAsaForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="field">
                  <label htmlFor="mp-asa-ticker">Ticker symbol *</label>
                  <input id="mp-asa-ticker" className="input" placeholder="e.g. ASWAP" value={createAsaForm.unitName} onChange={e => setCreateAsaForm(f => ({ ...f, unitName: e.target.value.toUpperCase().slice(0, 8) }))} />
                  <span className="field-hint">Up to 8 characters, uppercase.</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="field">
                    <label htmlFor="mp-asa-total">Total supply *</label>
                    <input id="mp-asa-total" className="input" type="text" inputMode="numeric" placeholder="e.g. 1000000" value={createAsaForm.total} onChange={e => setCreateAsaForm(f => ({ ...f, total: e.target.value.replace(/[^0-9]/g, '') }))} />
                    <span className="field-hint">Display units.</span>
                  </div>
                  <div className="field">
                    <label htmlFor="mp-asa-decimals">Decimals</label>
                    <select id="mp-asa-decimals" className="input" value={createAsaForm.decimals} onChange={e => setCreateAsaForm(f => ({ ...f, decimals: e.target.value }))}>
                      {[0,1,2,3,4,5,6].map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                </div>
                <button
                  className="btn btn-primary"
                  style={{ width: '100%', marginTop: 8 }}
                  disabled={creatingAsa || !createAsaForm.name || !createAsaForm.unitName || !createAsaForm.total}
                  onClick={handleCreateAsa}
                >
                  {creatingAsa ? 'Creating token…' : 'Create token & continue to setup'}
                </button>
              </div>
            )}

            <div className="setup-modal-actions">
              <button className="btn btn-ghost" onClick={() => setSetupModal(null)}>Cancel</button>
              {setupTab === 'existing' && (
                <button className="btn btn-primary" onClick={handleSetup} disabled={settingUp}>
                  {settingUp ? 'Processing…' : 'Set up contract'}
                </button>
              )}
            </div>
          </div>
        </div>
      , document.body)}
    </div>
  )
}
