// EscrowBootstrap.jsx — admin-only page to deploy + bootstrap the Staking Escrow.
//
// Soft-gated by the obscure route AND by VITE_ADMIN_ADDRESS matching the connected
// wallet. The HARD gate is on-chain: create makes the connected wallet the app
// creator, and bootstrap asserts the caller is that creator — URL secrecy is
// convenience, not the security boundary.
//
// TWO-STEP DEPLOY (this is deliberate — it breaks the escrow<->governance
// chicken-and-egg):
//   Step 1  Create + fund the escrow app. This needs NO addresses. It reveals the
//           Escrow App ID so you can proceed to deploy governance.
//   Step 2  Bootstrap(admin, pool_addr). Here pool_addr is the GOVERNANCE APP's
//           account address — which only exists after governance is created. So you
//           create the escrow, then create governance, derive its address, and come
//           back here to bootstrap with that address.
//
// The in-progress Escrow App ID is persisted to localStorage, so you can leave this
// page to deploy governance and return to finish the bootstrap without losing it.
//
// Requires the compiled programs at /contracts/escrow_approval.teal and
// /contracts/escrow_clear.teal (see the README).

import React, { useState, useEffect } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import algosdk from 'algosdk'
import { algodClient, ADMIN_ADDRESS } from '../utils/algorand'
import { useToast } from '../context/ToastContext'
import {
  buildCreateEscrowTxn,
  buildFundAppTxn,
  buildBootstrapTxn,
  closeEscrow,
} from '../utils/escrowDeploy'
import { goOnline, goOffline } from '../utils/stakingChain'

// Where the compiled TEAL lives, relative to the site root.
const APPROVAL_URL = '/contracts/escrow_approval.teal'
const CLEAR_URL    = '/contracts/escrow_clear.teal'

// localStorage key for the in-progress (created-but-not-bootstrapped) escrow app.
const PENDING_KEY = 'sprout_pending_escrow'

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

const sendAndConfirm = async (algod, signed, txId) => {
  await algod.sendRawTransaction(signed).do()
  return algosdk.waitForConfirmation(algod, txId, 6)
}

// Read the new app id out of a create confirmation, robust to algosdk return shapes.
// Different algosdk versions/codecs expose it as 'application-index' (hyphen, REST
// JSON), 'applicationIndex' (camelCase, v3 typed clients), nested under confirmedTxn/
// txn/apply-data, and as a Number OR BigInt. Try them all, coerce safely.
function readNewAppId(res) {
  const cands = [
    res?.['application-index'],
    res?.applicationIndex,
    res?.confirmedTxn?.['application-index'],
    res?.confirmedTxn?.applicationIndex,
    res?.['apply-data']?.['application-index'],
    res?.applyData?.applicationIndex,
    res?.txn?.['application-index'],
    res?.txn?.applicationIndex,
  ]
  for (const c of cands) {
    if (c === undefined || c === null) continue
    const n = typeof c === 'bigint' ? Number(c) : Number(c)
    if (Number.isFinite(n) && n > 0) return n
  }
  return 0
}

export default function EscrowBootstrap() {
  const { activeAddress, signTransactions } = useWallet()
  const { addToast } = useToast()

  // Step 1 (create + fund) state
  const [fundAlgo, setFundAlgo] = useState('2')
  const [creating, setCreating] = useState(false)
  const [createStep, setCreateStep] = useState('')

  // The created-but-not-yet-bootstrapped escrow app. Persisted so you can leave to
  // deploy governance and come back. { appId, appAddress }
  const [pending, setPending] = useState(null)

  // Step 2 (bootstrap) state
  const [adminAddress, setAdminAddress] = useState('')
  const [poolAddress, setPoolAddress] = useState('')
  const [bootstrapping, setBootstrapping] = useState(false)
  const [bootStep, setBootStep] = useState('')
  const [result, setResult] = useState(null)

  // Close/recover state
  const [closeAppId, setCloseAppId] = useState('')
  const [closeAsaId, setCloseAsaId] = useState('')
  const [closeConfirm, setCloseConfirm] = useState('')
  const [closeStep, setCloseStep] = useState('')
  const [closing, setClosing] = useState(false)

  // Consensus registration (keyreg) state — paste the partkey values generated on the
  // node for the escrow address.
  const [voteKey, setVoteKey] = useState('')
  const [selKey, setSelKey] = useState('')
  const [spKey, setSpKey] = useState('')
  const [voteFirst, setVoteFirst] = useState('')
  const [voteLast, setVoteLast] = useState('')
  const [voteKd, setVoteKd] = useState('')
  const [incentiveEligible, setIncentiveEligible] = useState(false)
  const [keyregStep, setKeyregStep] = useState('')
  const [keyregBusy, setKeyregBusy] = useState(false)

  const isAdmin = activeAddress && ADMIN_ADDRESS && activeAddress === ADMIN_ADDRESS

  // Restore any in-progress escrow app on mount, and default the admin field to the
  // connected wallet (the common case — it's the creator).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PENDING_KEY)
      if (raw) {
        const p = JSON.parse(raw)
        // Sanitize: older saves may hold an Address OBJECT for appAddress, which would
        // crash the render (React #31). Coerce to a plain string on load.
        if (p && p.appAddress && typeof p.appAddress !== 'string') p.appAddress = String(p.appAddress)
        setPending(p)
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (activeAddress && !adminAddress) setAdminAddress(activeAddress)
  }, [activeAddress]) // eslint-disable-line react-hooks/exhaustive-deps

  function savePending(p) {
    setPending(p)
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(p)) } catch { /* ignore */ }
  }
  function clearPending() {
    setPending(null)
    try { localStorage.removeItem(PENDING_KEY) } catch { /* ignore */ }
  }

  // ── Step 1: create + fund (no addresses required) ──────────────────────────
  const canCreate = isAdmin && !creating && Number(fundAlgo) > 0

  async function doCreate() {
    if (!canCreate) return
    setCreating(true); setResult(null); setCreateStep('Loading compiled programs…')
    try {
      const { approvalProgram, clearProgram } = await loadPrograms()

      // 1) Create the app.
      setCreateStep('Creating escrow application…')
      const create = await buildCreateEscrowTxn({ sender: activeAddress, approvalProgram, clearProgram })
      const [sc] = await signTransactions([algosdk.encodeUnsignedTransaction(create.txn)])
      const createRes = await sendAndConfirm(algodClient, [sc], create.txId)
      let appId = readNewAppId(createRes)
      // Last-resort fallback: pull the app id straight from the pending-txn endpoint,
      // which always carries it, in case waitForConfirmation returned an odd shape.
      if (!appId) {
        try {
          const info = await algodClient.pendingTransactionInformation(create.txId).do()
          appId = readNewAppId(info)
        } catch { /* leave 0 */ }
      }
      if (!appId) throw new Error('Could not read new app id from create confirmation')

      // 2) Fund the app account.
      setCreateStep(`Funding app ${appId}…`)
      const fund = await buildFundAppTxn({ sender: activeAddress, appId, microAlgo: Math.round(Number(fundAlgo) * 1_000_000) })
      const [sf] = await signTransactions([algosdk.encodeUnsignedTransaction(fund.txn)])
      await sendAndConfirm(algodClient, [sf], fund.txId)

      // algosdk v3 returns an Address OBJECT here, not a string. Coerce to string
      // before storing/rendering — rendering the object (it has a .publicKey field)
      // throws React error #31 and blanks the page, and it must be a plain string to
      // round-trip through localStorage.
      const appAddress = String(algosdk.getApplicationAddress(appId))
      savePending({ appId, appAddress })
      setCreateStep(`Created + funded. Escrow App ID ${appId}.`)
      addToast(`Escrow app ${appId} created + funded. Now deploy governance, then bootstrap below.`, 'success', 10000)
    } catch (e) {
      addToast(e.message || 'Create failed', 'error', 10000)
      setCreateStep(`Failed: ${e.message || e}`)
    } finally {
      setCreating(false)
    }
  }

  // ── Step 2: bootstrap (needs the governance app address as pool_addr) ───────
  const canBootstrap =
    isAdmin && !bootstrapping && pending?.appId &&
    isAddr(adminAddress) && isAddr(poolAddress)

  async function doBootstrap() {
    if (!canBootstrap) return
    setBootstrapping(true); setResult(null); setBootStep('Bootstrapping (minting Sprout ASA, pinning admin + pool)…')
    try {
      const boot = await buildBootstrapTxn({
        sender: activeAddress,
        appId: pending.appId,
        adminAddress,
        poolAddress,
      })
      const [sb] = await signTransactions([algosdk.encodeUnsignedTransaction(boot.txn)])
      const bootRes = await sendAndConfirm(algodClient, [sb], boot.txId)

      // Read the Sprout ASA id from the inner-txn results.
      let sproutAsaId = null
      const inner = bootRes['inner-txns'] || []
      for (const itx of inner) {
        if (itx['asset-index']) { sproutAsaId = Number(itx['asset-index']); break }
        if (itx['created-asset-index']) { sproutAsaId = Number(itx['created-asset-index']); break }
      }
      if (!sproutAsaId && bootRes['logs']) {
        try {
          const log = bootRes['logs'][bootRes['logs'].length - 1]
          const bytes = Uint8Array.from(atob(log), c => c.charCodeAt(0))
          if (bytes.length >= 12) {
            const dv = new DataView(bytes.buffer, bytes.byteLength - 8, 8)
            sproutAsaId = Number(dv.getBigUint64(0))
          }
        } catch { /* leave null */ }
      }

      setResult({ appId: pending.appId, appAddress: pending.appAddress, sproutAsaId })
      setBootStep('Done.')
      addToast('Escrow bootstrapped — Sprout ASA minted, addresses pinned', 'success', 8000)
      clearPending()
    } catch (e) {
      addToast(e.message || 'Bootstrap failed', 'error', 10000)
      setBootStep(`Failed: ${e.message || e}`)
    } finally {
      setBootstrapping(false)
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

  // ── Consensus: go online / offline ─────────────────────────────────────────
  const canGoOnline =
    isAdmin && !keyregBusy &&
    voteKey.trim() && selKey.trim() && spKey.trim() &&
    /^\d+$/.test(voteFirst) && /^\d+$/.test(voteLast) && /^\d+$/.test(voteKd)

  async function doGoOnline() {
    if (!canGoOnline) return
    setKeyregBusy(true); setKeyregStep('Registering online (inner keyreg)…')
    try {
      await goOnline({
        signTransactions, address: activeAddress,
        voteKey: voteKey.trim(), selectionKey: selKey.trim(), stateProofKey: spKey.trim(),
        voteFirst: Number(voteFirst), voteLast: Number(voteLast), voteKeyDilution: Number(voteKd),
        incentiveEligible,
      })
      setKeyregStep('Online. The account will start participating once the keys become valid.')
      addToast('Escrow registered online for consensus', 'success', 8000)
    } catch (e) {
      const msg = e.message || String(e)
      setKeyregStep(`Failed: ${msg}`)
      addToast(msg, 'error', 10000)
    } finally { setKeyregBusy(false) }
  }

  async function doGoOffline() {
    if (!isAdmin || keyregBusy) return
    if (!confirm('Take the escrow OFFLINE? It will stop earning consensus rewards until you register it online again.')) return
    setKeyregBusy(true); setKeyregStep('Going offline…')
    try {
      await goOffline({ signTransactions, address: activeAddress })
      setKeyregStep('Offline. The account is deregistered from consensus.')
      addToast('Escrow taken offline', 'success', 8000)
    } catch (e) {
      const msg = e.message || String(e)
      setKeyregStep(`Failed: ${msg}`)
      addToast(msg, 'error', 10000)
    } finally { setKeyregBusy(false) }
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
        Two steps, on purpose. <strong>Step 1</strong> creates + funds the escrow app and needs
        no addresses — it just gives you the Escrow App ID. Then deploy the governance app and
        copy its <em>app account address</em>. <strong>Step 2</strong> bootstraps the escrow with
        that governance address as the pool, so harvested yield flows into the voting pool. Both
        addresses are pinned permanently at bootstrap.
      </p>

      {/* ── Step 1: create + fund ─────────────────────────────────────────── */}
      <div className="card form-card">
        <div className="form-stack">
          <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Step 1 — Create &amp; fund the app</h2>
          <p style={{ margin: '0 0 8px', fontSize: 13.5, color: 'var(--text-muted)' }}>
            No addresses needed yet. The connected wallet becomes the app creator (and the only
            wallet that can bootstrap it).
          </p>

          <div className="field">
            <label htmlFor="fund">Fund the app account with (ALGO)</label>
            <input id="fund" className="input" inputMode="decimal"
              value={fundAlgo} onChange={e => setFundAlgo(e.target.value)} disabled={!!pending} />
            <span className="field-hint">Covers base MBR + ASA MBR + the 1 ALGO harvest buffer + fees. 2 ALGO is comfortable.</span>
          </div>

          {!pending ? (
            <button className="btn btn-primary" disabled={!canCreate} onClick={doCreate}>
              {creating ? 'Working…' : 'Create + fund escrow app'}
            </button>
          ) : (
            <div className="card" style={{ padding: 14, background: 'var(--accent-soft)', borderColor: 'var(--accent-line)' }}>
              <p style={{ margin: '0 0 4px', fontSize: 14 }}><strong>Escrow App ID:</strong> {pending.appId} <span className="badge badge-warn" style={{ marginLeft: 8 }}>awaiting bootstrap</span></p>
              <p style={{ margin: '0 0 8px', fontSize: 13 }}><strong>App address:</strong> <code style={{ fontSize: 12 }}>{String(pending.appAddress)}</code></p>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
                Now deploy the governance app, copy its app account address, and bootstrap below.
              </p>
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => { if (confirm('Forget this created escrow app? Use this only if the create failed or you want to start over — the app itself still exists on-chain and would need manual cleanup.')) clearPending() }}>
                Forget this pending app
              </button>
            </div>
          )}
          {createStep && !pending && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{createStep}</div>}
        </div>
      </div>

      {/* ── Step 2: bootstrap ─────────────────────────────────────────────── */}
      <div className="card form-card" style={{ marginTop: 20, opacity: pending ? 1 : 0.6 }}>
        <div className="form-stack">
          <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Step 2 — Bootstrap</h2>
          <p style={{ margin: '0 0 8px', fontSize: 13.5, color: 'var(--text-muted)' }}>
            {pending
              ? <>Bootstrapping escrow app <strong>{pending.appId}</strong>. Calls <code>bootstrap(admin, pool_addr)</code> — mints the fixed Sprout supply and pins both addresses immutably.</>
              : <>Create the app in Step 1 first.</>}
          </p>

          <div className="field">
            <label htmlFor="admin">Admin address (immutable)</label>
            <input id="admin" className="input" placeholder="multisig or single address"
              value={adminAddress} onChange={e => setAdminAddress(e.target.value.trim())} disabled={!pending} />
            <span className="field-hint" style={{ color: adminAddress && !isAddr(adminAddress) ? 'var(--danger)' : 'var(--text-faint)' }}>
              {adminAddress && !isAddr(adminAddress) ? 'Not a valid Algorand address' : 'Controls pause + keyreg. Can never be changed. A multisig is recommended.'}
            </span>
          </div>

          <div className="field">
            <label htmlFor="pool">Pool address (immutable) — the GOVERNANCE app's account address</label>
            <input id="pool" className="input" placeholder="governance app account address"
              value={poolAddress} onChange={e => setPoolAddress(e.target.value.trim())} disabled={!pending} />
            <span className="field-hint" style={{ color: poolAddress && !isAddr(poolAddress) ? 'var(--danger)' : 'var(--text-faint)' }}>
              {poolAddress && !isAddr(poolAddress)
                ? 'Not a valid Algorand address'
                : 'The governance app’s account address (derive it from the Gov App ID). Harvested yield lands here and is distributed to winners. Immutable — a wrong value misroutes all yield forever.'}
            </span>
          </div>

          <button className="btn btn-primary" disabled={!canBootstrap} onClick={doBootstrap}>
            {bootstrapping ? 'Working…' : 'Bootstrap escrow'}
          </button>
          {bootStep && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{bootStep}</div>}
        </div>
      </div>

      {result && (
        <div className="card" style={{ padding: 16, marginTop: 20 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Bootstrapped ✓</h2>
          <p style={{ fontSize: 14, margin: '4px 0' }}><strong>Escrow App ID:</strong> {result.appId}</p>
          <p style={{ fontSize: 14, margin: '4px 0' }}><strong>App address:</strong> <code style={{ fontSize: 12 }}>{String(result.appAddress)}</code></p>
          <p style={{ fontSize: 14, margin: '4px 0' }}><strong>Sprout ASA ID:</strong> {result.sproutAsaId ?? '(read from the bootstrap txn in an explorer)'}</p>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 10 }}>
            Put these into your env: <code>VITE_ESCROW_APP_ID={result.appId}</code>,{' '}
            <code>VITE_SPROUT_ASA_ID={result.sproutAsaId ?? '…'}</code>. Then bootstrap governance
            with this Sprout ASA ID and Escrow App ID.
          </p>
        </div>
      )}

      <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 16 }}>
        Both addresses are pinned permanently at bootstrap. Double-check them before running —
        there is no setter to change them afterward.
      </p>

      {/* ── Consensus registration (keyreg) ─────────────────────────────── */}
      <div className="card form-card" style={{ marginTop: 32 }}>
        <div className="form-stack">
          <div>
            <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Consensus registration</h2>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>
              Register the escrow account online so it earns consensus rewards. Generate the
              participation keys on your node for the escrow <em>app address</em>
              (<code>goal account addpartkey -a &lt;escrow-addr&gt;</code>), then paste the three
              keys (base64) plus the round window and key dilution. The escrow is a contract
              account, so this registers via the contract's <code>go_online</code> — the admin
              wallet signs it.
            </p>
          </div>

          <div className="field">
            <label htmlFor="vk">Vote key (base64, 32 bytes)</label>
            <input id="vk" className="input" placeholder="eDfD…BDE=" value={voteKey} onChange={e => setVoteKey(e.target.value.trim())} />
          </div>
          <div className="field">
            <label htmlFor="sk">Selection key (base64, 32 bytes)</label>
            <input id="sk" className="input" placeholder="8oJW…wiA=" value={selKey} onChange={e => setSelKey(e.target.value.trim())} />
          </div>
          <div className="field">
            <label htmlFor="spk">State-proof key (base64, 64 bytes — ends in <code>==</code>)</label>
            <input id="spk" className="input" placeholder="zdws…7cYsg==" value={spKey} onChange={e => setSpKey(e.target.value.trim())} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div className="field">
              <label htmlFor="vf">First valid</label>
              <input id="vf" className="input" inputMode="numeric" placeholder="66896962" value={voteFirst} onChange={e => setVoteFirst(e.target.value.trim())} />
            </div>
            <div className="field">
              <label htmlFor="vl">Last valid</label>
              <input id="vl" className="input" inputMode="numeric" placeholder="69896962" value={voteLast} onChange={e => setVoteLast(e.target.value.trim())} />
            </div>
            <div className="field">
              <label htmlFor="vkd">Key dilution</label>
              <input id="vkd" className="input" inputMode="numeric" placeholder="1733" value={voteKd} onChange={e => setVoteKd(e.target.value.trim())} />
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13.5, cursor: 'pointer' }}>
            <input type="checkbox" checked={incentiveEligible} onChange={e => setIncentiveEligible(e.target.checked)} style={{ marginTop: 3 }} />
            <span>
              Register as <strong>incentive-eligible</strong> (pays the 2 ALGO GoOnlineFee from
              the admin wallet). Only needed to earn staking rewards, which also requires the
              pool to hold ≥ 30,000 ALGO — leave unchecked for plain consensus participation.
            </span>
          </label>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" disabled={!canGoOnline} onClick={doGoOnline}>
              {keyregBusy ? 'Working…' : incentiveEligible ? 'Go online (eligible, 2 ALGO fee)' : 'Go online'}
            </button>
            <button className="btn btn-ghost" disabled={!isAdmin || keyregBusy} onClick={doGoOffline}>
              Go offline
            </button>
          </div>
          {keyregStep && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{keyregStep}</div>}
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>
            The node that generated these keys must stay online and running, or the account is
            marked absent. Going online does not change the account's minimum balance.
          </p>
        </div>
      </div>

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
