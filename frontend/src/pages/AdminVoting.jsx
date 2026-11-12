// AdminVoting.jsx — admin-only governance control panel at /admin/voting.
//
// For testing: deploy/bootstrap/close the governance contract, open an epoch,
// register candidates, and exercise stake/allocate/tally. Gated by VITE_ADMIN_ADDRESS
// matching the connected wallet (plus on-chain creator/admin checks).
//
// The compiled TEAL is fetched from /contracts/gov_approval.teal and gov_clear.teal
// (serve from frontend/public/contracts/). The ARC-56 spec is imported at build time.

import React, { useEffect, useState } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import algosdk from 'algosdk'
import { algodClient, ADMIN_ADDRESS } from '../utils/algorand'
import { useToast } from '../context/ToastContext'
import { createAndFund, bootstrapOnly, closeGovernance, discardUnbootstrapped } from '../utils/governanceDeploy'
import {
  stake, unstake, vote, openEpoch, registerCandidate,
  finalizeAuto, fetchStaked, fetchPool, listCandidateIds, IDS,
  clearAllCandidates, adminDeleteCandidate, fetchGovState,
} from '../utils/governanceChain'
import { fetchDirectory } from '../utils/api'

const APPROVAL_URL = '/contracts/gov_approval.teal'
const CLEAR_URL    = '/contracts/gov_clear.teal'
const MICRO = 1_000_000
const toAlgo = (m) => (Number(m || 0) / MICRO).toLocaleString(undefined, { maximumFractionDigits: 2 })
// Epoch round offsets from the admin's base "last block" (cumulative):
//   vote_open  = base + OPEN_OFF            (registration window is base .. vote_open)
//   vote_close = vote_open + CLOSE_OFF      (the voting/freeze window)
//   tally_round= vote_close + TALLY_OFF     (tally may begin)
// Compressed for testing; raise for the production two-week cadence. The contract
// requires vote_open > current round, and vote_open < vote_close < tally_round.
const OPEN_OFF = 50
const CLOSE_OFF = 50
const TALLY_OFF = 10

function b64ToBytes(b64) {
  const bin = atob(b64); const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
async function compileTeal(src) {
  const res = await algodClient.compile(src).do()
  return b64ToBytes(res.result)
}
async function loadPrograms() {
  const [a, c] = await Promise.all([
    fetch(APPROVAL_URL).then(r => { if (!r.ok) throw new Error('gov_approval.teal not found'); return r.text() }),
    fetch(CLEAR_URL).then(r => { if (!r.ok) throw new Error('gov_clear.teal not found'); return r.text() }),
  ])
  const [approvalProgram, clearProgram] = await Promise.all([compileTeal(a), compileTeal(c)])
  return { approvalProgram, clearProgram }
}
const isAddr = (a) => { try { algosdk.decodeAddress(a); return true } catch { return false } }
const S = (e) => String(e?.message ?? e ?? 'failed')

export default function AdminVoting() {
  const { activeAddress, signTransactions } = useWallet()
  const { addToast } = useToast()
  const [busy, setBusy] = useState('')

  // deploy (split into create+fund, then bootstrap)
  const [adminAddr, setAdminAddr] = useState('')
  const [deployStep, setDeployStep] = useState('')
  const [deployed, setDeployed] = useState(null)
  // Created-but-not-bootstrapped gov app, persisted so you can leave to bootstrap the
  // escrow (which needs this app's address) and come back. { appId, appAddress }
  const [pendingGov, setPendingGov] = useState(null)
  const [bootSproutAsa, setBootSproutAsa] = useState('') // Sprout ASA id (from escrow bootstrap)
  const [bootEscrowApp, setBootEscrowApp] = useState('')  // Escrow app id (informational)
  const GOV_PENDING_KEY = 'sprout_pending_gov'
  // close
  const [closeAppId, setCloseAppId] = useState('')
  const [closeConfirm, setCloseConfirm] = useState('')
  // epoch
  const [lastBlock, setLastBlock] = useState('')       // base round; the three rounds derive from it
  // candidate registration (directory-backed)
  const [dirEntries, setDirEntries] = useState([])     // approved directory entries
  const [selectedEntry, setSelectedEntry] = useState('') // chosen entry id (UUID)
  // stake/vote
  const [stakeAmt, setStakeAmt] = useState('')
  const [voteCandId, setVoteCandId] = useState('')     // chosen candidate_number to vote for
  const [registeredIds, setRegisteredIds] = useState([]) // on-chain candidate ids this epoch
  // status
  const [pool, setPool] = useState(null)
  const [myStake, setMyStake] = useState(null)
  const [finStep, setFinStep] = useState('')           // tally/pay/finish progress
  const [cleanupAppId, setCleanupAppId] = useState('') // app id for candidate-box cleanup
  const [cleanupStep, setCleanupStep] = useState('')

  // TESTING: page open to any connected wallet (was gated to VITE_ADMIN_ADDRESS).
  // The CONTRACT still enforces real admin/creator checks on-chain, so admin-only
  // actions (open_epoch, register_candidate, close) still fail for non-admin wallets —
  // this only opens the UI so other wallets can stake/vote for multi-wallet testing.
  const isAdmin = !!activeAddress

  useEffect(() => { if (activeAddress) setAdminAddr(p => p || activeAddress) }, [activeAddress])
  // Restore an in-progress (created-but-not-bootstrapped) gov app.
  useEffect(() => {
    try { const raw = localStorage.getItem(GOV_PENDING_KEY); if (raw) setPendingGov(JSON.parse(raw)) } catch { /* ignore */ }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!IDS.GOV_APP_ID) return
    fetchPool().then(setPool).catch(() => {})
    if (activeAddress) fetchStaked(activeAddress).then(setMyStake).catch(() => {})
  }, [activeAddress])
  // Load approved directory entries for the candidate dropdown.
  useEffect(() => {
    fetchDirectory({ pageSize: 100 })
      .then(res => setDirEntries(res?.entries || []))
      .catch(() => setDirEntries([]))
  }, [])

  // Load the candidate ids registered on-chain for the current epoch (for the vote
  // dropdown). Refreshed after registering/voting via refreshCandidates().
  async function refreshCandidates() {
    if (!IDS.GOV_APP_ID) return
    try { setRegisteredIds(await listCandidateIds()) } catch { setRegisteredIds([]) }
  }
  useEffect(() => { refreshCandidates() /* eslint-disable-next-line */ }, [])

  // A directory entry's stable numeric candidate id and payout address.
  const selectedEntryObj = dirEntries.find(e => String(e.id) === String(selectedEntry))
  const autoPayout = selectedEntryObj
    ? (selectedEntryObj.payout_address || selectedEntryObj.wallet_address || '')
    : ''
  const autoCandNum = selectedEntryObj ? selectedEntryObj.candidate_number : null

  // Map a candidate_number (on-chain id) back to its directory project name.
  const nameForCandidate = (num) => {
    const e = dirEntries.find(x => Number(x.candidate_number) === Number(num))
    return e ? e.name : `Candidate #${num}`
  }

  // Derive the three epoch rounds from the admin's base "last block" (cumulative
  // offsets). null until a valid base is entered.
  const baseBlock = /^\d+$/.test(lastBlock) ? Number(lastBlock) : null
  const epochRounds = baseBlock == null ? null : {
    voteOpen:   baseBlock + OPEN_OFF,
    voteClose:  baseBlock + OPEN_OFF + CLOSE_OFF,
    tallyRound: baseBlock + OPEN_OFF + CLOSE_OFF + TALLY_OFF,
  }

  // Pull the current round from algod so the admin doesn't have to look it up.
  async function fillCurrentRound() {
    try {
      const status = await algodClient.status().do()
      const r = Number(status['last-round'] ?? status.lastRound)
      if (Number.isFinite(r)) setLastBlock(String(r))
    } catch (e) { addToast(S(e), 'error') }
  }

  async function run(label, fn, ok = 'Done') {
    try { setBusy(label); await fn(); addToast(ok, 'success') }
    catch (e) { addToast(S(e), 'error', 9000) } finally { setBusy('') }
  }

  function saveGovPending(p) {
    setPendingGov(p)
    try { localStorage.setItem(GOV_PENDING_KEY, JSON.stringify(p)) } catch { /* ignore */ }
  }
  function clearGovPending() {
    setPendingGov(null)
    try { localStorage.removeItem(GOV_PENDING_KEY) } catch { /* ignore */ }
  }

  // Step 1 — create + fund the gov app. No ASA needed yet; this reveals the app
  // address the escrow bootstrap requires as its pool_addr.
  async function doCreateGov() {
    setBusy('gov-create'); setDeployStep('Loading programs…'); setDeployed(null)
    try {
      const { approvalProgram, clearProgram } = await loadPrograms()
      const out = await createAndFund({
        signTransactions, sender: activeAddress, approvalProgram, clearProgram,
        onStep: setDeployStep,
      })
      saveGovPending(out)
      addToast(`Governance app ${out.appId} created + funded. Copy its address into the escrow pool field.`, 'success', 10000)
    } catch (e) { setDeployStep(`Failed: ${S(e)}`); addToast(S(e), 'error', 10000) }
    finally { setBusy('') }
  }

  // Step 2 — bootstrap the created gov app with the FRESH Sprout ASA id (minted by
  // the escrow bootstrap) and the escrow app id.
  async function doBootstrapGov() {
    if (!pendingGov?.appId) return addToast('Create the gov app first', 'error')
    if (!isAddr(adminAddr)) return addToast('Enter a valid admin address', 'error')
    if (!/^\d+$/.test(bootSproutAsa)) return addToast('Enter the Sprout ASA id (from the escrow bootstrap)', 'error')
    setBusy('gov-boot'); setDeployStep('Bootstrapping…')
    try {
      const out = await bootstrapOnly({
        signTransactions, sender: activeAddress, appId: pendingGov.appId,
        adminAddress: adminAddr,
        sproutAsaId: Number(bootSproutAsa),
        escrowAppId: bootEscrowApp && /^\d+$/.test(bootEscrowApp) ? Number(bootEscrowApp) : 0,
        onStep: setDeployStep,
      })
      setDeployed({ ...out, sproutAsaId: Number(bootSproutAsa) })
      addToast('Governance bootstrapped — opted into Sprout, admin pinned', 'success', 8000)
      clearGovPending()
    } catch (e) { setDeployStep(`Failed: ${S(e)}`); addToast(S(e), 'error', 10000) }
    finally { setBusy('') }
  }

  const canClose = isAdmin && /^\d+$/.test(closeAppId) && closeConfirm.trim().toUpperCase() === 'CLOSE' && !busy
  async function doClose() {
    if (!canClose) return
    await run('close', () => closeGovernance({ signTransactions, sender: activeAddress, appId: Number(closeAppId) }),
      'Closed + funds recovered')
    setCloseConfirm('')
  }

  if (!activeAddress) return <Shell><p style={{ color: 'var(--text-muted)' }}>Connect the admin wallet.</p></Shell>
  if (!isAdmin) return <Shell><div className="card" style={{ padding: 16, color: 'var(--danger)' }}>This wallet isn't the configured admin.</div></Shell>

  return (
    <Shell>
      <p style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: -8 }}>
        Gov App {IDS.GOV_APP_ID || '—'} · Sprout ASA {IDS.SPROUT_ASA_ID || '—'}
        {pool != null && <> · Pool {toAlgo(pool)} ALGO</>}
        {myStake != null && <> · Your stake {toAlgo(myStake.stakedMicro)} SPRT</>}
      </p>

      {/* Deploy — split into create+fund (step 1) and bootstrap (step 2). This
          breaks the escrow<->governance ordering: create gov first to get its
          address for the escrow pool, bootstrap the escrow (mints Sprout), then
          bootstrap gov here with that fresh Sprout ASA id. */}
      <Card title="1. Deploy & bootstrap">
        {/* Step 1 */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Step 1 — Create &amp; fund (no ASA needed)</div>
          {!pendingGov ? (
            <button className="btn btn-primary" disabled={busy === 'gov-create'} onClick={doCreateGov}>
              {busy === 'gov-create' ? 'Working…' : 'Create + fund gov app'}
            </button>
          ) : (
            <div className="card" style={{ padding: 12, background: 'var(--accent-soft)', borderColor: 'var(--accent-line)' }}>
              <div style={{ fontSize: 14 }}><strong>Gov App ID:</strong> {pendingGov.appId} <span className="badge badge-warn" style={{ marginLeft: 6 }}>awaiting bootstrap</span></div>
              <div style={{ fontSize: 12.5, margin: '4px 0' }}><strong>App address (→ escrow pool_addr):</strong></div>
              <code style={{ fontSize: 11.5, wordBreak: 'break-all' }}>{pendingGov.appAddress}</code>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 8 }}>
                Paste this address into the escrow bootstrap (pool field), run that, then come back with the Sprout ASA id.
              </div>
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }}
                onClick={() => { if (confirm('Forget this created gov app? The app still exists on-chain. Use only if you want to start over.')) clearGovPending() }}>
                Forget pending app
              </button>
            </div>
          )}
        </div>

        {/* Step 2 */}
        <div style={{ opacity: pendingGov ? 1 : 0.6 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Step 2 — Bootstrap (after escrow is bootstrapped)</div>
          <Field label="Admin address (immutable)">
            <input className="input" value={adminAddr} onChange={e => setAdminAddr(e.target.value.trim())} disabled={!pendingGov} />
          </Field>
          <Field label="Sprout ASA id (from the escrow bootstrap)">
            <input className="input" inputMode="numeric" placeholder="e.g. 3762082994"
              value={bootSproutAsa} onChange={e => setBootSproutAsa(e.target.value.trim())} disabled={!pendingGov} />
          </Field>
          <Field label="Escrow app id (informational)">
            <input className="input" inputMode="numeric" placeholder="e.g. 3766944326"
              value={bootEscrowApp} onChange={e => setBootEscrowApp(e.target.value.trim())} disabled={!pendingGov} />
          </Field>
          <button className="btn btn-primary" disabled={busy === 'gov-boot' || !pendingGov} onClick={doBootstrapGov}>
            {busy === 'gov-boot' ? 'Working…' : 'Bootstrap gov app'}
          </button>
        </div>

        {deployStep && <Note>{deployStep}</Note>}
        {deployed && <Note><strong>App {deployed.appId}</strong> bootstrapped — set VITE_GOV_APP_ID={deployed.appId} and VITE_SPROUT_ASA_ID={deployed.sproutAsaId}, then rebuild.</Note>}
      </Card>

      {/* Open epoch — one base block; the three rounds derive at fixed offsets */}
      <Card title="2. Open epoch (rounds)">
        <Field label="Last block (base)">
          <Row>
            <input className="input" inputMode="numeric" placeholder="e.g. current round"
              value={lastBlock} onChange={e => setLastBlock(e.target.value.trim())} style={{ flex: 1 }} />
            <button className="btn btn-ghost" type="button" disabled={!!busy} onClick={fillCurrentRound}>
              Use current round
            </button>
          </Row>
          <span className="field-hint">
            vote_open = base + {OPEN_OFF}, vote_close = base + {OPEN_OFF + CLOSE_OFF}, tally_round = base + {OPEN_OFF + CLOSE_OFF + TALLY_OFF}.
            Registration window is base → vote_open ({OPEN_OFF} rounds to add candidates).
          </span>
        </Field>
        {epochRounds && (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.7 }}>
            <div>vote_open: <strong>{epochRounds.voteOpen}</strong></div>
            <div>vote_close (freeze): <strong>{epochRounds.voteClose}</strong></div>
            <div>tally_round: <strong>{epochRounds.tallyRound}</strong></div>
          </div>
        )}
        <button className="btn" disabled={!!busy || !epochRounds} onClick={() => run('epoch', () =>
          openEpoch({ signTransactions, address: activeAddress,
            voteOpen: epochRounds.voteOpen, voteClose: epochRounds.voteClose, tallyRound: epochRounds.tallyRound }))}>
          {busy === 'epoch' ? 'Opening…' : 'Open epoch'}
        </button>
      </Card>

      {/* Register candidate — pick an approved directory project; payout auto-fills */}
      <Card title="3. Register candidate">
        <Field label="Project (approved directory entries)">
          <select className="input" value={selectedEntry} onChange={e => setSelectedEntry(e.target.value)}>
            <option value="">— select a project —</option>
            {dirEntries.map(e => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </Field>
        {selectedEntryObj && (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.7 }}>
            <div>Candidate id: <strong>{autoCandNum ?? '— run the candidate_number migration —'}</strong></div>
            <div>Payout address: <code style={{ fontSize: 12, wordBreak: 'break-all' }}>{autoPayout || '— no payout/wallet address —'}</code></div>
          </div>
        )}
        <button
          className="btn"
          disabled={!!busy || !selectedEntryObj || !autoPayout || autoCandNum == null}
          onClick={() => run('cand', async () => {
            await registerCandidate({ signTransactions, address: activeAddress,
              directoryEntryId: Number(autoCandNum), payoutAddr: autoPayout })
            await refreshCandidates()
          })}>
          {busy === 'cand' ? 'Registering…' : 'Register candidate'}
        </button>
        <Note>Candidate id and payout address both come from the selected directory project — nothing typed, and the admin can't point the payout elsewhere.</Note>
      </Card>

      {/* Stake + allocate (admin self-test) */}
      <Card title="4. Test: stake & allocate">
        <Field label="Stake amount (Sprout)"><input className="input" value={stakeAmt} onChange={e => setStakeAmt(e.target.value)} /></Field>
        <Row>
          <button className="btn btn-primary" disabled={!!busy} onClick={() => run('stake', () =>
            stake({ signTransactions, address: activeAddress, microSprout: Math.round(Number(stakeAmt) * MICRO) }))}>
            {busy === 'stake' ? 'Staking…' : 'Stake'}
          </button>
          <button className="btn btn-ghost" disabled={!!busy} onClick={() => run('unstake', async () => {
            const me = await fetchStaked(activeAddress)
            return unstake({ signTransactions, address: activeAddress, microSprout: Math.round(Number(stakeAmt) * MICRO),
              votedCandidateId: me.hasVote ? me.votedCandidate : 0 })
          })}>
            {busy === 'unstake' ? 'Unstaking…' : 'Unstake'}
          </button>
        </Row>
        <Field label="Vote for project (backs full staked balance)">
          <select className="input" value={voteCandId} onChange={e => setVoteCandId(e.target.value)}>
            <option value="">— select a candidate —</option>
            {registeredIds.map(id => (
              <option key={id} value={id}>{nameForCandidate(id)}</option>
            ))}
          </select>
          {registeredIds.length === 0 && (
            <span className="field-hint">No candidates registered on-chain yet for this epoch.</span>
          )}
        </Field>
        <button className="btn" disabled={!!busy || !voteCandId} onClick={() => run('vote', async () => {
          const me = await fetchStaked(activeAddress)
          return vote({ signTransactions, address: activeAddress, candidateId: Number(voteCandId),
            prevCandidateId: me.hasVote ? me.votedCandidate : 0 })
        })}>
          {busy === 'vote' ? 'Voting…' : 'Vote'}
        </button>
        <Note>One voter → one candidate, full staked weight. Re-vote to apply a new balance or switch candidate.</Note>
      </Card>

      {/* Tally — one click, three on-chain phases */}
      <Card title="5. Tally (after tally_round)">
        <Note>
          One click runs all three phases automatically: <strong>tally</strong> (verifies the
          ranking on-chain, freezes winners, deletes candidate boxes), <strong>pay winners</strong>
          (in slices of ≤8, respecting the reference limit), and <strong>finish</strong> (flips to
          finalized so the next epoch can open). Resumable — if a payout was interrupted, clicking
          again continues from where it stopped. Nothing to type.
        </Note>
        <button className="btn btn-primary" disabled={!!busy} onClick={() => run('fin', () =>
          finalizeAuto({ signTransactions, address: activeAddress, onStep: setFinStep }))}>
          {busy === 'fin' ? (finStep || 'Finalizing…') : 'Finalize + pay winners'}
        </button>
        {finStep && busy !== 'fin' && <Note>{finStep}</Note>}
        <Note>Candidates, weights, and payout addresses all come from on-chain state — no manual entry.</Note>
      </Card>

      {/* Admin tools — clear orphaned candidate boxes so an app can close */}
      <Card title="6. Clear candidate boxes (admin recovery)">
        <Note>
          Deletes every candidate box on the app, one <code>admin_delete_candidate</code> call each.
          Use this to clear an epoch whose candidates can't be tallied (e.g. an overflowed ballot on
          an older contract) so the app can then be closed. Allowed only once the epoch is over
          (finalized, or past <code>tally_round</code>). This targets the app in <strong>VITE_GOV_APP_ID</strong>
          ({IDS.GOV_APP_ID || '—'}).
        </Note>
        <button className="btn" disabled={!!busy} onClick={() => run('clearcands', async () => {
          await clearAllCandidates({ signTransactions, address: activeAddress, onStep: setCleanupStep })
          await refreshCandidates()
        })}>
          {busy === 'clearcands' ? (cleanupStep || 'Clearing…') : 'Delete all candidate boxes'}
        </button>
        {cleanupStep && busy !== 'clearcands' && <Note>{cleanupStep}</Note>}
        <Note>After this shows zero boxes remaining, the app can be closed in the section below.</Note>
      </Card>

      {/* Close */}
      <Card title="Close & recover (danger)" danger>
        <Note>
          <strong>Bootstrapped app:</strong> requires all voter Sprout unstaked (app holds zero Sprout);
          opts out + closes to admin + deletes.<br />
          <strong>Unbootstrapped shell</strong> (a deploy that failed at bootstrap): use "Discard shell"
          to recover its ~1 ALGO — creator-only, works without admin being set.
        </Note>
        <Field label="Gov App ID"><input className="input" value={closeAppId} onChange={e => setCloseAppId(e.target.value.trim())} /></Field>
        <Field label="Type CLOSE (bootstrapped apps only)"><input className="input" value={closeConfirm} onChange={e => setCloseConfirm(e.target.value)} /></Field>
        <Row>
          <button className="btn" style={{ background: 'var(--danger)', color: '#fff', borderColor: 'var(--danger)' }}
            disabled={!canClose} onClick={doClose}>
            {busy === 'close' ? 'Closing…' : 'Close + recover (bootstrapped)'}
          </button>
          <button className="btn btn-ghost"
            disabled={!/^\d+$/.test(closeAppId) || !!busy}
            onClick={() => run('discard', () =>
              discardUnbootstrapped({ signTransactions, sender: activeAddress, appId: Number(closeAppId) }))}>
            {busy === 'discard' ? 'Discarding…' : 'Discard shell (unbootstrapped)'}
          </button>
        </Row>
      </Card>
    </Shell>
  )
}

// ── tiny layout helpers (match platform styles) ──────────────────────────────
function Shell({ children }) {
  return <section className="section wrap" style={{ maxWidth: 720 }}>
    <h1 style={{ margin: '0 0 6px', fontSize: 26 }}>Governance admin</h1>{children}
  </section>
}
function Card({ title, danger, children }) {
  return <div className="card form-card" style={{ marginTop: 18, borderColor: danger ? 'var(--danger)' : undefined }}>
    <div className="form-stack">
      <h2 style={{ margin: 0, fontSize: 17, color: danger ? 'var(--danger)' : undefined }}>{title}</h2>
      {children}
    </div>
  </div>
}
function Field({ label, children }) {
  return <div className="field"><label>{label}</label>{children}</div>
}
function Row({ children }) { return <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{children}</div> }
function Note({ children }) { return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{children}</div> }
