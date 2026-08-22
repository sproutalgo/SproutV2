import React, { useState, useEffect } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { useWallet } from '@txnlab/use-wallet-react'
import algosdk from 'algosdk'
import { algodClient, signAndSend } from '../utils/algorand'
import { registerProject } from '../utils/api'
import { useToast } from '../context/ToastContext'
import { Icon, Cover, categoryHue } from '../components/UI'

const FUND_AMOUNT = 400_000 // 0.4 ALGO in microALGO

export default function DonationSetup() {
  const navigate  = useNavigate()
  const location  = useLocation()
  const { activeAddress, signTransactions } = useWallet()
  const { addToast } = useToast()

  const { appId, meta } = location.state ?? {}

  const [status, setStatus]   = useState('idle') // idle | funding | registering | done | error
  const [errMsg, setErrMsg]   = useState('')

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
      // Step 1: send 0.4 ALGO to the escrow so inner transactions can pay fees
      const sp = await algodClient.getTransactionParams().do()
      const fundTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: activeAddress,
        receiver: appAddress,
        amount: FUND_AMOUNT,
        suggestedParams: { ...sp, flatFee: true, fee: 1000 },
      })
      await signAndSendTxns(fundTxn)

      // Step 2: register in Supabase with isDonation: true — only now does the
      // campaign become visible on the explore grid
      setStatus('registering')
      await registerProject({
        address: activeAddress,
        appId,
        meta: { ...meta, isDonation: true },
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
          ? 'Insufficient funds. Make sure your wallet has at least 0.4 ALGO plus fees available.'
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
            a small deposit of <strong style={{ color: 'var(--text)' }}>0.4 ALGO</strong> needs
            to be sent to the contract's escrow account.
          </p>

          <div style={{
            display: 'flex', flexDirection: 'column', gap: 16,
            margin: '32px 0', maxWidth: 520,
          }}>
            {[
              { ic: <Icon.lock />, t: 'Covers transaction fees', d: 'Algorand smart contracts need a minimum balance to execute inner transactions — like refunding backers if your campaign doesn\'t reach its goal.' },
              { ic: <Icon.refund />, t: 'Protects your backers', d: 'Without this deposit, refund transactions would fail. This ensures every backer can always recover their ALGO.' },
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
                  <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em' }}>0.4 <span style={{ fontSize: 18, color: 'var(--text-muted)', fontWeight: 500 }}>ALGO</span></div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-faint)', marginTop: 4 }}>+ ~0.001 ALGO transaction fee</div>
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
