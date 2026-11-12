import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/UI'

const SECTIONS = [
  {
    heading: 'Getting Started',
    items: [
      {
        q: 'What is Sprout?',
        a: 'Sprout is a non-custodial funding platform on Algorand with two sides. The funding engine is a shared prize pool: people stake ALGO to grow the pool, the community nominates projects from the directory, stakers vote on who wins, and the top projects split the pool each round. Crowdfunding campaigns are individual, creator-run raises: a creator sets a goal and deadline, backers contribute ALGO, and funds release on-chain if the goal is met. Both are permissionless and non-custodial — your funds live in Algorand smart contracts, never with Sprout.',
      },
      {
        q: 'What is the difference between the funding engine and a campaign?',
        a: 'The funding engine is collective: there is one shared pool, and the community decides together which directory projects it funds each round through staking and voting. You never lose your staked ALGO — it stays withdrawable, and only the staking rewards feed the pool. A crowdfunding campaign is individual: one creator raises ALGO toward a specific goal from backers who contribute directly, with a full refund if the goal is missed. You can take part in either, or both.',
      },
      {
        q: 'Do I need anything special to use Sprout?',
        a: 'An Algorand wallet — currently Pera Wallet or Defly — and a small amount of ALGO for transaction fees. Everything you do (stake, vote, contribute, claim, refund, withdraw) is a transaction you sign yourself. No account, email, or sign-up is required.',
      },
      {
        q: 'Is Sprout custodial? What happens if the site goes down?',
        a: 'Non-custodial, entirely. All funds live in Algorand smart contracts — the staking escrow for the engine, and one contract per crowdfunding campaign. Neither Sprout nor any third party can access your ALGO or tokens. Because everything is on-chain, you can interact with the contracts directly through any Algorand-compatible tool even if this website is unavailable. The contracts are autonomous.',
      },
    ],
  },
  {
    heading: 'The Funding Engine',
    items: [
      {
        q: 'How does the funding engine work, end to end?',
        a: 'Four steps that repeat each round. (1) Stake ALGO — holders stake ALGO into the engine\'s escrow, which pools it and earns staking rewards. (2) Nominate — the community backs projects in the directory; the top projects form the ballot. (3) Vote — stakers stake Sprout to earn voting weight and vote on the ballot. (4) Payout — when the round finalizes, the top projects split the accumulated reward pool. Then the round resets and it begins again. Your staked ALGO is never spent on payouts — only the rewards it generates are.',
      },
      {
        q: 'What is the difference between staking ALGO and staking Sprout?',
        a: 'They are two separate actions on the Stake & Vote page. Staking ALGO grows the shared prize pool — your ALGO is pooled in the escrow, earns rewards, and those rewards fund the winning projects. Staking ALGO does not give you a vote. Staking Sprout gives you voting weight — it is how you influence which projects win. Neither action is locked; you can withdraw either at any time.',
      },
      {
        q: 'What is Sprout, and where does it come from?',
        a: 'Sprout is the governance token for the funding engine. When you stake ALGO into the escrow, the contract issues you Sprout 1:1 as a receipt for your pooled principal. You then stake that Sprout to earn voting weight. Sprout is not sold, and there is no Sprout to buy — it exists only as a 1:1 receipt for ALGO you have deposited. When you withdraw your ALGO, you return the Sprout. (Note: this is entirely separate from crowdfunding — Sprout is not a campaign token and is never issued by a project.)',
      },
      {
        q: 'Is my staked ALGO ever at risk of being spent on payouts?',
        a: 'No. This is a core design property: the pool that funds projects is built from staking rewards only, never from principal. Your deposited ALGO remains yours and stays withdrawable at any time. The contract derives principal from the token supply rather than spending it, so payouts can only ever come from the reward surplus the pool has accumulated.',
      },
      {
        q: 'How does nomination work?',
        a: 'Nominations are an open, community phase. Any connected wallet can nominate one directory project — one wallet, one vote — and you can change your nomination at any time. There is no staking or gating required to nominate. The nominations narrow the directory down to a shortlist of the top projects, which then become the on-chain ballot that staked-Sprout voters choose from. Nominations run continuously and are reset by the admin at the start of each new round.',
      },
      {
        q: 'How does voting work, and how is weight counted?',
        a: 'Once the ballot is set, stakers vote on-chain with their staked Sprout. Voting is one-Sprout-one-vote: your weight equals the Sprout you have staked. Your full stake backs the project you choose, and you can re-vote to switch at any time while voting is open. Only continuously-staked Sprout counts — if you unstake, that weight is removed, and re-staking later does not restore previously frozen weight. Voters can always unstake in any phase.',
      },
      {
        q: 'How are winners chosen and paid?',
        a: 'When the voting window closes and the round finalizes, the funding pool is computed live (the escrow balance beyond what it must reserve) so winners receive the full round\'s accumulated yield. The top projects by vote weight split the pool in an equal share each. If projects tie at the cutoff, the winner set widens to include them. Payouts are made by the contract directly to the winning projects — there is no admin control over the funds.',
      },
      {
        q: 'Can I withdraw my staked ALGO whenever I want?',
        a: 'Yes. Staked ALGO is never locked. You can withdraw your principal at any time by returning the Sprout the escrow issued you, and the contract returns your ALGO 1:1. Withdrawing reduces the rewards the pool earns going forward but never touches anyone else\'s principal.',
      },
      {
        q: 'Where do the directory projects come from?',
        a: 'From the free Algorand project directory — any project can list itself at no cost, with no campaign required. The directory doubles as the candidate roster for the funding engine: nominations and the ballot are drawn from it. Listing in the directory is how a project becomes eligible to be nominated and funded.',
      },
    ],
  },
  {
    heading: 'Campaign Types',
    items: [
      {
        q: 'What kinds of campaigns can I run or back?',
        a: 'Sprout supports two kinds of crowdfunding campaigns. A Reward campaign gives backers a project token in return for their contribution — the token is intended to represent early access to, or utility within, what the creator is building. A Contribution campaign has no token at all: backers contribute ALGO to support a project they believe in and receive no token in return. Both types use the same non-custodial escrow and the same refund guarantee if the goal is missed.',
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
        a: 'After a Reward campaign ends (either by reaching its goal or expiring), backers have 6 months to claim their token. This window exists because the contract cannot fully settle until all positions are resolved — the grace period gives every backer ample time to claim while ensuring the campaign can eventually close. After 6 months, in order to complete settlement, any unclaimed tokens and residual ALGO are returned to the campaign creator (who provided the token pool), not to the platform — and once that settlement close happens, a backer who never claimed can no longer recover their token. The platform never receives unclaimed tokens or leftover ALGO; its only fee is the 4% success fee on funded campaigns. Claim as soon as possible after a campaign ends.',
      },
      {
        q: 'Can I withdraw my contribution before the deadline?',
        a: 'No. Campaign contributions are locked in the contract until the campaign concludes — either reaching its goal or passing its deadline. This protects the integrity of the funding process for the project creator. (This is different from the funding engine, where staked ALGO can be withdrawn at any time.)',
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
        a: 'There is a small contract-account minimum-balance deposit made during setup to satisfy Algorand network requirements — typically around 0.2–0.4 ALGO depending on the campaign. The exact amount is computed at setup and only tops the account up to what it needs; it is not a fee and is returned to you when the contract is finally closed. Additionally, you pay a non-refundable listing fee at deployment, calculated as 0.001% of your funding goal per day of campaign duration, with a minimum of 10 ALGO. For example, a 50,000 ALGO campaign listed for 30 days costs 15 ALGO; smaller or shorter campaigns pay the 10 ALGO minimum instead. If the campaign fails, you lose only the listing fee — the minimum-balance deposit is still recoverable at close, no additional penalty is imposed, and backers receive full refunds. This fee structure is the same for both campaign types.',
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
        q: 'How do I get my project funded by the engine instead of running a campaign?',
        a: 'List your project in the directory — it is free and requires no campaign. Once listed, your project is eligible to be nominated by the community and, if it makes the ballot and wins the vote, to receive a share of the prize pool. The directory listing is all that is needed to become a candidate; the community does the rest through nominations and voting.',
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
        q: 'Does Sprout have a platform token I can buy?',
        a: 'No. There is no Sprout token to buy, earn speculatively, or trade. The Sprout governance token exists only as a 1:1 receipt for ALGO staked into the funding engine — you cannot acquire it except by staking ALGO, and you return it when you withdraw. The platform is funded through crowdfunding listing and success fees, not through a token sale. Any token you encounter in a crowdfunding campaign belongs to that individual Reward campaign and is created by its creator — it is never issued by Sprout. Be cautious of anything claiming to be an official "Sprout token" for sale, as no such thing exists.',
      },
      {
        q: 'How does Sprout make money?',
        a: 'Only from crowdfunding campaign fees: the non-refundable listing fee at deployment and the 4% success fee on funded campaigns. The funding engine takes no cut — payouts go from the contract directly to winning projects, and the platform never receives staked ALGO, staking rewards, unclaimed campaign tokens, or leftover ALGO.',
      },
      {
        q: 'Is the platform open source?',
        a: 'Yes. The smart contracts and platform code are open source — you can review the escrow, campaign, and governance contracts directly. This is part of why the system can be fully non-custodial and autonomous: you do not have to trust the interface, you can verify the contracts.',
      },
      {
        q: 'What happens if the platform shuts down?',
        a: 'Your funds are safe. Because everything is on-chain, you can interact with the smart contracts directly through any Algorand-compatible tool even if this website is unavailable. Campaign escrows, the staking engine, and the governance contract are all autonomous — you can withdraw staked ALGO, claim refunds, or claim tokens without the Sprout front end.',
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
        Everything you need to know about Sprout — the shared funding engine and
        crowdfunding campaigns. Can't find an answer?{' '}
        <Link to="/fund" style={{ color: 'var(--accent)' }}>Explore the engine</Link>
        {', '}
        <Link to="/create" style={{ color: 'var(--accent)' }}>launch a campaign</Link>
        {', '}or explore the{' '}
        <a href="https://github.com/sproutalgo/SproutV2" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>open-source codebase</a>.
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
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Ready to take part?</div>
          <div style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>
            Stake into the shared pool, or launch your own campaign on Algorand.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link to="/fund/participate" className="btn btn-ghost">Stake &amp; vote</Link>
          <Link to="/create" className="btn btn-primary">
            Launch a project <Icon.arrow style={{ width: 16, height: 16 }} />
          </Link>
        </div>
      </div>
    </div>
  )
}
