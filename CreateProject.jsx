import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWallet } from '@txnlab/use-wallet-react'
import { algodClient, algoToMicro, ADMIN_ADDRESS, signAndSend, signAndConfirmGroup, formatAlgo } from '../utils/algorand'
import { buildCreateAppTxnGroup, compileTeal } from '../utils/transactions'
import { registerProject, fetchCreatorProjectsMeta } from '../utils/api'
import { useToast } from '../context/ToastContext'
import { Icon, fmtAlgo } from '../components/UI'
import ProjectCard from '../components/ProjectCard'

import APPROVAL_TEAL from '../../../contracts/approval.teal?raw'
import CLEAR_TEAL    from '../../../contracts/clear.teal?raw'

const ALLOWED_WEBSITE_DOMAINS = ['x.com', 'twitter.com', 'github.com', 'linkedin.com']

function validateWebsiteUrl(url) {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) return 'URL must start with https://'
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    if (!ALLOWED_WEBSITE_DOMAINS.includes(host)) {
      return `Only links from ${ALLOWED_WEBSITE_DOMAINS.join(', ')} are accepted`
    }
    return null
  } catch {
    return 'Please enter a valid URL (e.g. https://x.com/yourproject)'
  }
}

const CATEGORIES = ['DeFi', 'RWA', 'AI', 'NFT', 'Gaming', 'Infrastructure', 'Social', 'Other']

const MIN_GOAL_ALGO   = 10
const MAX_GOAL_ALGO   = 100_000_000
const MIN_DAYS        = 1
const MAX_DAYS        = 100
const SUCCESS_FEE_PCT = 4
const ROUNDS_PER_DAY  = 86400 / 2.8
const MIN_LISTING_FEE_ALGO = 10 // ALGO, applies to all campaigns

export default function CreateProject() {
  const navigate    = useNavigate()
  const { activeAddress, signTransactions } = useWallet()
  const { addToast } = useToast()
  const [step, setStep]             = useState(1)
  const [submitting, setSubmitting] = useState(false)

  // Campaign type: 'token' or 'donation'
  const [campaignType, setCampaignType] = useState('token')
  const isDonation = campaignType === 'donation'

  const [form, setForm] = useState({
    name: '', tagline: '', description: '', category: 'DeFi',
    highlights: ['', '', ''], websiteUrl: '',
    goalAlgo: '', ratePerAlgo: '', algoPerBundle: '1', durationDays: '',
  })

  // Series / milestones
  const [creatorProjects, setCreatorProjects] = useState([])
  const [selectedSeriesAppId, setSelectedSeriesAppId] = useState('')
  const [milestoneTitle, setMilestoneTitle]   = useState('')
  const [milestoneDesc, setMilestoneDesc]     = useState('')
  const [seriesTotalGoal, setSeriesTotalGoal] = useState('') // ALGO, optional, series-wide
  const [plannedMilestones, setPlannedMilestones] = useState([{ title: '', description: '' }])

  // Load creator's existing projects for series linking
  useEffect(() => {
    if (!activeAddress) return
    fetchCreatorProjectsMeta(activeAddress)
      .then(metas => setCreatorProjects(Array.isArray(metas) ? metas : []))
      .catch(() => {})
  }, [activeAddress])

  const set     = (k) => (e) => setForm(f => ({ ...f, [k]: e.target ? e.target.value : e }))
  const setHi   = (i) => (e) => { const h = [...form.highlights]; h[i] = e.target.value; setForm(f => ({ ...f, highlights: h })) }
  const onlyInt = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value.replace(/[^0-9]/g, '') }))

  const goal    = Number(form.goalAlgo)    || 0
  const rate    = Number(form.ratePerAlgo) || 0        // tokens_per_bundle
  const algoPerBundle = Number(form.algoPerBundle) || 1 // algo_per_bundle (>=1)
  const durDays = Number(form.durationDays) || 0
  const durRounds = Math.round(durDays * ROUNDS_PER_DAY)

  // Listing fee — all campaigns have a minimum of 10 ALGO.
  // Kept as raw numbers here; formatted for display via fmtAlgo (en-US pinned).
  const rawListingFee = goal && durDays ? (goal * durDays) / 100_000 : 0
  const listingFeeAlgo = goal && durDays
    ? Math.max(rawListingFee, MIN_LISTING_FEE_ALGO)
    : null
  const successFeeAlgo  = goal ? (goal * SUCCESS_FEE_PCT / 100) : null
  // Whole tokens distributed at full goal = floor(goal * tpb / apb).
  const tokensNeeded    = !isDonation && goal && rate
    ? Math.floor((goal * rate) / algoPerBundle)
    : null

  const durError = durDays > 0 && (durDays < MIN_DAYS || durDays > MAX_DAYS)
    ? `Duration must be between ${MIN_DAYS} and ${MAX_DAYS} days`
    : null

  const websiteError = validateWebsiteUrl(form.websiteUrl)

  const checklist = [
    { ok: !!activeAddress,                                          label: 'Wallet connected' },
    { ok: !!form.name.trim(),                                       label: 'Project name' },
    { ok: !!form.tagline.trim(),                                    label: 'Tagline' },
    { ok: goal >= MIN_GOAL_ALGO && goal <= MAX_GOAL_ALGO,           label: `Funding goal (${MIN_GOAL_ALGO}–${fmtAlgo(MAX_GOAL_ALGO)} ALGO)` },
    ...(!isDonation ? [{ ok: rate > 0 && algoPerBundle > 0, label: 'Exchange rate set' }] : []),
    { ok: durDays >= MIN_DAYS && durDays <= MAX_DAYS,               label: `Duration (${MIN_DAYS}–${MAX_DAYS} days)` },
    { ok: !websiteError,                                            label: 'Website URL valid (or blank)' },
  ]
  const allOk = checklist.every(c => c.ok)

  // Planned milestones helpers
  function addPlannedMilestone() {
    setPlannedMilestones(m => [...m, { title: '', description: '' }])
  }
  function removePlannedMilestone(i) {
    setPlannedMilestones(m => m.filter((_, idx) => idx !== i))
  }
  function updatePlannedMilestone(i, field, value) {
    setPlannedMilestones(m => m.map((item, idx) => idx === i ? { ...item, [field]: value } : item))
  }

  async function handleDeploy() {
    if (!activeAddress) return addToast('Connect your wallet first', 'info')
    if (!allOk) return addToast('Complete all required fields first', 'error')
    if (durError) return addToast(durError, 'error')
    if (!ADMIN_ADDRESS) return addToast('Set VITE_ADMIN_ADDRESS in your .env', 'error')
    setSubmitting(true)
    addToast('Compiling and deploying contract…', 'info', 0)
    try {
      const approvalProgram = await compileTeal(APPROVAL_TEAL)
      const clearProgram    = await compileTeal(CLEAR_TEAL)
      const goalMicro       = algoToMicro(goal)
      // Two-value rate: donation => tokens_per_bundle 0; else the entered ratio.
      const tpbArg          = isDonation ? 0 : rate
      const apbArg          = isDonation ? 1 : algoPerBundle

      const { txns, listingFee, appCreateTxnId } = await buildCreateAppTxnGroup({
        sender: activeAddress, approvalProgram, clearProgram,
        adminAddress: ADMIN_ADDRESS, goalMicroAlgos: goalMicro,
        tokensPerBundle: tpbArg, algoPerBundle: apbArg, durationDays: durDays,
      })

      addToast(`Listing fee: ${formatAlgo(listingFee, { decimals: 4, smart: true })} ALGO — approve both transactions.`, 'info', 6000)
      // The ApplicationCreate is at group index 1 (the listing-fee payment is the
      // ARC-4 txn arg and comes first), so confirm on the create txn's id to read
      // application-index.
      const confirmation = await signAndConfirmGroup(signTransactions, txns.map(t => t.toByte()), appCreateTxnId)
      const newAppId = Number(confirmation['application-index'] ?? confirmation.applicationIndex ?? 0)

      // Determine series info
      let seriesId = null
      let milestoneNumber = null
      if (selectedSeriesAppId) {
        const parent = creatorProjects.find(p => String(p.app_id) === selectedSeriesAppId)
        seriesId = parent?.series_id || String(parent?.app_id)
        // Count existing milestones in series to determine next number
        const seriesMembers = creatorProjects.filter(p => p.series_id === seriesId || String(p.app_id) === seriesId)
        milestoneNumber = seriesMembers.length + 1
      } else if (milestoneTitle) {
        // New series — use the new app ID as the series ID
        seriesId = String(newAppId)
        milestoneNumber = 1
      }

      const validPlanned = plannedMilestones.filter(m => m.title.trim())

      const registrationMeta = {
        name: form.name, tagline: form.tagline, description: form.description,
        category: form.category, websiteUrl: form.websiteUrl,
        tokenName: '', goalMicro, ratePerAlgo: tpbArg, algoPerBundle: apbArg,
        highlights: form.highlights.filter(h => h.trim()),
        isDonation,
        seriesId,
        seriesGoalMicro:
          seriesId && Number(seriesTotalGoal) >= goal && Number(seriesTotalGoal) > 0
            ? Math.round(Number(seriesTotalGoal) * 1_000_000)
            : null,
        milestoneNumber,
        milestoneTitle:       milestoneTitle || null,
        milestoneDescription: milestoneDesc  || null,
        plannedMilestones:    validPlanned.length > 0 ? validPlanned : null,
      }

      if (isDonation) {
        // Donation campaigns must fund the escrow before being registered and
        // made visible. Hand off to the intermediate setup page which sends the
        // 0.4 ALGO payment and only then calls registerProject with isDonation: true.
        addToast(`Deployed! App ID: ${newAppId} — one more step to go live.`, 'success', 5000)
        navigate('/donate-setup', { state: { appId: newAppId, meta: registrationMeta } })
        return
      }

      await registerProject({ address: activeAddress, appId: newAppId, meta: registrationMeta })
      addToast(`Deployed! App ID: ${newAppId}`, 'success')
      addToast('Go to My garden → Set up contract to fund the token pool.', 'info', 8000)
      navigate('/my-projects')
    } catch (e) {
      console.error(e)
      const msg = e?.message || ''
      if (msg.includes('overspend') || msg.includes('below min') || msg.includes('underflow')) {
        addToast('Insufficient funds to cover the listing fee. Make sure your wallet has enough ALGO to pay the listing fee plus transaction fees and minimum balance requirements.', 'error', 8000)
      } else {
        addToast(msg || 'Deployment failed', 'error')
      }
    } finally { setSubmitting(false) }
  }

  const steps = [
    { n: 1, label: 'Project info' },
    { n: 2, label: 'Contract terms' },
    { n: 3, label: 'Review & deploy' },
  ]

  return (
    <div className="wrap rise">
      <div className="launch-head">
        <span className="eyebrow">Create</span>
        <h1 style={{ marginTop: 12 }}>Launch your project</h1>
        <p>Deploy a permissionless crowdfunding contract to Algorand Mainnet. Takes about five minutes.</p>
      </div>

      <div className="stepper">
        {steps.map((s, i) => (
          <React.Fragment key={s.n}>
            <div className={`step${step === s.n ? ' active' : ''}${step > s.n ? ' done' : ''}`}>
              <span className="step-dot">
                {step > s.n ? <Icon.check style={{ width: 15, height: 15 }} /> : s.n}
              </span>
              <span className="step-label">{s.label}</span>
            </div>
            {i < steps.length - 1 && <span className={`step-line${step > s.n ? ' done' : ''}`} />}
          </React.Fragment>
        ))}
      </div>

      <div className="launch-grid">
        <div>
          {step === 1 && (
            <div className="card form-card rise">
              <div className="form-card-head">
                <span className="num">01</span>
                <div>
                  <h3>Project info</h3>
                  <p>This is what backers see on your campaign page.</p>
                </div>
              </div>
              <div className="form-stack">
                {/* Campaign type toggle */}
                <div className="field" style={{ marginBottom: 8 }}>
                  <div className="field-label">Campaign type</div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                    {[
                      { v: 'token',    l: 'Reward campaign',       desc: 'Backers receive a project token' },
                      { v: 'donation', l: 'Contribution campaign', desc: 'Support only, no token' },
                    ].map(({ v, l, desc }) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setCampaignType(v)}
                        style={{
                          flex: 1, padding: '10px 14px', borderRadius: 'var(--r-sm)', textAlign: 'left',
                          border: campaignType === v ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                          background: campaignType === v ? 'var(--accent-soft)' : 'var(--surface)',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ fontWeight: 600, fontSize: 13, color: campaignType === v ? 'var(--accent)' : 'var(--text)' }}>{l}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{desc}</div>
                      </button>
                    ))}
                  </div>
                  {isDonation && (
                    <span className="field-hint" style={{ marginTop: 8 }}>
                      Contribution campaigns have a minimum listing fee of {MIN_LISTING_FEE_ALGO} ALGO. Backers contribute ALGO to support the project and receive no token in return.
                    </span>
                  )}
                </div>

                {/* Continue existing series — shown at top for quick pre-fill */}
                {creatorProjects.filter(p => p.milestone_title).length > 0 && (
                  <div className="field" style={{ marginBottom: 8 }}>
                    <label htmlFor="cp-series">Continue existing series (optional)</label>
                    <select id="cp-series" className="input" value={selectedSeriesAppId} onChange={e => {
                      const val = e.target.value
                      setSelectedSeriesAppId(val)
                      if (val) {
                        const parent = creatorProjects.find(p => String(p.app_id) === val)
                        if (parent) {
                          setForm(f => ({
                            ...f,
                            name:        parent.name        || f.name,
                            tagline:     parent.tagline     || f.tagline,
                            description: parent.description || f.description,
                            category:    parent.category    || f.category,
                            websiteUrl:  parent.website_url || f.websiteUrl,
                          }))
                        }
                      }
                    }}>
                      <option value="">— Start a new series —</option>
                      {creatorProjects
                        .filter(p => p.milestone_title)
                        .map(p => (
                          <option key={p.app_id} value={String(p.app_id)}>
                            {p.name} (App #{p.app_id})
                          </option>
                        ))
                      }
                    </select>
                    {selectedSeriesAppId && (
                      <span className="field-hint" style={{ color: 'var(--success)' }}>
                        ✓ Project info pre-filled from selected campaign. Edit as needed.
                      </span>
                    )}
                  </div>
                )}

                <div className="form-grid">
                  <div className="field span-2">
                    <label htmlFor="cp-name">Project name *</label>
                    <input id="cp-name" className="input" maxLength={60} placeholder="e.g. AlgoSwap Protocol" value={form.name} onChange={set('name')} />
                    <span className="field-hint" style={{ color: form.name.length >= 60 ? 'var(--danger)' : 'var(--text-muted)' }}>
                      {form.name.length}/60 characters
                    </span>
                  </div>
                  <div className="field span-2">
                    <label htmlFor="cp-tagline">Tagline *</label>
                    <input id="cp-tagline" className="input" maxLength={120} placeholder="One sentence that captures your project" value={form.tagline} onChange={set('tagline')} />
                    <span className="field-hint" style={{ color: form.tagline.length >= 120 ? 'var(--danger)' : 'var(--text-muted)' }}>
                      {form.tagline.length}/120 characters
                    </span>
                  </div>
                  <div className="field">
                    <label htmlFor="cp-category">Category</label>
                    <select id="cp-category" className="input" value={form.category} onChange={set('category')}>
                      {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="field span-2">
                    <label htmlFor="cp-description">Full description</label>
                    <textarea id="cp-description" name="description" className="textarea" maxLength={5000} placeholder="Describe your project, goals, use of funds, and team background…" value={form.description} onChange={set('description')} />
                    <span className="field-hint" style={{ color: form.description.length >= 5000 ? 'var(--danger)' : 'var(--text-muted)' }}>
                      {form.description.length}/5000 characters
                    </span>
                  </div>
                  <div className="field span-2">
                    <div className="field-label">Why back it · highlights</div>
                    <div className="hi-list">
                      {form.highlights.map((h, i) => (
                        <div className="hi-row" key={i}>
                          <span className="hi-bullet"><Icon.check /></span>
                          <input id={`highlight-${i}`} name={`highlight-${i}`} aria-label={`Highlight ${i + 1}`} className="input" placeholder={['e.g. Audited by two independent firms', 'e.g. Live on mainnet with 1,400+ wallets', 'e.g. Backed by the Algorand Foundation'][i]} value={h} onChange={setHi(i)} />
                        </div>
                      ))}
                    </div>
                    <span className="field-hint">Three scannable reasons shown to backers.</span>
                  </div>
                  <div className="field span-2">
                    <label htmlFor="cp-website">Website (optional)</label>
                    <input
                      id="cp-website"
                      className={`input${websiteError && form.websiteUrl ? ' input-error' : ''}`}
                      maxLength={200}
                      placeholder="https://x.com/yourproject"
                      value={form.websiteUrl}
                      onChange={set('websiteUrl')}
                    />
                    {websiteError && form.websiteUrl
                      ? <span className="field-hint" style={{ color: 'var(--danger)' }}>{websiteError}</span>
                      : <span className="field-hint">Accepted: x.com, twitter.com, github.com, linkedin.com</span>
                    }
                  </div>
                </div>

                {/* Series / milestone section */}
                <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 20 }}>
                  <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Campaign series (optional)</h4>
                  <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.5 }}>
                    Link this campaign to a series of milestones. Backers will see your track record across all campaigns in the series.
                  </p>

                  <div className="field" style={{ marginBottom: 12 }}>
                    <label htmlFor="cp-milestone-title">This milestone</label>
                    <input id="cp-milestone-title" className="input" placeholder="e.g. This Milestone — Mainnet Launch" value={milestoneTitle} onChange={e => setMilestoneTitle(e.target.value)} />
                  </div>
                  <div className="field" style={{ marginBottom: 12 }}>
                    <label htmlFor="cp-milestone-desc">Milestone description</label>
                    <textarea id="cp-milestone-desc" className="textarea" style={{ minHeight: 60 }} placeholder="What will be delivered in this milestone?" value={milestoneDesc} onChange={e => setMilestoneDesc(e.target.value)} />
                  </div>
                  <div className="field" style={{ marginBottom: 12 }}>
                    <label htmlFor="cp-series-goal">Total series goal (ALGO) — optional</label>
                    <input
                      id="cp-series-goal"
                      className="input no-spin"
                      type="number"
                      min="0"
                      step="1"
                      placeholder="e.g. 500000"
                      value={seriesTotalGoal}
                      onChange={e => setSeriesTotalGoal(e.target.value.replace(/[^0-9]/g, ''))}
                    />
                    <span className="field-hint" style={Number(seriesTotalGoal) > 0 && goal > 0 && Number(seriesTotalGoal) < goal ? { color: 'var(--warn)' } : undefined}>
                      {Number(seriesTotalGoal) > 0 && goal > 0 && Number(seriesTotalGoal) < goal
                        ? `Must be at least this campaign's goal (${fmtAlgo(goal)} ALGO) — it won't be saved otherwise.`
                        : 'The overall funding target across every milestone in this series. Backers see it as series-level progress on your campaign page.'}
                    </span>
                  </div>

                  <div className="field">
                    <div className="field-label">Planned future milestones</div>
                    {plannedMilestones.map((m, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'flex-start' }}>
                        <input
                          id={`planned-milestone-${i}`}
                          name={`planned-milestone-${i}`}
                          aria-label={`Planned milestone ${i + 1} title`}
                          className="input"
                          placeholder="Next Milestone Title"
                          value={m.title}
                          onChange={e => updatePlannedMilestone(i, 'title', e.target.value)}
                          style={{ flex: 1 }}
                        />
                        <button type="button" onClick={() => removePlannedMilestone(i)} className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)', padding: '6px 10px' }}>✕</button>
                      </div>
                    ))}
                    {plannedMilestones.length < 4 && (
                      <button type="button" onClick={addPlannedMilestone} className="btn btn-ghost btn-sm" style={{ marginTop: 4 }}>
                        + Add planned milestone
                      </button>
                    )}
                    <span className="field-hint">Up to 4 future milestones. Shown as roadmap on your campaign page.</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="card form-card rise">
              <div className="form-card-head">
                <span className="num">02</span>
                <div>
                  <h3>Contract terms</h3>
                  <p>Stored immutably on-chain at deployment.</p>
                </div>
              </div>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="cp-goal">This milestone's funding goal (ALGO) *</label>
                  <input id="cp-goal" className="input no-spin" type="text" inputMode="numeric" placeholder="10000" value={form.goalAlgo} onChange={onlyInt('goalAlgo')} />
                  {goal > 0 && goal < MIN_GOAL_ALGO && (
                    <span className="field-hint" style={{ color: 'var(--danger)' }}>Minimum goal is {MIN_GOAL_ALGO} ALGO.</span>
                  )}
                  {goal > MAX_GOAL_ALGO && (
                    <span className="field-hint" style={{ color: 'var(--danger)' }}>Maximum goal is {fmtAlgo(MAX_GOAL_ALGO)} ALGO.</span>
                  )}
                  {(!goal || (goal >= MIN_GOAL_ALGO && goal <= MAX_GOAL_ALGO)) && (
                    <span className="field-hint">Must be a whole number of ALGO, {MIN_GOAL_ALGO}–{fmtAlgo(MAX_GOAL_ALGO)} ALGO.</span>
                  )}
                </div>

                {!isDonation && (
                  <div className="field">
                    <label htmlFor="cp-rate">Exchange rate *</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        <input id="cp-rate" className="input no-spin" type="text" inputMode="numeric" placeholder="1" style={{ width: 72, flexShrink: 0 }} value={form.ratePerAlgo} onChange={onlyInt('ratePerAlgo')} />
                        <span className="faint" style={{ fontSize: 13.5, whiteSpace: 'nowrap' }}>token(s) per</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        <input id="cp-apb" className="input no-spin" type="text" inputMode="numeric" placeholder="1" style={{ width: 72, flexShrink: 0 }} value={form.algoPerBundle} onChange={onlyInt('algoPerBundle')} />
                        <span className="faint" style={{ fontSize: 13.5, whiteSpace: 'nowrap' }}>ALGO</span>
                      </div>
                    </div>
                    <span className="field-hint">
                      How many whole tokens a backer receives per amount of ALGO. Example: "1 token per 10 ALGO" means a 10 ALGO contribution yields 1 token, and amounts below the ratio round down. Token decimals are handled automatically during setup.
                    </span>
                  </div>
                )}

                <div className="field span-2">
                  <label htmlFor="cp-duration">Campaign duration (days) *</label>
                  <input
                    id="cp-duration"
                    className={`input no-spin${durError ? ' input-error' : ''}`}
                    type="text"
                    inputMode="numeric"
                    placeholder="e.g. 30"
                    value={form.durationDays}
                    onChange={onlyInt('durationDays')}
                  />
                  {durError
                    ? <span className="field-hint" style={{ color: 'var(--danger)' }}>{durError}</span>
                    : <span className="field-hint">
                        Minimum {MIN_DAYS} day, maximum {MAX_DAYS} days.
                        {durDays >= MIN_DAYS && durDays <= MAX_DAYS && listingFeeAlgo
                          ? ` Listing fee: ${fmtAlgo(listingFeeAlgo, { decimals: 4, smart: true })} ALGO.`
                          : ''}
                        {durDays >= MIN_DAYS && durDays <= MAX_DAYS && durRounds > 0
                          ? ` Duration is stored on-chain as ${durRounds.toLocaleString('en-US')} Algorand rounds (~2.8 seconds each). Displayed days are approximate.`
                          : ''}
                      </span>
                  }
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="card form-card rise">
              {!allOk ? (
                <>
                  <div className="form-card-head">
                    <span className="num">03</span>
                    <div><h3>Almost ready</h3><p>Complete the required fields before deploying.</p></div>
                  </div>
                  <div className="checklist">
                    {checklist.map((c, i) => (
                      <div className={`check-item${c.ok ? ' ok' : ''}`} key={i}>
                        <span className="check-box">{c.ok && <Icon.check />}</span>
                        {c.label}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="deploy-done">
                  <div className="ring"><Icon.bolt /></div>
                  <h3 style={{ fontSize: 26 }}>Ready to deploy</h3>
                  <p className="muted" style={{ marginTop: 12, maxWidth: 420, marginInline: 'auto', lineHeight: 1.6 }}>
                    <b style={{ color: 'var(--text)' }}>{form.name}</b> will raise {fmtAlgo(goal)} ALGO over {durDays} days
                    {!isDonation ? ` at ${rate} token${rate === 1 ? '' : 's'} per ${algoPerBundle} ALGO` : ' as a contribution campaign'}.
                    Listing fee: {fmtAlgo(listingFeeAlgo, { decimals: 4, smart: true })} ALGO paid at deploy.
                    Success fee: {fmtAlgo(successFeeAlgo, { decimals: 2 })} ALGO (4%) if funded.
                  </p>
                  <button
                    className="btn btn-primary btn-lg"
                    style={{ marginTop: 24 }}
                    onClick={handleDeploy}
                    disabled={submitting}
                  >
                    <Icon.bolt style={{ width: 18, height: 18 }} />
                    {submitting ? 'Deploying…' : 'Deploy crowdfund contract'}
                  </button>
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
            <button className="btn btn-ghost" disabled={step === 1} style={{ opacity: step === 1 ? 0.4 : 1 }} onClick={() => setStep(s => Math.max(1, s - 1))}>
              Back
            </button>
            {step < 3 && (
              <button className="btn btn-primary" onClick={() => setStep(s => Math.min(3, s + 1))}>
                Continue <Icon.arrow style={{ width: 17, height: 17 }} />
              </button>
            )}
          </div>
        </div>

        <aside>
          {/* Live preview — exactly what backers will see on the explore grid.
              Built from form state; pointer-events disabled so the Link inside
              the card can't navigate away mid-form. */}
          <div className="card summary-card" style={{ position: 'static', marginBottom: 20 }}>
            <h4>Live preview</h4>
            <div style={{ pointerEvents: 'none', marginTop: 4 }} aria-hidden="true">
              <ProjectCard
                project={{
                  id: 0,
                  gs: {
                    goal: Math.max(1, Math.round((goal || 0) * 1_000_000)),
                    raised: 0,
                    deadline: 0,
                    asa_id: isDonation ? 0 : 1, // preview-only: renders the card in its 'Live' state
                  },
                  meta: {
                    name: form.name,
                    tagline: form.tagline,
                    category: form.category,
                    is_donation: isDonation,
                    creator_address: activeAddress || undefined,
                  },
                }}
              />
            </div>
            <div className="sum-note" style={{ marginTop: 14 }}>
              This is how your campaign card will appear to backers on the explore page.
            </div>
          </div>

          <div className="card summary-card" style={{ position: 'static' }}>
            <h4>Deployment summary</h4>
            {[
              { l: 'Campaign type',     v: isDonation ? 'Contribution campaign' : 'Reward campaign' },
              { l: 'Funding goal',      v: goal ? `${fmtAlgo(goal)} ALGO` : '—' },
              ...(!isDonation ? [{ l: 'Exchange rate', v: rate ? `${rate} token${rate === 1 ? '' : 's'} / ${algoPerBundle} ALGO` : '—' }] : []),
              { l: 'Duration',          v: durDays >= MIN_DAYS && durDays <= MAX_DAYS ? `${durDays} days` : '—' },
              { l: 'Listing fee',       v: listingFeeAlgo != null ? `${fmtAlgo(listingFeeAlgo, { decimals: 4, smart: true })} ALGO` : '—' },
              { l: 'Success fee (4%)',  v: successFeeAlgo != null ? `${fmtAlgo(successFeeAlgo, { decimals: 2 })} ALGO` : '—' },
              ...(!isDonation && tokensNeeded ? [{ l: 'Tokens to provide', v: fmtAlgo(tokensNeeded) }] : []),
              ...(milestoneTitle ? [{ l: 'Milestone', v: milestoneTitle }] : []),
              ...((selectedSeriesAppId || milestoneTitle) && Number(seriesTotalGoal) > 0
                ? [{ l: 'Series total goal', v: `${fmtAlgo(Number(seriesTotalGoal))} ALGO` }]
                : []),
            ].map(({ l, v }) => (
              <div className="sum-row" key={l}>
                <span className="s-lbl">{l}</span>
                <span className="s-val">{v}</span>
              </div>
            ))}
            <div className="sum-note">
              Listing fee is paid upfront and non-refundable. A 4% success fee is deducted from your payout if the campaign is funded. Contract terms are stored immutably on-chain.
            </div>
          </div>

          <div className="card summary-card" style={{ position: 'static', marginTop: 20 }}>
            <h4>Pre-flight checklist</h4>
            <div className="checklist">
              {checklist.map((c, i) => (
                <div className={`check-item${c.ok ? ' ok' : ''}`} key={i}>
                  <span className="check-box">{c.ok && <Icon.check />}</span>
                  {c.label}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
