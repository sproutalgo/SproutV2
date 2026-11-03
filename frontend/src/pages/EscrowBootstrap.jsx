// EscrowBootstrap.jsx — admin-only page to deploy + bootstrap the Staking Escrow.
//
// Soft-gated by the obscure route (you only share the URL) AND by VITE_ADMIN_ADDRESS
// matching the connected wallet. The HARD gate is on-chain: bootstrap asserts the
// caller is the app's creator, so only the wallet that creates the app can bootstrap
// it — URL secrecy is convenience, not the security boundary.
//
// Wire a route to this (e.g. /x/escrow-bootstrap-<random>) and DON'T link it in nav.
//
// Requires the compiled programs. Fetches them from /contracts at runtime so the
// large base64 TEAL isn't bundled; place escrow_approval.teal / escrow_clear.teal
// where the app can GET them (public/ or your static host), or import them if you
// prefer bundling. See the README.

import React, { useState, useEffect } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import algosdk from 'algosdk'
import { algodClient, ADMIN_ADDRESS } from '../utils/algorand'
import { useToast } from '../context/ToastContext'
import { deployAndBootstrap, closeEscrow } from '../utils/escrowDeploy'

// Where the compiled TEAL lives, relative to the site root. Adjust to taste.
const APPROVAL_URL = '/contracts/escrow_approval.teal'
const CLEAR_URL    = '/contracts/escrow_clear.teal'

function b64ToBytes(b64) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function compileTeal(src) {
  const res = await algodClient.compile(src).do()
  return b64ToBytes(res.result)
}

async function loadPrograms() {
  const [aSrc, cSrc] = await Promise.all([
    fetch(APPROVAL_URL).then(r => { if (!r.ok) throw new Error('approval.teal not found'); return r.text() }),
    fetch(CLEAR_URL).then(r => { if (!r.ok) throw new Error('clear.teal not found'); return r.text() }),
  ])
  const [approvalProgram, clearProgram] = await Promise.all([compileTeal(aSrc), compileTeal(cSrc)])
  return { approvalProgram, clearProgram }
}

function isAddr(a) {
  try { algosdk.decodeAddress(a); return true } catch { return false }
}

export default function EscrowBootstrap() {
  const { activeAddress, signTransactions } = useWallet()
  const { addToast } = useToast()

  const [adminAddress, setAdminAddress] = useState('')
  const [poolAddress, setPoolAddress] = useState('')

  // Default the admin to the connected wallet — that's the common case (admin =
  // you). Only prefill while the field is still empty, so it never overwrites an
  // address you've deliberately typed (e.g. a multisig). Editable either way.
  useEffect(() => {
    if (activeAddress) setAdminAddress(prev => (prev === '' ? activeAddress : prev))
  }, [activeAddress])
  const [fundAlgo, setFundAlgo] = useState('2')
  const [step, setStep] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  // Close/recover state
  const [closeAppId, setCloseAppId] = useState('')
  const [closeAsaId, setCloseAsaId] = useState('')
  const [closeConfirm, setCloseConfirm] = useState('')
  const [closeStep, setCloseStep] = useState('')
  const [closing, setClosing] = useState(false)

  const isAdmin = activeAddress && ADMIN_ADDRESS && activeAddress === ADMIN_ADDRESS

  const canRun = isAdmin && isAddr(adminAddress) && isAddr(poolAddress) && !busy

  async function run() {
    if (!canRun) return
    setBusy(true); setResult(null); setStep('Loading compiled programs…')
    try {
      const { approvalProgram, clearProgram } = await loadPrograms()
      const out = await deployAndBootstrap({
        signTransactions,
        sender: activeAddress,
        approvalProgram,
        clearProgram,
        adminAddress,
        poolAddress,
        fundMicroAlgo: Math.round(Number(fundAlgo) * 1_000_000),
        onStep: setStep,
      })
      setResult(out)
      addToast('Escrow deployed + bootstrapped', 'success', 8000)
    } catch (e) {
      addToast(e.message || 'Deploy failed', 'error', 10000)
      setStep(`Failed: ${e.message || e}`)
    } finally {
      setBusy(false)
    }
  }

  const canClose =
    isAdmin && !closing &&
    /^\d+$/.test(closeAppId) && /^\d+$/.test(closeAsaId) &&
    closeConfirm.trim().toUpperCase() === 'CLOSE'

  async function doClose() {
    if (!canClose) return
    setClosing(true); setCloseStep('Closing… (destroy ASA, sweep to admin, delete app)')
    try {
      await closeEscrow({
        signTransactions,
        sender: activeAddress,
        appId: Number(closeAppId),
        sproutAsaId: Number(closeAsaId),
      })
      setCloseStep('Closed. Funds swept to admin, app deleted.')
      addToast('Escrow closed and funds recovered', 'success', 8000)
      setCloseConfirm('')
    } catch (e) {
      const msg = e.message || String(e)
      setCloseStep(`Failed: ${msg}`)
      // The most common expected failure: principal still outstanding.
      if (/principal outstanding/i.test(msg)) {
        addToast('Close blocked: depositors still hold Sprout. All principal must be withdrawn first.', 'error', 10000)
      } else if (/go offline/i.test(msg)) {
        addToast('Close blocked: take the account offline (go_offline) first.', 'error', 10000)
      } else {
        addToast(msg, 'error', 10000)
      }
    } finally {
      setClosing(false)
    }
  }

  if (!activeAddress) {
    return <section className="section wrap" style={{ maxWidth: 640 }}>
      <h1 style={{ fontSize: 24 }}>Escrow bootstrap</h1>
      <p style={{ color: 'var(--text-muted)' }}>Connect the deployer wallet to continue.</p>
    </section>
  }

  if (!isAdmin) {
    return <section className="section wrap" style={{ maxWidth: 640 }}>
      <h1 style={{ fontSize: 24 }}>Escrow bootstrap</h1>
      <div className="card" style={{ padding: 16, color: 'var(--danger)' }}>
        This wallet isn't the configured admin. Connect the deployer/admin wallet.
      </div>
    </section>
  }

  return (
    <section className="section wrap" style={{ maxWidth: 640 }}>
      <h1 style={{ fontSize: 24, margin: '0 0 6px' }}>Deploy &amp; bootstrap the Staking Escrow</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 20px' }}>
        Creates the escrow app, funds it, and calls <code>bootstrap(admin, pool_addr)</code> —
        which mints the fixed Sprout supply and pins both addresses immutably. The wallet you're
        connected with becomes the app creator and must be the one to bootstrap.
      </p>

      <div className="card form-card">
        <div className="form-stack">
          <div className="field">
            <label htmlFor="admin">Admin address (immutable)</label>
            <input id="admin" className="input" placeholder="multisig or single address"
              value={adminAddress} onChange={e => setAdminAddress(e.target.value.trim())} />
            <span className="field-hint" style={{ color: adminAddress && !isAddr(adminAddress) ? 'var(--danger)' : 'var(--text-faint)' }}>
              {adminAddress && !isAddr(adminAddress)
                ? 'Not a valid Algorand address'
                : 'Defaults to your connected wallet. Controls pause + keyreg, can never be changed — use a multisig if you want key-loss protection.'}
            </span>
            {activeAddress && adminAddress !== activeAddress && (
              <button type="button" className="btn btn-ghost" style={{ marginTop: 6, fontSize: 13 }}
                onClick={() => setAdminAddress(activeAddress)}>
                Use connected wallet
              </button>
            )}
          </div>

          <div className="field">
            <label htmlFor="pool">Pool wallet address (immutable) — receives harvested yield</label>
            <input id="pool" className="input" placeholder="wallet you control, for testing"
              value={poolAddress} onChange={e => setPoolAddress(e.target.value.trim())} />
            <span className="field-hint" style={{ color: poolAddress && !isAddr(poolAddress) ? 'var(--danger)' : 'var(--text-faint)' }}>
              {poolAddress && !isAddr(poolAddress) ? 'Not a valid Algorand address' : 'For testing, a wallet you control so you can watch yield land. Immutable — wrong value sends yield there forever.'}
            </span>
          </div>

          <div className="field">
            <label htmlFor="fund">Fund the app account with (ALGO)</label>
            <input id="fund" className="input" inputMode="decimal"
              value={fundAlgo} onChange={e => setFundAlgo(e.target.value)} />
            <span className="field-hint">Covers base MBR + ASA MBR + the 1 ALGO harvest buffer + fees. 2 ALGO is comfortable.</span>
          </div>

          <button className="btn btn-primary" disabled={!canRun} onClick={run}>
            {busy ? 'Working…' : 'Deploy + bootstrap'}
          </button>
          {step && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{step}</div>}
        </div>
      </div>

      {result && (
        <div className="card" style={{ padding: 16, marginTop: 20 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Deployed ✓</h2>
          <p style={{ fontSize: 14, margin: '4px 0' }}><strong>Escrow App ID:</strong> {result.appId}</p>
          <p style={{ fontSize: 14, margin: '4px 0' }}><strong>App address:</strong> <code style={{ fontSize: 12 }}>{result.appAddress}</code></p>
          <p style={{ fontSize: 14, margin: '4px 0' }}><strong>Sprout ASA ID:</strong> {result.sproutAsaId ?? '(read from the bootstrap txn in an explorer)'}</p>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 10 }}>
            Put these into your env: <code>VITE_ESCROW_APP_ID={result.appId}</code>,{' '}
            <code>VITE_SPROUT_ASA_ID={result.sproutAsaId ?? '…'}</code>. The app address is where
            deposits go and where you'd send a top-up if ever needed.
          </p>
        </div>
      )}

      <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 16 }}>
        Both addresses are pinned permanently at bootstrap. Double-check them before running —
        there is no setter to change them afterward.
      </p>

      {/* ── Close / recover ─────────────────────────────────────────────── */}
      <div className="card form-card" style={{ marginTop: 32, borderColor: 'var(--danger)' }}>
        <div className="form-stack">
          <div>
            <h2 style={{ margin: '0 0 4px', fontSize: 18, color: 'var(--danger)' }}>Close &amp; recover</h2>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>
              Destroys the Sprout ASA, sweeps all remaining ALGO to the admin, and deletes the app.
              <strong> Only succeeds when every depositor has withdrawn</strong> (accounted principal is zero) and
              the account is offline — it can never take staked funds. Irreversible.
            </p>
          </div>

          <div className="field">
            <label htmlFor="c-app">Escrow App ID</label>
            <input id="c-app" className="input" inputMode="numeric" placeholder="e.g. 1234567"
              value={closeAppId} onChange={e => setCloseAppId(e.target.value.trim())} />
          </div>
          <div className="field">
            <label htmlFor="c-asa">Sprout ASA ID</label>
            <input id="c-asa" className="input" inputMode="numeric" placeholder="e.g. 7654321"
              value={closeAsaId} onChange={e => setCloseAsaId(e.target.value.trim())} />
          </div>
          <div className="field">
            <label htmlFor="c-confirm">Type CLOSE to confirm</label>
            <input id="c-confirm" className="input" placeholder="CLOSE"
              value={closeConfirm} onChange={e => setCloseConfirm(e.target.value)} />
            <span className="field-hint">Make sure you've taken the account offline and withdrawn all Sprout first.</span>
          </div>

          <button
            className="btn"
            style={{ background: 'var(--danger)', color: '#fff', borderColor: 'var(--danger)' }}
            disabled={!canClose}
            onClick={doClose}
          >
            {closing ? 'Closing…' : 'Close + recover funds'}
          </button>
          {closeStep && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{closeStep}</div>}
        </div>
      </div>
    </section>
  )
}
