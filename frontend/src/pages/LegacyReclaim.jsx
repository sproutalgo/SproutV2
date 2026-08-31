// ============================================================================
// LegacyReclaim.jsx  —  ISOLATED, DISPOSABLE legacy page.
//
// Purpose: let the Addict Rabbit Gang (ARG) creator reclaim their deposited
// project tokens from the OLD PyTeal contract (app 3659254517), which this new
// Puya site otherwise cannot service.
//
// Why this is separate from everything else:
//   • ARG runs the OLD contract, which dispatches on a RAW STRING app arg
//     ("creator_reclaim_asa"), NOT the 4-byte ARC-4 selectors the rest of this
//     site (transactions.js) builds. So none of the normal builders work here.
//   • This file therefore builds the OLD-FORMAT call directly with algosdk,
//     while borrowing only the site's wallet plumbing (signAndSend, algodClient).
//   • It is HARDCODED to ARG's app id and creator address. It will not operate
//     on any other app. When ARG has reclaimed, delete this file and its route.
//
// The old contract's creator_reclaim_asa (verified against the deployed source):
//   Assert group_size == 1; Assert is_creator; Assert failed; Assert asa_id != 0
//   → inner AssetTransfer with asset_close_to = creator (closes the full ASA
//     holding back to the creator), then sets asa_id = 0.
//   Requirement: the CREATOR must be opted into the ASA first, or the inner
//   close reverts (nothing lost — opt in and retry).
// ============================================================================
import React, { useEffect, useState, useCallback } from 'react'
import algosdk from 'algosdk'
import { useWallet } from '@txnlab/use-wallet-react'
import {
  algodClient, signAndSend, shortAddr, fetchAppInfo, ADMIN_ADDRESS,
} from '../utils/algorand'
import { useToast } from '../context/ToastContext'
import { Icon } from '../components/UI'

// ── Hardcoded ARG identifiers (this page services ONLY this campaign) ────────
const ARG_APP_ID = 3659254517
const ARG_CREATOR = 'XTZNP63VHIX6LJTQ7A55MDF6UARGBMRPJUPGNCFPP3GO6GDBOCFCPCZ7IU'

// Old-contract string-dispatch method name.
const RECLAIM_METHOD = 'creator_reclaim_asa'

export default function LegacyReclaim() {
  const { activeAddress, signTransactions } = useWallet()
  const { addToast } = useToast()

  const [loading, setLoading]   = useState(true)
  const [state, setState]       = useState(null)   // { asaId, failed, cancelled, fundedRound, raised, goal }
  const [optedIn, setOptedIn]   = useState(null)    // creator opted into the ASA?
  const [working, setWorking]   = useState(false)
  const [done, setDone]         = useState(false)
  const [error, setError]       = useState(null)

  const isCreator = !!activeAddress && activeAddress === ARG_CREATOR
  // The admin may VIEW this page as a preview before it goes live, but cannot
  // perform the reclaim — the old contract asserts is_creator, so an admin-sent
  // call would revert. All ACTIONS below stay gated to isCreator; isAdmin only
  // unlocks viewing.
  const isAdmin  = !!activeAddress && !!ADMIN_ADDRESS && activeAddress === ADMIN_ADDRESS
  const isViewer = isCreator || isAdmin

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const info = await fetchAppInfo(ARG_APP_ID)
      const gs = info.gs || {}
      const asaId       = Number(gs.asa_id ?? 0)
      const cancelled   = Number(gs.cancelled ?? 0) === 1
      const fundedRound = Number(gs.funded_round ?? 0)
      const raised      = Number(gs.raised ?? 0)
      const goal        = Number(gs.goal ?? 0)
      const deadline    = Number(gs.deadline ?? 0)

      // Determine "failed". The real bug was the round read: algosdk v3
      // camelCases the status field to `lastRound`, so reading `last-round` gave
      // undefined -> NaN and the deadline comparison silently failed. Read both
      // spellings so it works across SDK versions.
      let round = 0
      try {
        const status = await algodClient.status().do()
        round = Number(status.lastRound ?? status['last-round'] ?? 0)
      } catch { /* best-effort; if it fails we fall back to cancelled-only */ }

      // failed = didn't succeed AND genuinely ended (cancelled OR deadline passed).
      // A still-active campaign (funded_round 0, before deadline) is NOT failed.
      const succeeded   = fundedRound > 0
      const pastDeadline = round > 0 && round > deadline
      const failed = !succeeded && (cancelled || pastDeadline)

      setState({ asaId, cancelled, fundedRound, raised, goal, deadline, failed })

      // Is the creator opted into the ASA? (required for the close to succeed)
      // Only relevant when the creator is connected; for the admin preview we
      // don't check (the admin never performs the reclaim).
      if (asaId && isCreator) {
        try {
          await algodClient.accountAssetInformation(ARG_CREATOR, asaId).do()
          setOptedIn(true)
        } catch {
          setOptedIn(false)
        }
      } else {
        setOptedIn(null)
      }
    } catch (e) {
      setError(e?.message || 'Failed to read campaign state from chain.')
    } finally {
      setLoading(false)
    }
  }, [isCreator, isAdmin])

  useEffect(() => { load() }, [load])

  // Build the OLD-FORMAT reclaim call: lone NoOp app call, raw string arg,
  // foreign asset = asaId, outer fee covers the single inner txn (2x min).
  async function buildReclaimTxn() {
    const sp = await algodClient.getTransactionParams().do()
    sp.flatFee = true
    sp.fee = 2000 // covers this call + the one inner asset_close_to (inner fee 0)
    return algosdk.makeApplicationNoOpTxnFromObject({
      sender: ARG_CREATOR,
      appIndex: ARG_APP_ID,
      appArgs: [new TextEncoder().encode(RECLAIM_METHOD)],
      foreignAssets: [Number(state.asaId)],
      suggestedParams: sp,
    })
  }

  // Optional helper: opt the creator into the ASA if they aren't already.
  async function handleOptIn() {
    if (!isCreator || !state?.asaId) return
    setWorking(true)
    try {
      const sp = await algodClient.getTransactionParams().do()
      const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: ARG_CREATOR, receiver: ARG_CREATOR, amount: 0,
        assetIndex: Number(state.asaId), suggestedParams: sp,
      })
      await signAndSend(signTransactions, [txn.toByte()])
      addToast('Opted into the project token. You can now reclaim.', 'success')
      await load()
    } catch (e) {
      addToast(e?.message || 'Opt-in failed.', 'error')
    } finally { setWorking(false) }
  }

  async function handleReclaim() {
    if (!isCreator) return addToast('Connect the campaign creator wallet first.', 'info')
    if (!state?.failed) return addToast('Reclaim is only available after the campaign has failed.', 'error')
    if (!state?.asaId) return addToast('This campaign no longer holds the project token — nothing to reclaim.', 'info')
    if (optedIn === false) return addToast('Opt into the project token first (button above).', 'error')
    setWorking(true)
    try {
      const txn = await buildReclaimTxn()
      await signAndSend(signTransactions, [txn.toByte()])
      addToast('Tokens reclaimed to your wallet.', 'success')
      setDone(true)
      await load()
    } catch (e) {
      addToast(e?.message || 'Reclaim failed. If you just opted in, wait a moment and retry.', 'error')
    } finally { setWorking(false) }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const wrap = (children) => (
    <div className="wrap rise" style={{ maxWidth: 640 }}>
      <div className="page-head" style={{ alignItems: 'flex-start' }}>
        <div>
          <span className="eyebrow">Legacy · one-time</span>
          <h1 style={{ marginTop: 10 }}>Reclaim Addict Rabbit Gang tokens</h1>
          <p style={{ maxWidth: 540 }}>
            This campaign was created on Sprout's previous contract. Use this page to
            return your deposited project tokens to your wallet after the campaign
            ended without reaching its goal.
          </p>
        </div>
      </div>
      {children}
      <div style={{ height: 48 }} />
    </div>
  )

  if (!activeAddress) {
    return wrap(
      <div className="empty-state" style={{ paddingTop: 40 }}>
        <Icon.spark style={{ width: 40, height: 40, color: 'var(--accent)' }} />
        <h3>Connect your wallet</h3>
        <p>Connect the campaign creator wallet to reclaim your tokens.</p>
      </div>
    )
  }

  if (!isViewer) {
    return wrap(
      <div className="card" style={{ padding: '18px 22px' }}>
        <p style={{ margin: 0 }}>
          This page is only for the Addict Rabbit Gang campaign creator
          (<span className="mono">{shortAddr(ARG_CREATOR)}</span>). The connected
          wallet is <span className="mono">{shortAddr(activeAddress)}</span>.
        </p>
      </div>
    )
  }

  if (loading) {
    return wrap(
      <div className="empty-state" style={{ paddingTop: 40 }}>
        <div className="sk-pulse" style={{ width: 40, height: 40, borderRadius: '50%' }} />
        <p>Reading campaign state…</p>
      </div>
    )
  }

  if (error) {
    return wrap(
      <div className="card" style={{ padding: '18px 22px', borderColor: 'var(--danger)' }}>
        <p style={{ margin: 0, color: 'var(--danger)' }}>{error}</p>
        <button className="btn btn-soft btn-sm" style={{ marginTop: 12 }} onClick={load}>Retry</button>
      </div>
    )
  }

  // Already reclaimed (asa_id reset to 0) or nothing to reclaim.
  if (done || !state.asaId) {
    return wrap(
      <div className="card" style={{ padding: '18px 22px' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--success-soft)', color: 'var(--success)', display: 'grid', placeItems: 'center' }}>
            <Icon.check style={{ width: 22, height: 22 }} />
          </div>
          <div>
            <strong>Nothing left to reclaim.</strong>
            <p style={{ margin: '4px 0 0', color: 'var(--text-muted)' }}>
              The project tokens are no longer held by this campaign's contract.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (!state.failed) {
    return wrap(
      <div className="card" style={{ padding: '18px 22px' }}>
        <p style={{ margin: 0 }}>
          Reclaim becomes available only after the campaign has ended without
          reaching its goal. This campaign hasn't reached that state yet.
        </p>
      </div>
    )
  }

  // Failed, still holds ASA → show the action (creator can act; admin previews).
  return wrap(
    <div className="card" style={{ padding: '20px 24px' }}>
      {isAdmin && (
        <div style={{ marginBottom: 16, padding: '10px 14px', background: 'var(--surface-2)', borderRadius: 8, borderLeft: '3px solid var(--accent)' }}>
          <strong style={{ fontSize: 13 }}>Admin preview.</strong>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {' '}This is exactly what the creator sees. The reclaim action is
            disabled for you — the contract only allows the creator
            (<span className="mono">{shortAddr(ARG_CREATOR)}</span>) to reclaim.
          </span>
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Campaign ended without reaching its goal. {isAdmin ? 'The creator' : 'You'} can
          return {isAdmin ? 'their' : 'your'} deposited project tokens
          (ASA <span className="mono">{state.asaId}</span>) to
          {isAdmin ? ' their' : ' your'} wallet. This closes the contract's token
          holding back to the creator.
        </div>
      </div>

      {isCreator && optedIn === false && (
        <div style={{ marginBottom: 16, padding: '12px 14px', background: 'var(--surface-2)', borderRadius: 8 }}>
          <p style={{ margin: '0 0 10px', fontSize: 13 }}>
            You need to opt into the project token before reclaiming.
          </p>
          <button className="btn btn-soft btn-sm" disabled={working} onClick={handleOptIn}>
            {working ? 'Processing…' : 'Opt into project token'}
          </button>
        </div>
      )}

      <button
        className="btn btn-primary"
        disabled={!isCreator || working || optedIn === false}
        onClick={handleReclaim}
        title={isAdmin ? 'Preview only — the creator performs this action' : undefined}
      >
        {working ? 'Processing…' : isAdmin ? 'Reclaim my tokens (creator only)' : 'Reclaim my tokens'}
      </button>

      <p style={{ margin: '14px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
        Signed by the creator's wallet. Tokens close directly to{' '}
        <span className="mono">{shortAddr(ARG_CREATOR)}</span>.
      </p>
    </div>
  )
}
