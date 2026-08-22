import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/UI'

const SECTIONS = [
  {
    heading: 'Campaign Types',
    items: [
      {
        q: 'What kinds of campaigns can I run or back?',
        a: 'Sprout supports two kinds of campaigns. A Reward campaign gives backers a project token in return for their contribution — the token is intended to represent early access to, or utility within, what the creator is building. A Contribution campaign has no token at all: backers contribute ALGO to support a project they believe in and receive no token in return. Both types use the same non-custodial escrow and the same refund guarantee if the goal is missed.',
      },
      {
        q: 'Are these tokens an investment or ownership stake?',
        a: 'No. Tokens distributed through a Reward campaign are not equity, shares, or an ownership interest in any business, and they are not a promise of profit or financial return. Where a token is offered, it is intended as a means of early access to or interaction with what the creator builds. Backers are supporting a project they believe in — much like a rewards-based crowdfunding pledge — not buying into a business. Nothing on Sprout should be understood as an offer of securities or an investment product.',
      },
      {
        q: 'What is the difference for me as a backer?',
        a: 'In a Reward campaign, if the goal is met you can claim the project token allocated to your contribution. In a Contribution campaign, there is no token to claim — your ALGO simply supports the project once the goal is met. In both cases, if the goal is missed, you can claim a full refund of exactly what you contributed.',
      },
    ],
  },
  {
    heading: 'For Backers',
    items: [
      {
        q: 'Where is my money held while a campaign runs?',
        a: 'In the campaign\'s own smart contract on Algorand — non-custodial escrow. Neither Sprout nor the creator can touch contributions while a campaign is live. If the goal is met, the contract releases the funds to the creator (minus the 4% success fee), and for Reward campaigns it also releases your token to you. If the goal is missed, the contract releases nothing to the creator, and every backer can claim a full refund.',
      },
      {
        q: 'How do I back a project?',
        a: 'Connect your Algorand wallet, opt into the campaign, and send ALGO before the funding deadline. Your contribution is held in the project\'s smart contract — no intermediary holds your funds at any point. This is the same whether you are backing a Reward campaign or a Contribution campaign.',
      },
      {
        q: 'What happens to my ALGO if the project doesn\'t reach its goal?',
        a: 'If the campaign deadline passes without reaching the funding goal, you can claim a full refund directly from the project page. The contract will return exactly what you contributed. This applies to both campaign types.',
      },
      {
        q: 'How do I claim my token after a Reward campaign succeeds?',
        a: 'Once the funding goal is met, visit the project page and click "Claim." The contract sends your token allocation directly to your wallet. Contribution campaigns have no token, so there is nothing to claim — your support is complete once the goal is reached.',
      },
      {
        q: 'What is the 6-month grace period?',
        a: 'After a Reward campaign ends (either by reaching its goal or expiring), backers have 6 months to claim their token. This window exists because the contract cannot fully settle until all positions are resolved — the grace period gives every backer ample time to claim while ensuring the campaign can eventually close. After 6 months, in order to complete settlement, unclaimed tokens and ALGO will be permanently transferred to the platform — you will not be able to recover them after this point. Claim as soon as possible after a campaign ends.',
      },
      {
        q: 'Can I withdraw my contribution before the deadline?',
        a: 'No. Contributions are locked in the contract until the campaign concludes — either reaching its goal or passing its deadline. This protects the integrity of the funding process for the project creator.',
      },
      {
        q: 'What wallet do I need?',
        a: 'Currently we support Pera Wallet and Defly. You will need a small amount of ALGO for transaction fees in addition to your contribution amount.',
      },
    ],
  },
  {
    heading: 'For Creators',
    items: [
      {
        q: 'What does it cost to launch a campaign?',
        a: 'There is a 0.4 ALGO minimum balance payment made during setup to fund the contract account — this covers Algorand network requirements. Additionally, you pay a non-refundable listing fee at deployment, calculated as 0.001% of your funding goal per day of campaign duration, with a minimum of 10 ALGO. For example, a 50,000 ALGO campaign listed for 30 days costs 15 ALGO; smaller or shorter campaigns pay the 10 ALGO minimum instead. If the campaign fails, you lose only the listing fee — no additional penalty is imposed and backers receive full refunds. This fee structure is the same for both campaign types.',
      },
      {
        q: 'When do I receive my ALGO?',
        a: 'As soon as your campaign reaches its funding goal you can claim your ALGO — for a Reward campaign, you do not need to wait for backers to claim their tokens. Visit the project page and click "Claim ALGO." You receive the full goal amount minus the 4% platform success fee.',
      },
      {
        q: 'What is the 4% success fee?',
        a: 'A 4% fee on the funded goal amount is retained in the smart contract and paid to the platform upon successful campaign completion. This is deducted from your payout when you claim. There is no success fee on failed or cancelled campaigns. It applies equally to Reward and Contribution campaigns.',
      },
      {
        q: 'How long can my campaign run?',
        a: 'Campaigns can run between 1 and 100 days. Choose your duration carefully — the goal, duration, and (for Reward campaigns) the token rate are written to the smart contract at deployment and cannot be changed.',
      },
      {
        q: 'Do I need to provide a token?',
        a: 'Only for a Reward campaign. During setup you transfer the total token supply to the smart contract, based on your goal and the distribution rate you set. A Contribution campaign requires no token at all — you are simply raising ALGO in support of your project, with nothing distributed back to backers.',
      },
      {
        q: 'What happens if a campaign is cancelled?',
        a: 'On rare occasions the platform may cancel a campaign that violates our terms — for example, projects that misrepresent their product, offer a token with no legitimate utility, or impersonate existing projects. Backers can claim full refunds immediately after cancellation. The creator loses only the listing fee paid at deployment.',
      },
      {
        q: 'Can I change my funding goal or deadline after launch?',
        a: 'No. The goal, duration, and (for Reward campaigns) the token rate are written to the smart contract at deployment and cannot be changed. Plan carefully before launching.',
      },
    ],
  },
  {
    heading: 'About the Platform',
    items: [
      {
        q: 'Does Sprout have its own token?',
        a: 'No. Sprout does not have a native platform token, and there is no Sprout token to buy, earn, or hold. The platform is funded through the listing and success fees described above, not through a token. Any token you encounter on Sprout belongs to an individual Reward campaign and is created by that campaign\'s creator — it is never issued by Sprout itself. Be cautious of anything claiming to be an official "Sprout token," as no such token exists.',
      },
      {
        q: 'Is this platform custodial?',
        a: 'No. All funds are held in individual Algorand smart contracts — one per campaign. Neither the platform nor any third party can access your ALGO or tokens. Every action (contribute, claim, refund) is a transaction you sign with your own wallet.',
      },
      {
        q: 'What happens if the platform shuts down?',
        a: 'Your funds are safe. Because everything is on-chain, you can interact with the smart contracts directly through any Algorand-compatible tool even if this website is unavailable. The contracts are fully autonomous.',
      },
    ],
  },
]

function AccordionItem({ q, a }) {
  const [open, setOpen] = useState(false)
  return (
    <div
      className="faq-item"
      style={{
        borderBottom: '1px solid var(--border)',
        padding: '0',
      }}
    >
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          background: 'none',
          border: 'none',
          padding: '18px 0',
          cursor: 'pointer',
          textAlign: 'left',
          color: 'var(--text)',
          fontSize: 15,
          fontWeight: 600,
          lineHeight: 1.4,
        }}
        aria-expanded={open}
      >
        <span>{q}</span>
        <span style={{
          flexShrink: 0,
          width: 20,
          height: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--accent)',
          transition: 'transform 0.2s',
          transform: open ? 'rotate(180deg)' : 'none',
        }}>
          <Icon.arrow style={{ width: 16, height: 16, transform: 'rotate(90deg)' }} />
        </span>
      </button>
      {open && (
        <div style={{
          paddingBottom: 18,
          fontSize: 14.5,
          lineHeight: 1.7,
          color: 'var(--text-muted)',
          maxWidth: 680,
        }}>
          {a}
        </div>
      )}
    </div>
  )
}

export default function FAQ() {
  return (
    <div className="rise wrap" style={{ maxWidth: 780, paddingTop: 48, paddingBottom: 80 }}>
      <span className="eyebrow">Support</span>
      <h1 style={{ marginTop: 12, marginBottom: 8 }}>Frequently asked questions</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 15, marginBottom: 48, maxWidth: 560 }}>
        Everything you need to know about contributing to and launching campaigns on Sprout.
        Can't find an answer?{' '}
        <Link to="/create" style={{ color: 'var(--accent)' }}>Launch a campaign</Link>
        {' '}or explore the{' '}
        <a href="https://github.com/sproutalgo/Algorand-Crowdfund" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>open-source codebase</a>.
      </p>

      {SECTIONS.map(section => (
        <div key={section.heading} style={{ marginBottom: 48 }}>
          <h2 style={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--accent)',
            marginBottom: 4,
          }}>
            {section.heading}
          </h2>
          <div style={{ borderTop: '1px solid var(--border)' }}>
            {section.items.map(item => (
              <AccordionItem key={item.q} q={item.q} a={item.a} />
            ))}
          </div>
        </div>
      ))}

      <div style={{
        marginTop: 16,
        padding: '24px 28px',
        background: 'var(--surface-2)',
        borderRadius: 'var(--r-lg)',
        border: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 24,
        flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Ready to launch?</div>
          <div style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>
            Deploy your crowdfunding contract to Algorand in minutes.
          </div>
        </div>
        <Link to="/create" className="btn btn-primary">
          Launch a project <Icon.arrow style={{ width: 16, height: 16 }} />
        </Link>
      </div>
    </div>
  )
}
