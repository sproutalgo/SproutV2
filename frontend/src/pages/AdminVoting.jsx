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
import { deployAndBootstrap, closeGovernance } from '../utils/governanceDeploy'
import {
  stake, unstake, vote, openEpoch, registerCandidate,
  finalize, fetchStaked, fetchPool, fetchCandidateWeight, buildRanking, IDS,
} from '../utils/governanceChain'

const APPROVAL_URL = '/contracts/gov_approval.teal'
const CLEAR_URL    = '/contracts/gov_clear.teal'
const MICRO = 1_000_000
const toAlgo = (m) => (Number(m || 0) / MICRO).toLocaleString(undefined, { maximumFractionDigits: 2 })

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

  // deploy
  const [adminAddr, setAdminAddr] = useState('')
  const [deployStep, setDeployStep] = useState('')
  const [deployed, setDeployed] = useState(null)
  // close
  const [closeAppId, setCloseAppId] = useState('')
  const [closeConfirm, setCloseConfirm] = useState('')
  // epoch
  const [voteOpen, setVoteOpen] = useState('')
  const [voteClose, setVoteClose] = useState('')
  const [tallyRound, setTallyRound] = useState('')
  // candidate
  const [candId, setCandId] = useState('')
  const [dirId, setDirId] = useState('')
  const [payoutAddr, setPayoutAddr] = useState('')
  // stake/vote (admin testing)
  const [stakeAmt, setStakeAmt] = useState('')
  const [voteCandId, setVoteCandId] = useState('')
  // status
  const [pool, setPool] = useState(null)
  const [myStake, setMyStake] = useState(null)

  const isAdmin = activeAddress && ADMIN_ADDRESS && activeAddress === ADMIN_ADDRESS

  useEffect(() => { if (activeAddress) setAdminAddr(p => p || activeAddress) }, [activeAddress])
  useEffect(() => {
    if (!IDS.GOV_APP_ID) return
    fetchPool().then(setPool).catch(() => {})
    if (activeAddress) fetchStaked(activeAddress).then(setMyStake).catch(() => {})
  }, [activeAddress])

  async function run(label, fn, ok = 'Done') {
    try { setBusy(label); await fn(); addToast(ok, 'success') }
    catch (e) { addToast(S(e), 'error', 9000) } finally { setBusy('') }
  }

  async function doDeploy() {
    if (!isAddr(adminAddr)) return addToast('Enter a valid admin address', 'error')
    setBusy('deploy'); setDeployStep('Loading programs…'); setDeployed(null)
    try {
      const { approvalProgram, clearProgram } = await loadPrograms()
      const out = await deployAndBootstrap({
        signTransactions, sender: activeAddress, approvalProgram, clearProgram,
        adminAddress: adminAddr, onStep: setDeployStep,
      })
      setDeployed(out)
      addToast('Governance deployed + bootstrapped', 'success', 8000)
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

      {/* Deploy */}
      <Card title="1. Deploy & bootstrap">
        <Field label="Admin address (immutable)">
          <input className="input" value={adminAddr} onChange={e => setAdminAddr(e.target.value.trim())} />
        </Field>
        <button className="btn btn-primary" disabled={busy === 'deploy'} onClick={doDeploy}>
          {busy === 'deploy' ? 'Working…' : 'Deploy + bootstrap'}
        </button>
        {deployStep && <Note>{deployStep}</Note>}
        {deployed && <Note><strong>App {deployed.appId}</strong> — set VITE_GOV_APP_ID={deployed.appId}, then rebuild.</Note>}
      </Card>

      {/* Open epoch */}
      <Card title="2. Open epoch (rounds)">
        <Row>
          <Field label="vote_open"><input className="input" value={voteOpen} onChange={e => setVoteOpen(e.target.value)} /></Field>
          <Field label="vote_close (freeze)"><input className="input" value={voteClose} onChange={e => setVoteClose(e.target.value)} /></Field>
          <Field label="tally_round"><input className="input" value={tallyRound} onChange={e => setTallyRound(e.target.value)} /></Field>
        </Row>
        <button className="btn" disabled={!!busy} onClick={() => run('epoch', () =>
          openEpoch({ signTransactions, address: activeAddress, voteOpen: Number(voteOpen), voteClose: Number(voteClose), tallyRound: Number(tallyRound) }))}>
          {busy === 'epoch' ? 'Opening…' : 'Open epoch'}
        </button>
        <Note>Use current round + offsets for testing (e.g. open=now, close=now+small, tally=now+bigger).</Note>
      </Card>

      {/* Register candidate */}
      <Card title="3. Register candidate">
        <Row>
          <Field label="candidate_id"><input className="input" value={candId} onChange={e => setCandId(e.target.value)} /></Field>
          <Field label="directory_entry_id"><input className="input" value={dirId} onChange={e => setDirId(e.target.value)} /></Field>
        </Row>
        <Field label="payout address"><input className="input" value={payoutAddr} onChange={e => setPayoutAddr(e.target.value.trim())} /></Field>
        <button className="btn" disabled={!!busy} onClick={() => run('cand', () =>
          registerCandidate({ signTransactions, address: activeAddress, candidateId: Number(candId), directoryEntryId: Number(dirId), payoutAddr }))}>
          {busy === 'cand' ? 'Registering…' : 'Register candidate'}
        </button>
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
        <Field label="vote for candidate_id (backs full staked balance)">
          <input className="input" value={voteCandId} onChange={e => setVoteCandId(e.target.value)} />
        </Field>
        <button className="btn" disabled={!!busy} onClick={() => run('vote', async () => {
          const me = await fetchStaked(activeAddress)
          return vote({ signTransactions, address: activeAddress, candidateId: Number(voteCandId),
            prevCandidateId: me.hasVote ? me.votedCandidate : 0 })
        })}>
          {busy === 'vote' ? 'Voting…' : 'Vote'}
        </button>
        <Note>One voter → one candidate, full staked weight. Re-vote to apply a new balance or switch candidate.</Note>
      </Card>

      {/* Tally */}
      <Card title="5. Tally (after tally_round)">
        <Note>
          Candidate weights are already final (running tallies). Finalize reads them, sorts
          descending, and the contract verifies the order + pays winners. Enter the candidate
          ids (comma-separated) and their payout addresses in the same order as registered.
        </Note>
        <Field label="candidate ids (comma-separated)">
          <input className="input" id="fin-ids" placeholder="1,2,3" />
        </Field>
        <Field label="payout addresses (comma-separated, matching order)">
          <input className="input" id="fin-addrs" placeholder="ADDR1,ADDR2,ADDR3" />
        </Field>
        <button className="btn btn-primary" disabled={!!busy} onClick={() => run('fin', async () => {
          const ids = document.getElementById('fin-ids').value.split(',').map(s => Number(s.trim())).filter(Boolean)
          const addrs = document.getElementById('fin-addrs').value.split(',').map(s => s.trim()).filter(Boolean)
          const payouts = {}; ids.forEach((id, i) => { payouts[id] = addrs[i] })
          const { rankedIds, payoutAddrs } = await buildRanking(ids, payouts)
          return finalize({ signTransactions, address: activeAddress, rankedCandidateIds: rankedIds, payoutAddrs })
        })}>
          {busy === 'fin' ? 'Finalizing…' : 'Finalize + pay winners'}
        </button>
        <Note>buildRanking reads each candidate's on-chain weight and sorts for you; the contract re-verifies.</Note>
      </Card>

      {/* Close */}
      <Card title="Close & recover (danger)" danger>
        <Note>Requires all voter Sprout unstaked (app holds zero Sprout). Opts out + closes to admin + deletes.</Note>
        <Field label="Gov App ID"><input className="input" value={closeAppId} onChange={e => setCloseAppId(e.target.value.trim())} /></Field>
        <Field label="Type CLOSE"><input className="input" value={closeConfirm} onChange={e => setCloseConfirm(e.target.value)} /></Field>
        <button className="btn" style={{ background: 'var(--danger)', color: '#fff', borderColor: 'var(--danger)' }}
          disabled={!canClose} onClick={doClose}>
          {busy === 'close' ? 'Closing…' : 'Close + recover'}
        </button>
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
