import React, { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useWallet } from '@txnlab/use-wallet-react'
import {
  fetchOnChainBatch, fetchAppInfo,
  ADMIN_ADDRESS, signAndSend,
} from '../utils/algorand'
import { fetchAllProjectsAdmin, updateStatus, setVisibility, setFeatured, purgeProject } from '../utils/api'
import { buildAdminCancelTxn, buildAdminSweepAsaTxn, buildAdminClaimTxn, buildAdminFeeClaimTxn, buildDeleteAppTxn, encodeUnsignedTxns } from '../utils/transactions'
import { useToast } from '../context/ToastContext'
import {
  Cover, StatusBadge, IdTag, Progress, Icon,
  fmtAlgo, pctNum, daysLeftLabel, deriveProjectStatus, categoryHue, shortAddr,
} from '../components/UI'


export default function AdminDashboard() {
  const { activeAddress, signTransactions } = useWallet()
  const { addToast } = useToast()
  const [projects, setProjects]     = useState([])
  const [loading, setLoading]       = useState(true)
  const [filter, setFilter]         = useState('all')
  const [actioningId, setActioningId] = useState(null)

  const isAdmin = activeAddress === ADMIN_ADDRESS

  const loadProjects = useCallback(async () => {
    if (!activeAddress) { setLoading(false); return }
    setLoading(true)
    try {
      const metas = await fetchAllProjectsAdmin({ address: activeAddress })
      const metaList = Array.isArray(metas) ? metas : []

      // Skip algod calls for already-deleted contracts
      const uncachedIds = metaList
        .filter(m => !m.on_chain_deleted)
        .map(m => Number(m.app_id))
      const onChain = uncachedIds.length > 0
        ? await fetchOnChainBatch(uncachedIds)
        : {}

      const merged = metaList.map(meta => {
        const id = Number(meta.app_id)
        if (meta.on_chain_deleted) return { id, gs: {}, meta, deleted: true }
        const { gs, deleted } = onChain[id] ?? { gs: {}, deleted: true }
        return { id, gs, meta, deleted }
      })
      setProjects(merged)
    } catch (e) {
      console.error(e)
      addToast('Failed to load projects', 'error')
    } finally { setLoading(false) }
  }, [activeAddress])

  useEffect(() => { loadProjects() }, [loadProjects])

  async function handleCancel(appId) {
    if (!window.confirm('Cancel this project on-chain? This cannot be undone.')) return
    setActioningId(appId)
    try {
      const info = await fetchAppInfo(appId)
      if (info.gs?.admin && info.gs.admin !== activeAddress) {
        addToast(`Admin mismatch. On-chain admin is ${shortAddr(info.gs.admin)}`, 'error', 6000)
        return
      }
      await signAndSend(signTransactions, [(await buildAdminCancelTxn({ sender: activeAddress, appId })).toByte()])
      await updateStatus({ address: activeAddress, appId,  flags: { is_cancelled: true } })
      addToast('Project cancelled. Backers can now claim refunds from the project page, or use "Process refunds" below.', 'success', 6000)
      setProjects(prev => prev.map(p => p.id === appId ? { ...p, meta: { ...p.meta, is_cancelled: true } } : p))
    } catch (e) { addToast(e?.message || 'Cancel failed', 'error') }
    finally { setActioningId(null) }
  }

  // Failure path: investors claim own refunds from the project page.
  // Admin role on cancelled/failed campaigns is to direct investors to the
  // project page, then call admin_claim after failure_grace_expired.
  async function handleAdminRefund(appId) {
    setActioningId(appId)
    try {
      const info = await fetchAppInfo(appId)
      const asaId        = Number(info.gs?.asa_id ?? 0)
      const deadline     = Number(info.gs?.deadline ?? 0)
      const adminClaimed = Number(info.gs?.admin_claimed ?? 0) === 1
      const creatorAddress = info.gs?.creator

      if (adminClaimed) {
        await signAndSend(signTransactions, [(await buildDeleteAppTxn({ sender: activeAddress, appId })).toByte()])
        await updateStatus({ address: activeAddress, appId,  flags: { is_refunded: true } })
        addToast('Contract deleted.', 'success')
        setProjects(prev => prev.filter(p => p.id !== appId))
        return
      }

      // Close in two steps if needed — contract will reject if grace not expired
      if (asaId > 0) {
        addToast('Step 1: Sweeping ASA to creator…', 'info', 3000)
        await signAndSend(signTransactions, encodeUnsignedTxns([
          await buildAdminSweepAsaTxn({ sender: activeAddress, appId, asaId, creatorAddress })
        ]))
        addToast('ASA swept. Now closing ALGO…', 'info', 3000)
      }
      await signAndSend(signTransactions, encodeUnsignedTxns([
        await buildAdminClaimTxn({ sender: activeAddress, appId, creatorAddress })
      ]))
      addToast('Contract closed. Deleting app record…', 'info', 3000)
      await signAndSend(signTransactions, [(await buildDeleteAppTxn({ sender: activeAddress, appId })).toByte()])
      addToast('Contract deleted.', 'success')
      await updateStatus({ address: activeAddress, appId,  flags: { is_refunded: true } })
      setProjects(prev => prev.filter(p => p.id !== appId))
    } catch (e) {
      const msg = e?.message || ''
      // The Puya contract emits the assert message "grace not expired" for both
      // the ASA sweep and the ALGO close when the grace window is still open.
      if (/grace not expired/i.test(msg)) {
        addToast('Grace period has not yet expired. Return once the grace period ends (6 months after the deadline) to close the contract.', 'error', 8000)
      } else {
        addToast(msg || 'Failed', 'error')
      }
    } finally { setActioningId(null) }
  }

  // Collect the 4% success fee immediately once a campaign is funded — no grace
  // wait. Independent of the creator's claim. Call-once (admin_fee_claimed).
  async function handleCollectFee(appId) {
    setActioningId(appId)
    try {
      const info = await fetchAppInfo(appId)
      const fundedRound   = Number(info.gs?.funded_round ?? 0)
      const feeClaimed    = Number(info.gs?.admin_fee_claimed ?? 0) === 1
      if (fundedRound === 0) { addToast('This campaign is not funded yet.', 'error'); return }
      if (feeClaimed)        { addToast('The success fee has already been collected.', 'info'); return }
      await signAndSend(signTransactions, [
        (await buildAdminFeeClaimTxn({ sender: activeAddress, appId })).toByte()
      ])
      addToast('Success fee collected.', 'success')
    } catch (e) {
      addToast(e?.message || 'Fee claim failed', 'error')
    } finally { setActioningId(null) }
  }

  // Success path: admin closes contract after success_grace_expired.
  // Two-step: admin_sweep_asa first (if asa_id != 0), then admin_claim.
  async function handleSettle(appId) {
    setActioningId(appId)
    try {
      const info = await fetchAppInfo(appId)
      const asaId        = Number(info.gs?.asa_id ?? 0)
      const fundedRound  = Number(info.gs?.funded_round ?? 0)
      const adminClaimed = Number(info.gs?.admin_claimed ?? 0) === 1
      const creatorAddress = info.gs?.creator

      if (adminClaimed) {
        await signAndSend(signTransactions, [(await buildDeleteAppTxn({ sender: activeAddress, appId })).toByte()])
        await updateStatus({ address: activeAddress, appId,  flags: { is_distributed: true } })
        addToast('Contract deleted.', 'success')
        setProjects(prev => prev.filter(p => p.id !== appId))
        return
      }

      if (fundedRound === 0) {
        addToast('This campaign was never funded.', 'error')
        return
      }

      // Two-step close — contract will reject if grace not expired
      if (asaId > 0) {
        addToast('Step 1: Sweeping unclaimed tokens to creator…', 'info', 3000)
        await signAndSend(signTransactions, encodeUnsignedTxns([
          await buildAdminSweepAsaTxn({ sender: activeAddress, appId, asaId, creatorAddress })
        ]))
        addToast('ASA swept. Closing ALGO…', 'info', 3000)
      }
      await signAndSend(signTransactions, encodeUnsignedTxns([
        await buildAdminClaimTxn({ sender: activeAddress, appId, creatorAddress })
      ]))
      addToast('Contract closed — remainder returned to the creator. Deleting record…', 'info', 3000)
      await signAndSend(signTransactions, [(await buildDeleteAppTxn({ sender: activeAddress, appId })).toByte()])
      await updateStatus({ address: activeAddress, appId,  flags: { is_distributed: true } })
      addToast('Contract closed.', 'success')
      setProjects(prev => prev.filter(p => p.id !== appId))
    } catch (e) {
      const msg = e?.message || ''
      if (/grace not expired/i.test(msg)) {
        addToast('Grace period has not yet expired. Backers still have time to claim their tokens.', 'error', 8000)
      } else {
        addToast(msg || 'Settle failed', 'error')
      }
    } finally { setActioningId(null) }
  }

  async function handleToggleVisibility(appId, currentHidden) {
    try {
      await setVisibility({ address: activeAddress, appId, hidden: !currentHidden, signTransactions })
      setProjects(prev => prev.map(p => p.id === appId ? { ...p, meta: { ...p.meta, is_hidden: !currentHidden } } : p))
    } catch (e) { addToast(e?.message || 'Failed to update visibility', 'error') }
  }

  async function handleToggleFeatured(appId, currentFeatured) {
    try {
      // Count currently featured projects to assign next order slot
      const featuredProjects = projects.filter(p => p.meta?.is_featured && p.id !== appId)
      if (!currentFeatured && featuredProjects.length >= 3) {
        return addToast('Only 3 projects can be featured at a time. Unfeature one first.', 'error', 5000)
      }
      const nextOrder = currentFeatured ? 0 : featuredProjects.length + 1
      await setFeatured({ address: activeAddress, appId, featured: !currentFeatured, featureOrder: nextOrder, signTransactions })
      setProjects(prev => prev.map(p =>
        p.id === appId
          ? { ...p, meta: { ...p.meta, is_featured: !currentFeatured, feature_order: nextOrder } }
          : p
      ))
      addToast(currentFeatured ? 'Removed from hero.' : 'Added to hero art!', 'success', 2500)
    } catch (e) { addToast(e?.message || 'Failed to update featured status', 'error') }
  }

  async function handlePurge(appId, name) {
    if (!window.confirm(`Permanently remove "${name}" from the database? This cannot be undone.`)) return
    try {
      await purgeProject({ address: activeAddress, appId, signTransactions })
      setProjects(prev => prev.filter(p => p.id !== appId))
      addToast('Project removed from database.', 'success')
    } catch (e) { addToast(e?.message || 'Failed to purge', 'error') }
  }

  function projectStatus(p) {
    const m = p.meta || {}
    if (m.is_refunded) return 'refunded'
    if (m.is_distributed || m.is_funded || (p.deleted && !m.is_refunded && !m.is_cancelled)) return 'distributed'
    if (p.deleted) return 'deleted'
    if (m.is_cancelled || Number(p.gs?.cancelled ?? 0) === 1) return 'cancelled'
    const raised = Number(p.gs?.raised ?? 0)
    const goal   = Number(p.gs?.goal   ?? 1)
    if (raised >= goal) return 'funded'
    return 'active'
  }

  const filtered = projects.filter(p => {
    const status = projectStatus(p)
    if (filter === 'hidden')   return !!p.meta?.is_hidden
    if (filter === 'featured') return !!p.meta?.is_featured
    if (p.meta?.is_hidden && filter !== 'hidden') return false
    if (filter === 'all') return true
    return status === filter
  })

  const stats = {
    total:       projects.length,
    distributed: projects.filter(p => projectStatus(p) === 'distributed').length,
    funded:      projects.filter(p => projectStatus(p) === 'funded').length,
    cancelled:   projects.filter(p => projectStatus(p) === 'cancelled').length,
    deleted:     projects.filter(p => projectStatus(p) === 'deleted').length,
    refunded:    projects.filter(p => projectStatus(p) === 'refunded').length,
    featured:    projects.filter(p => !!p.meta?.is_featured).length,
  }

  if (!isAdmin) {
    return (
      <div className="wrap rise">
        <div className="empty-state" style={{ paddingTop: 100 }}>
          <Icon.shield style={{ width: 48, height: 48, color: 'var(--danger)' }} />
          <h3>Access restricted</h3>
          <p>Connect the admin wallet to access this page.<br />
            <span className="mono" style={{ fontSize: 12 }}>{ADMIN_ADDRESS ? shortAddr(ADMIN_ADDRESS) : 'Not configured'}</span>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="wrap rise">
      <div className="page-head" style={{ alignItems: 'flex-start' }}>
        <div>
          <span className="badge badge-danger" style={{ marginBottom: 14 }}>
            <Icon.shield style={{ width: 12, height: 12 }} /> Admin · {shortAddr(activeAddress)}
          </span>
          <h1>Admin Dashboard</h1>
          <p>Oversee every campaign, hide policy-violating content, and trigger refunds on cancellation.</p>
        </div>
        <div className="card admin-stats">
          <div className="astat"><div className="astat-v">{stats.total}</div><div className="astat-l">Total</div></div>
          <div className="astat"><div className="astat-v" style={{ color: 'var(--accent)' }}>{stats.distributed}</div><div className="astat-l">Distributed</div></div>
          <div className="astat"><div className="astat-v" style={{ color: 'var(--success)' }}>{stats.funded}</div><div className="astat-l">Funded</div></div>
          <div className="astat"><div className="astat-v" style={{ color: 'var(--danger)' }}>{stats.cancelled}</div><div className="astat-l">Cancelled</div></div>
        </div>
      </div>

      <div className="mp-filters">
        {[
          { key: 'all',         label: `All (${stats.total})` },
          { key: 'active',      label: 'Active' },
          { key: 'funded',      label: 'Funded' },
          { key: 'distributed', label: 'Distributed' },
          { key: 'cancelled',   label: 'Cancelled' },
          { key: 'refunded',    label: 'Refunded' },
          { key: 'deleted',     label: `Deleted (${stats.deleted})` },
          { key: 'featured',    label: `★ Featured (${stats.featured}/3)` },
          { key: 'hidden',      label: 'Hidden' },
        ].map(f => (
          <button key={f.key} className={`chip${filter === f.key ? ' active' : ''}`} onClick={() => setFilter(f.key)}>{f.label}</button>
        ))}
      </div>

      <div className="card admin-table">
        <div className="atable-head">
          <span>Project</span>
          <span>Funding</span>
          <span>Status</span>
          <span style={{ textAlign: 'right' }}>Actions</span>
        </div>

        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-faint)' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 36, textAlign: 'center', color: 'var(--text-faint)', fontSize: 14 }}>No projects in this view.</div>
        ) : filtered.map(p => {
          const status    = projectStatus(p)
          const isHidden  = !!p.meta?.is_hidden
          const isCancelled = status === 'cancelled'
          const isDistributed = status === 'distributed'
          const raised    = Number(p.gs?.raised ?? 0)
          const goal      = Number(p.gs?.goal   ?? p.meta?.goal_micro ?? 1)
          const pct       = pctNum(raised, goal)
          const days      = daysLeftLabel(Number(p.gs?.deadline ?? 0), 0)
          const hue       = categoryHue(p.meta?.category)
          const isActioning = actioningId === p.id

          return (
            <div className="atable-row" key={p.id} style={isHidden ? { opacity: 0.55 } : undefined}>
              {/* Project */}
              <div className="atrow-proj">
                <Cover hue={hue} sym={p.meta?.token_name} imageUrl={p.meta?.image_url} label="" style={{ width: 44, height: 44, borderRadius: 10, flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <div className="mp-name" style={{ fontSize: 16 }}>{p.meta?.name || `#${p.id}`}</div>
                  <div className="mp-meta" style={{ marginTop: 5 }}>
                    <span className="faint" style={{ fontSize: 12 }}>{shortAddr(p.meta?.creator_address)}</span>
                    <IdTag label="App" value={String(p.id)} />
                    <span className="badge" style={{ padding: '2px 8px', fontSize: 10.5 }}>{p.meta?.category || 'Other'}</span>
                  </div>
                </div>
              </div>

              {/* Funding */}
              <div className="mp-fund">
                <div className="mp-fund-top">
                  <b>{fmtAlgo(raised / 1_000_000)}</b>
                  <span className="faint">/ {fmtAlgo(goal / 1_000_000)} ALGO</span>
                </div>
                <Progress raised={raised} goal={goal} />
                <span className="faint" style={{ fontSize: 11.5 }}>
                  {pct}% · {days.ended ? 'ended' : days.text}
                </span>
              </div>

              {/* Status */}
              <div><StatusBadge status={status} /></div>

              {/* Actions */}
              <div className="atrow-actions">
                {!isCancelled && !isDistributed && status !== 'funded' && (
                  <button
                    className="btn btn-danger btn-sm"
                    disabled={isActioning}
                    onClick={() => handleCancel(p.id)}
                  >
                    Cancel & refund
                  </button>
                )}
                {isCancelled && (
                  <button
                    className="btn btn-soft btn-sm"
                    disabled={isActioning}
                    onClick={() => handleAdminRefund(p.id)}
                  >
                    {isActioning ? 'Processing…' : 'Close contract'}
                  </button>
                )}
                {!isCancelled && status === 'funded' && (
                  <>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={isActioning || p.meta?.on_chain_admin_fee_claimed}
                      onClick={() => handleCollectFee(p.id)}
                      title="Collect the 4% success fee now — no grace wait"
                    >
                      {p.meta?.on_chain_admin_fee_claimed ? 'Fee collected' : 'Collect 4% fee'}
                    </button>
                    <button
                      className="btn btn-soft btn-sm"
                      disabled={isActioning}
                      onClick={() => handleSettle(p.id)}
                    >
                      {isActioning ? 'Processing…' : 'Settle (grace close)'}
                    </button>
                  </>
                )}

                <button className="hide-toggle" onClick={() => handleToggleVisibility(p.id, isHidden)}>
                  <span className={`switch${isHidden ? ' on' : ''}`}><i /></span>
                  {isHidden ? 'Hidden' : 'Visible'}
                </button>

                <button
                  className="hide-toggle"
                  style={{ color: p.meta?.is_featured ? 'var(--warn)' : 'var(--text-faint)' }}
                  onClick={() => handleToggleFeatured(p.id, !!p.meta?.is_featured)}
                  title={p.meta?.is_featured ? `Featured (position ${p.meta?.feature_order})` : 'Add to hero art'}
                >
                  {p.meta?.is_featured ? '★' : '☆'} Hero
                </button>

                {(p.deleted || isDistributed || p.meta?.is_refunded || status === 'deleted') && (
                  <button
                    className="btn btn-sm"
                    style={{ background: 'var(--danger-soft)', color: 'var(--danger)', border: 'none', fontSize: 12 }}
                    onClick={() => handlePurge(p.id, p.meta?.name || `#${p.id}`)}
                  >
                    Purge DB
                  </button>
                )}

                <Link to={`/project/${p.id}`} className="atrow-view">View ↗</Link>
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ height: 64 }} />
    </div>
  )
}
