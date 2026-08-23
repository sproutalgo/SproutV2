import React, { useState, useEffect } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { useWallet } from '@txnlab/use-wallet-react'
import algosdk from 'algosdk'
import { algodClient, signAndSend } from '../utils/algorand'
import { registerProject } from '../utils/api'
import { useToast } from '../context/ToastContext'
import { Icon, Cover, categoryHue } from '../components/UI'

// The escrow only needs its account minimum balance to exist and hold global
// state — every inner transaction in the contract (refunds, closes, payouts) uses
// fee=0 / pooled fees paid by the caller's outer transaction, so the escrow never
// pays a fee from its own balance. We read the escrow's actual min-balance from
// algod and fund only the shortfall above it, plus a small buffer. On a retry
// (e.g. the fund succeeded but registration failed) this re-reads the balance and
// skips the payment entirely if the escrow is already funded — no double-send.
const FUND_BUFFER = 10_000 // 0.01 ALGO headroom above min-balance

export default function DonationSetup() {
  const navigate  = useNavigate()
  const location  = useLocation()
  const { activeAddress, signTransactions } = useWallet()
  const { addToast } = useToast()

  const { appId, meta } = location.state ?? {}

  const [status, setStatus]   = useState('idle') // idle | funding | registering | done | error
  const [errMsg, setErrMsg]   = useState('')
  const [depositAlgo, setDepositAlgo] = useState(null) // computed shortfall, in ALGO

  // Guard: if someone lands here without state (e.g. direct URL), redirect home.
  useEffect(() => {
    if (!appId || !meta) navigate('/', { replace: true })
  }, [appId, meta, navigate])

  if (!appId || !meta) return null

  const appAddress = (() => {
    try { return algosdk.getApplicationAddress(Number(appId)).toString() } catch { return '' }
  })()

  const hue = categoryHue(meta.category)

  async function signAndSendTxns(txns) {
    const arr = Array.isArray(txns) ? txns : [txns]
    return signAndSend(signTransactions, arr.map(t => t.toByte()))
  }

  async function handleFundAndRegister() {
    if (!activeAddress) return addToast('Connect your wallet first', 'info')
    setStatus('funding')
    setErrMsg('')
    try {
      // Step 1: top up the escrow to its minimum balance (idempotent).
      // Read the escrow's current balance and min-balance; fund only the shortfall.
      // If it's already funded (e.g. this is a retry after registration failed),
      // the shortfall is 0 and we skip the payment entirely — no wasted ALGO.
      let currentBalance = 0
      let currentMinBalance = 100_000 // sensible floor if the account read fails
      try {
        const acct = await algodClient.accountInformation(appAddress).do()
        currentBalance = Number(acct?.amount ?? 0)
        currentMinBalance = Number(acct?.['min-balance'] ?? acct?.minBalance ?? currentMinBalance)
      } catch {
        // Account may not exist yet — treat as empty, fund from the floor.
        currentBalance = 0
      }

      const targetBalance = currentMinBalance + FUND_BUFFER
      const shortfall = Math.max(0, targetBalance - currentBalance)
      setDepositAlgo(shortfall / 1_000_000)

      if (shortfall > 0) {
        const sp = await algodClient.getTransactionParams().do()
        const fundTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          sender: activeAddress,
          receiver: appAddress,
          amount: shortfall,
          suggestedParams: { ...sp, flatFee: true, fee: 1000 },
        })
        await signAndSendTxns(fundTxn)
      }
      // If shortfall is 0 the escrow is already funded — skip straight to register.

      // Step 2: register in Supabase with isDonation: true — only now does the
      // campaign become visible on the explore grid
      setStatus('registering')
      await registerProject({
        address: activeAddress,
        appId,
        // isHidden: false flips the campaign public now that the escrow is funded.
        // (It was registered hidden at deploy so it stayed off Explore while
        // unfunded but still showed in the creator's My garden.)
        meta: { ...meta, isDonation: true, isHidden: false },
      })

      setStatus('done')
      addToast('Your contribution campaign is live!', 'success')
      // Small delay so the success state is visible before navigating
      setTimeout(() => navigate(`/project/${appId}`), 1800)
    } catch (e) {
      console.error(e)
      const msg = e?.message || ''
      setErrMsg(
        msg.includes('overspend') || msg.includes('below min') || msg.includes('insufficient')
          ? 'Insufficient funds. Make sure your wallet has enough ALGO to cover the escrow minimum-balance deposit plus fees.'
          : msg || 'Something went wrong. You can try again — your contract is already deployed.'
      )
      setStatus('error')
    }
  }

  const isBusy = status === 'funding' || status === 'registering'
  const isDone = status === 'done'

  return (
    <div className="wrap rise" style={{ paddingBottom: 72 }}>
      {/* Back link */}
      <div style={{ paddingTop: 32 }}>
        <Link to="/my-projects" className="back-link">
          <Icon.arrow /> My garden
        </Link>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0,1fr) 340px',
        gap: 36,
        alignItems: 'start',
        marginTop: 8,
      }}>
        {/* Left — explanation */}
        <div>
          <span className="eyebrow">One more step</span>
          <h1 style={{ fontSize: 44, marginTop: 12, fontFamily: 'var(--font-display)' }}>
            Activate your campaign
          </h1>
          <p style={{ fontSize: 17, lineHeight: 1.65, color: 'var(--text-muted)', marginTop: 16, maxWidth: 520 }}>
            Your contract is deployed on Algorand. Before your campaign goes live,
            a small <strong style={{ color: 'var(--text)' }}>minimum-balance deposit</strong> needs
            to be sent to the contract's escrow account so it can exist on-chain and
            hold your campaign's state.
          </p>

          <div style={{
            display: 'flex', flexDirection: 'column', gap: 16,
            margin: '32px 0', maxWidth: 520,
          }}>
            {[
              { ic: <Icon.lock />, t: 'Keeps the contract on-chain', d: 'Every Algorand account needs a minimum balance to exist. This deposit lets your campaign\'s escrow account hold its on-chain state.' },
              { ic: <Icon.refund />, t: 'Refunds are always covered', d: 'If your campaign doesn\'t reach its goal, backers reclaim their ALGO in full — each refund pays its own network fee, so the escrow never runs dry.' },
              { ic: <Icon.check />, t: 'Goes live immediately', d: 'Once the deposit is confirmed your campaign appears on the explore page and is open for contributions.' },
            ].map(s => (
              <div key={s.t} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <div className="hiw-ic" style={{ flexShrink: 0 }}>{s.ic}</div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{s.t}</div>
                  <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-muted)' }}>{s.d}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{
            padding: '14px 18px', borderRadius: 'var(--r-md)',
            background: 'var(--surface-2)', border: '1px solid var(--border)',
            fontSize: 13.5, color: 'var(--text-muted)', maxWidth: 520,
          }}>
            <strong style={{ color: 'var(--text)', display: 'block', marginBottom: 4 }}>App ID: {appId}</strong>
            Escrow: <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>{appAddress}</span>
          </div>

          {status === 'error' && (
            <div className="error-box" style={{ marginTop: 20, maxWidth: 520 }}>
              ⚠ {errMsg}
            </div>
          )}
        </div>

        {/* Right — campaign preview + CTA */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Preview card */}
          <div className="card" style={{ overflow: 'hidden' }}>
            <Cover hue={hue} sym={meta.token_name} imageUrl={meta.image_url} style={{ height: 140 }} />
            <div style={{ padding: '14px 16px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span className="badge">{meta.category || 'Other'}</span>
              <h3 style={{ fontSize: 18 }}>{meta.name}</h3>
              {meta.tagline && <p style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>{meta.tagline}</p>}
              <div style={{
                fontSize: 12.5, color: 'var(--text-faint)', marginTop: 4,
                padding: '8px 10px', background: 'var(--surface-2)',
                borderRadius: 'var(--r-sm)', lineHeight: 1.5,
              }}>
                Contribution campaign — backers contribute ALGO, no token distributed.
              </div>
            </div>
          </div>

          {/* CTA panel */}
          <div className="card" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {isDone ? (
              <div style={{ textAlign: 'center', padding: '12px 0' }}>
                <div style={{
                  width: 52, height: 52, borderRadius: '50%',
                  background: 'var(--success-soft)', color: 'var(--success)',
                  display: 'grid', placeItems: 'center', margin: '0 auto 14px',
                }}>
                  <Icon.check style={{ width: 26, height: 26 }} />
                </div>
                <div style={{ fontWeight: 600, fontSize: 16, color: 'var(--text)' }}>Campaign is live!</div>
                <div style={{ fontSize: 13.5, color: 'var(--text-muted)', marginTop: 6 }}>Taking you to your campaign page…</div>
              </div>
            ) : (
              <>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--text-faint)', marginBottom: 4 }}>Deposit required</div>
                  <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em' }}>
                    {depositAlgo === null ? '~0.1' : depositAlgo === 0 ? '0' : depositAlgo.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')} <span style={{ fontSize: 18, color: 'var(--text-muted)', fontWeight: 500 }}>ALGO</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-faint)', marginTop: 4 }}>
                    {depositAlgo === 0 ? 'Escrow already funded — no deposit needed' : '+ ~0.001 ALGO transaction fee'}
                  </div>
                </div>

                <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>
                  {status === 'funding'     && '⏳ Waiting for wallet approval…'}
                  {status === 'registering' && '⏳ Registering your campaign…'}
                  {status === 'idle'        && 'Approve the transaction in your wallet to activate your campaign.'}
                  {status === 'error'       && 'Transaction failed. You can try again — your contract is safe.'}
                </div>

                <button
                  className="btn btn-primary btn-block btn-lg"
                  onClick={handleFundAndRegister}
                  disabled={isBusy}
                >
                  {isBusy ? 'Processing…' : status === 'error' ? 'Try again' : 'Activate campaign'}
                </button>

                <Link
                  to="/my-projects"
                  style={{
                    textAlign: 'center', fontSize: 13, color: 'var(--text-faint)',
                    textDecoration: 'underline', textUnderlineOffset: 3,
                  }}
                >
                  Do this later (campaign won't be visible until activated)
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
