import React, { useEffect, useState, useCallback } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import { algodClient, signAndSend, shortAddr as shortAddrAlgo } from '../utils/algorand'


import { buildClearStateTxn, buildAsaCloseTxn } from '../utils/transactions'
import { useToast } from '../context/ToastContext'
import { Icon, IdTag, shortAddr } from '../components/UI'

export default function CleanupWallet() {
  const { activeAddress, signTransactions } = useWallet()
  const { addToast } = useToast()

  const [appEntries, setAppEntries]   = useState([])
  const [asaEntries, setAsaEntries]   = useState([])
  const [loading, setLoading]         = useState(false)
  const [actioningId, setActioningId] = useState(null)
  const [manualAppId, setManualAppId] = useState('')
  const [manualStatus, setManualStatus] = useState(null)
  const [manualClearing, setManualClearing] = useState(false)
  const [manualDeleting, setManualDeleting] = useState(false)

  async function handleManualClear() {
    if (!manualAppId || !activeAddress) return
    const appId = Number(manualAppId)
    if (!appId) { setManualStatus({ msg: 'Enter a valid numeric App ID.', type: 'error' }); return }
    const confirmed = window.confirm(
      `⚠️ Opt out of app ${appId}?\n\nThis permanently removes your local state. Any unclaimed contributions will be forfeited.\n\nProceed?`
    )
    if (!confirmed) return
    setManualClearing(true)
    setManualStatus({ msg: 'Sending to wallet for signing…', type: 'info' })
    try {
      await signAndSend(signTransactions, [(await buildClearStateTxn({ sender: activeAddress, appId })).toByte()])
      setManualStatus({ msg: `App ${appId} cleared. ~0.1 ALGO reclaimed.`, type: 'success' })
      setManualAppId('')
    } catch (e) {
      setManualStatus({ msg: e?.message || 'Clear state failed.', type: 'error' })
    } finally { setManualClearing(false) }
  }

  async function handleManualDelete() {
    if (!manualAppId || !activeAddress) return
    const appId = Number(manualAppId)
    if (!appId) { setManualStatus({ msg: 'Enter a valid numeric App ID.', type: 'error' }); return }
    const confirmed = window.confirm(
      `⚠️ Delete app ${appId}?\n\nThis calls DeleteApplication. The contract's approval program must allow deletion from your address — it will be rejected if conditions aren't met.\n\nProceed?`
    )
    if (!confirmed) return
    setManualDeleting(true)
    setManualStatus({ msg: 'Sending to wallet for signing…', type: 'info' })
    try {
      const { buildDeleteAppTxn } = await import('../utils/transactions')
      await signAndSend(signTransactions, [(await buildDeleteAppTxn({ sender: activeAddress, appId })).toByte()])
      setManualStatus({ msg: `App ${appId} deleted successfully. Minimum balance reservation returned.`, type: 'success' })
      setManualAppId('')
    } catch (e) {
      setManualStatus({ msg: e?.message || 'Delete app failed.', type: 'error' })
    } finally { setManualDeleting(false) }
  }

  const loadEntries = useCallback(async () => {
    if (!activeAddress) return
    setLoading(true)
    try {
      const info = await algodClient.accountInformation(activeAddress).do()
      const rawApps   = info['apps-local-state'] ?? info.appsLocalState ?? []
      const rawAssets = info.assets ?? []

      // Fetch project metadata from backend for name lookup
      let metas = []
      try {
        const result = await fetchPublicProjects()
        metas = Array.isArray(result) ? result : (result.projects ?? [])
      } catch {}
      const metaMap = {}
      for (const m of metas) metaMap[String(m.app_id)] = m

      // App opt-ins
      const parsedApps = rawApps.map(entry => {
        const appId = Number(entry.id ?? entry['id'])
        const meta  = metaMap[String(appId)] || null
        const kvs   = entry['key-value'] ?? entry.keyValue ?? []
        let contrib = 0
        for (const kv of kvs) {
          let key = kv.key
          if (key instanceof Uint8Array) key = new TextDecoder().decode(key)
          else try { key = atob(key) } catch { continue }
          if (key === 'contrib') contrib = Number(kv.value?.uint ?? 0)
        }
        return { appId, meta, contrib }
      })
      setAppEntries(parsedApps)

      // ASA holdings linked to platform projects
      if (rawAssets.length > 0) {
        const asaResults = []
        await Promise.all(
          metas.map(async (meta) => {
            const appId = Number(meta.app_id)
            try {
              const appInfo = await algodClient.getApplicationByID(appId).do()
              if (appInfo.deleted) return
              const gs = appInfo.params?.['global-state'] ?? appInfo.params?.globalState ?? []
              let asaId = 0, creator = ''
              for (const item of gs) {
                let key = item.key
                if (key instanceof Uint8Array) key = new TextDecoder().decode(key)
                else try { key = atob(key) } catch { continue }
                if (key === 'asa_id') asaId = Number(item.value?.uint ?? 0)
                if (key === 'creator') {
                  const raw = item.value?.bytes
                  if (raw instanceof Uint8Array && raw.length === 32) {
                    const algosdk = (await import('algosdk')).default
                    creator = algosdk.encodeAddress(raw)
                  } else if (typeof raw === 'string' && raw) {
                    try {
                      const bin = atob(raw)
                      const arr = new Uint8Array(bin.length)
                      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
                      const algosdk = (await import('algosdk')).default
                      creator = algosdk.encodeAddress(arr)
                    } catch {}
                  }
                }
              }
              if (!asaId) return
              const holding = rawAssets.find(a => Number(a['asset-id'] ?? a.assetId) === asaId)
              if (holding) asaResults.push({ asaId, appId, meta, balance: Number(holding.amount ?? 0), closeTo: creator })
            } catch {}
          })
        )
        // Deduplicate by ASA ID — multiple campaigns may use the same token
        const seen = new Set()
        const dedupedAsas = asaResults.filter(a => {
          if (seen.has(a.asaId)) return false
          seen.add(a.asaId)
          return true
        })
        setAsaEntries(dedupedAsas)
      } else {
        setAsaEntries([])
      }
    } catch (e) {
      console.error(e)
      addToast('Failed to load wallet state', 'error')
    } finally { setLoading(false) }
  }, [activeAddress])

  useEffect(() => { loadEntries() }, [loadEntries])

  async function handleClearApp(appId, contrib, force = false) {
    const meta = appEntries.find(e => e.appId === appId)?.meta
    const isDonationFunded = meta?.is_donation && (meta?.is_funded || meta?.is_distributed)
    if (contrib > 0 && !force) {
      addToast('Use "Force clear" to opt out and forfeit your pending contribution.', 'error', 6000)
      return
    }
    if (contrib > 0 && force && !isDonationFunded) {
      const confirmed = window.confirm(
        `⚠️ You MAY have ${(contrib / 1_000_000).toFixed(6)} ALGO pending in app ${appId}.\n\nForce clearing will permanently forfeit this amount. It cannot be recovered.\n\nProceed?`
      )
      if (!confirmed) return
    }
    setActioningId(`app-${appId}`)
    try {
      await signAndSend(signTransactions, [(await buildClearStateTxn({ sender: activeAddress, appId })).toByte()])
      const meta = appEntries.find(e => e.appId === appId)?.meta
      const isDonationFunded = meta?.is_donation && (meta?.is_funded || meta?.is_distributed)
      addToast(
        contrib > 0 && !isDonationFunded
          ? `App local state cleared. ~0.1 ALGO reclaimed. Note: ${(contrib / 1_000_000).toFixed(6)} ALGO contribution was forfeited.`
          : 'App local state cleared. ~0.1 ALGO reclaimed.',
        contrib > 0 && !isDonationFunded ? 'info' : 'success'
      )
      setAppEntries(prev => prev.filter(e => e.appId !== appId))
    } catch (e) { addToast(e?.message || 'Clear state failed', 'error') }
    finally { setActioningId(null) }
  }

  async function handleCloseAsa(asaId, closeTo) {
    setActioningId(`asa-${asaId}`)
    try {
      const recipient = closeTo || activeAddress
      await signAndSend(signTransactions, [(await buildAsaCloseTxn({ sender: activeAddress, asaId, closeTo: recipient })).toByte()])
      addToast('Asset holding closed. ~0.1 ALGO reclaimed.', 'success')
      setAsaEntries(prev => prev.filter(e => e.asaId !== asaId))
    } catch (e) { addToast(e?.message || 'Asset close failed', 'error') }
    finally { setActioningId(null) }
  }

  const totalReclaimable = (appEntries.length + asaEntries.length) * 0.1

  if (!activeAddress) {
    return (
      <div className="wrap rise">
        <div className="empty-state" style={{ paddingTop: 100 }}>
          <Icon.spark style={{ width: 48, height: 48, color: 'var(--accent)' }} />
          <h3>Connect your wallet</h3>
          <p>Connect to see your reservations and reclaim minimum balance.</p>
        </div>
      </div>
    )
  }

  const allClear = !loading && appEntries.length === 0 && asaEntries.length === 0

  return (
    <div className="wrap rise">
      {/* Page head */}
      <div className="page-head" style={{ alignItems: 'flex-start' }}>
        <div>
          <span className="eyebrow">Maintenance</span>
          <h1 style={{ marginTop: 10 }}>Wallet Cleanup</h1>
          <p style={{ maxWidth: 540 }}>
            Each app opt-in and ASA holding locks 0.1 ALGO as a minimum-balance reservation.
            Release the ones you no longer need to reclaim that ALGO.
          </p>
        </div>
        <button className="btn btn-ghost" onClick={loadEntries} disabled={loading}>
          <Icon.refund style={{ width: 16, height: 16 }} /> Refresh
        </button>
      </div>

      {/* ClearState warning */}
      <div className="card" style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', borderRadius: 'var(--r-md)', padding: '14px 18px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <Icon.shield style={{ width: 18, height: 18, color: 'var(--danger)', flexShrink: 0, marginTop: 2 }} />
        <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>
          <strong style={{ color: 'var(--danger)' }}>Important — do not use "Remove app" while you have a pending contribution.</strong>
          {' '}Algorand's ClearState operation bypasses the contract's approval program and always succeeds.
          If you clear an app opt-in while your contribution ({'>'}0) is still recorded, that ALGO is
          permanently forfeited — it cannot be refunded. Only clear an app after you have received
          your tokens or your refund has been processed. Apps with a pending contribution show a
          "Pending refund" badge and have the clear button disabled.
        </div>
      </div>

      {/* Summary bar */}
      <div className="card cleanup-summary">
        <div className="csum">
          <span className="csum-l">Wallet</span>
          <span className="csum-v mono" style={{ fontSize: 14 }}>{shortAddr(activeAddress)}</span>
        </div>
        <div className="csum">
          <span className="csum-l">App opt-ins</span>
          <span className="csum-v">{loading ? '…' : appEntries.length}</span>
        </div>
        <div className="csum">
          <span className="csum-l">Token holdings</span>
          <span className="csum-v">{loading ? '…' : asaEntries.length}</span>
        </div>
        <div className="csum">
          <span className="csum-l">Total reclaimable</span>
          <span className="csum-v" style={{ color: 'var(--accent)' }}>
            ~{loading ? '…' : totalReclaimable.toFixed(1)} ALGO
          </span>
        </div>
      </div>

      {loading ? (
        <div className="empty-state" style={{ paddingTop: 60 }}>
          <div className="sk-pulse" style={{ width: 48, height: 48, borderRadius: '50%' }} />
          <p>Scanning wallet…</p>
        </div>
      ) : allClear ? (
        <div className="empty-state" style={{ paddingTop: 60 }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--success-soft)', color: 'var(--success)', display: 'grid', placeItems: 'center' }}>
            <Icon.check style={{ width: 28, height: 28 }} />
          </div>
          <h3>All clear</h3>
          <p>No reservations found for Sprout projects. Your minimum balance is fully optimised.</p>
        </div>
      ) : (
        <>
          {/* App opt-ins */}
          {appEntries.length > 0 && (
            <div className="cleanup-section">
              <div className="cleanup-head">
                <h3>App opt-ins</h3>
                <span className="faint">0.1 ALGO each</span>
              </div>
              <div className="card">
                {appEntries.map(({ appId, meta, contrib }) => {
                  // Donation campaigns: contrib is a historical record, not a pending claim
                  // Safe to clear if the campaign is funded (ALGO already with creator)
                  // or if it's a donation campaign generally (no token claim possible)
                  const isDonationFunded = meta?.is_donation && (meta?.is_funded || meta?.is_distributed)
                  const hasPendingClaim  = contrib > 0 && !isDonationFunded

                  return (
                  <div className="clean-row" key={`app-${appId}`}>
                    <div>
                      <div className="clean-name">{meta?.name || `App #${appId}`}</div>
                      <div className="mp-meta" style={{ marginTop: 6 }}>
                        <IdTag label="App" value={String(appId)} />
                        {hasPendingClaim
                          ? <span className="badge badge-warn" style={{ padding: '2px 9px', fontSize: 11 }}>⚠ Pending refund — do not clear</span>
                          : <span className="badge" style={{ padding: '2px 9px', fontSize: 11 }}>Ready to clear</span>
                        }
                      </div>
                      {hasPendingClaim && (
                        <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>
                          You MAY have {(contrib / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 6 })} ALGO pending.
                          Clearing now would forfeit it permanently. Please verify that ALGO has been withdrawn before closing.
                        </div>
                      )}
                      {isDonationFunded && contrib > 0 && (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                          Contribution campaign — your contribution has already been received by the creator.
                        </div>
                      )}
                    </div>
                    <div className="clean-amt">
                      <span className="clean-amt-v">−0.1 ALGO</span>
                      <span className="faint" style={{ fontSize: 11 }}>reclaimable</span>
                    </div>
                    {hasPendingClaim
                      ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                          <button className="btn btn-ghost btn-sm" disabled>Pending refund</button>
                          <button
                            className="btn btn-sm"
                            style={{ background: 'var(--danger-soft)', color: 'var(--danger)', border: 'none', fontSize: 12 }}
                            disabled={actioningId === `app-${appId}`}
                            onClick={() => handleClearApp(appId, contrib, true)}
                          >
                            {actioningId === `app-${appId}` ? 'Clearing…' : 'Force clear'}
                          </button>
                        </div>
                      )
                      : (
                        <button
                          className="btn btn-soft btn-sm"
                          disabled={actioningId === `app-${appId}`}
                          onClick={() => handleClearApp(appId, contrib, isDonationFunded)}
                        >
                          {actioningId === `app-${appId}` ? 'Clearing…' : 'Clear & reclaim'}
                        </button>
                      )
                    }
                  </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Token holdings */}
          {asaEntries.length > 0 && (
            <div className="cleanup-section">
              <div className="cleanup-head">
                <h3>Token holdings</h3>
                <span className="faint">closes the ASA and returns any balance to the creator</span>
              </div>
              <div className="card">
                {asaEntries.map(({ asaId, appId, meta, balance, closeTo }) => (
                  <div className="clean-row" key={`asa-${asaId}`}>
                    <div>
                      <div className="clean-name">{meta?.token_name || meta?.name || `Project #${appId}`}</div>
                      <div className="mp-meta" style={{ marginTop: 6 }}>
                        <IdTag label="ASA" value={String(asaId)} />
                        {balance > 0 && (
                          <span className="faint">Balance {balance.toLocaleString('en-US')} — returned to creator</span>
                        )}
                      </div>
                    </div>
                    <div className="clean-amt">
                      <span className="clean-amt-v">−0.1 ALGO</span>
                      <span className="faint" style={{ fontSize: 11 }}>reclaimable</span>
                    </div>
                    <button
                      className="btn btn-soft btn-sm"
                      disabled={actioningId === `asa-${asaId}`}
                      onClick={() => handleCloseAsa(asaId, closeTo)}
                    >
                      {actioningId === `asa-${asaId}` ? 'Closing…' : 'Close & reclaim'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="sum-note" style={{ maxWidth: '100%', marginTop: 8 }}>
        App ClearState bypasses the approval program and always succeeds — never use it while you have a pending contribution or you will permanently forfeit that ALGO.
        Token close-outs send any remaining balance to the project creator and release the 0.1 ALGO reservation.
        Only Sprout project tokens are shown here.
      </div>

      {/* Manual opt-out tool */}
      <div className="cleanup-section" style={{ marginTop: 40 }}>
        <div className="cleanup-head">
          <h3>Manual opt-out</h3>
          <span className="faint">for orphaned or non-Sprout apps</span>
        </div>
        <div className="card" style={{ padding: '20px 24px' }}>
          <p style={{ fontSize: 13.5, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.6 }}>
            If an app doesn't appear above — for example, an orphaned contract from a failed deployment —
            enter its App ID below to opt out directly from your connected wallet.
          </p>

          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <label htmlFor="cw-app-id" style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>App ID</label>
              <input
                id="cw-app-id"
                className="input"
                type="text"
                inputMode="numeric"
                placeholder="e.g. 763956173"
                value={manualAppId}
                onChange={e => { setManualAppId(e.target.value.replace(/\D/g, '')); setManualStatus(null) }}
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
            </div>
            <button
              className="btn btn-soft btn-sm"
              disabled={manualClearing || manualDeleting || !manualAppId}
              onClick={handleManualClear}
              style={{ whiteSpace: 'nowrap' }}
            >
              {manualClearing ? 'Processing…' : 'Opt out (ClearState)'}
            </button>
            <button
              className="btn btn-sm"
              style={{ whiteSpace: 'nowrap', background: 'var(--danger-soft)', color: 'var(--danger)', border: 'none' }}
              disabled={manualClearing || manualDeleting || !manualAppId}
              onClick={handleManualDelete}
            >
              {manualDeleting ? 'Deleting…' : 'Delete app'}
            </button>
          </div>

          {manualStatus && (
            <div style={{
              padding: '10px 14px', borderRadius: 8, fontSize: 13,
              background: manualStatus.type === 'error' ? 'var(--danger-soft)' : manualStatus.type === 'success' ? 'var(--success-soft)' : 'var(--surface-2)',
              color: manualStatus.type === 'error' ? 'var(--danger)' : manualStatus.type === 'success' ? 'var(--success)' : 'var(--text-muted)',
            }}>
              {manualStatus.msg}
            </div>
          )}

          <div style={{ marginTop: 16, padding: '10px 14px', background: 'var(--danger-soft)', borderRadius: 8, borderLeft: '3px solid var(--danger)', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            <strong style={{ color: 'var(--danger)' }}>Warning:</strong> ClearState permanently deletes your local state for this app.
            Any unclaimed contributions will be forfeited. Only use this for apps where the contract no longer exists on-chain.
          </div>
        </div>
      </div>

      <div style={{ height: 64 }} />
    </div>
  )
}
