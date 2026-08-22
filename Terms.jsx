import React from 'react'
import { Link } from 'react-router-dom'

const EFFECTIVE_DATE  = 'May 31, 2026'
const CONTACT_EMAIL   = 'admin@sproutalgo.com'
const GOVERNING_STATE = 'South Dakota'

function Section({ n, title, children }) {
  return (
    <div style={{ marginBottom: 36 }}>
      <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 12 }}>
        {n}. {title}
      </h2>
      {children}
    </div>
  )
}

function P({ children, style }) {
  return (
    <p style={{ fontSize: 14.5, lineHeight: 1.75, color: 'var(--text-muted)', marginBottom: 12, ...style }}>
      {children}
    </p>
  )
}

function Ul({ items }) {
  return (
    <ul style={{ paddingLeft: 24, marginBottom: 12 }}>
      {items.map((item, i) => (
        <li key={i} style={{ fontSize: 14.5, lineHeight: 1.75, color: 'var(--text-muted)', marginBottom: 6 }}>
          {item}
        </li>
      ))}
    </ul>
  )
}

export default function Terms() {
  return (
    <div className="wrap rise" style={{ maxWidth: 780, paddingTop: 48, paddingBottom: 80 }}>
      <span className="eyebrow">Legal</span>
      <h1 style={{ marginTop: 12, marginBottom: 4 }}>Terms &amp; Conditions</h1>
      <p style={{ fontSize: 13.5, color: 'var(--text-muted)', marginBottom: 24 }}>
        Effective date: {EFFECTIVE_DATE}
      </p>

      <div style={{
        background: 'var(--surface-2)', border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)', padding: '16px 20px', marginBottom: 36,
        fontSize: 13.5, lineHeight: 1.65, color: 'var(--text-muted)',
      }}>
        PLEASE READ THESE TERMS AND CONDITIONS CAREFULLY. BY ACCESSING OR USING THE SPROUT
        PLATFORM, YOU AGREE TO BE BOUND BY THESE TERMS. IF YOU DO NOT AGREE TO ALL OF THESE
        TERMS AND CONDITIONS, DO NOT USE OUR PLATFORM.
      </div>

      <Section n={1} title="Scope">
        <P>
          These Terms and Conditions ("Agreement") between Sprout Ventures LLC ("Sprout", "we", "us",
          or "our") and the user ("you" or "Client") govern your access to and use of the
          Sprout crowdfunding platform (the "Service"). They apply to all crowdfunding
          campaigns and related services provided through Sprout.
        </P>
      </Section>

      <Section n={2} title="Description of the Service">
        <P>
          The Service is a non-custodial, blockchain-based crowdfunding platform operated on the
          Algorand network. It allows campaign creators to deploy smart contracts to raise ALGO
          from backers who wish to support their projects. Campaigns take one of two forms: a
          Reward campaign, in which backers may receive a project token intended to represent
          early access to or utility within what the creator builds; and a Contribution campaign,
          in which no token is distributed and backers simply support the project. In all cases,
          backers contribute ALGO and may claim tokens (where offered) or refunds in accordance
          with the terms of each individual smart contract.
        </P>
        <P>
          A project token, where offered, is not equity, a share, or any ownership interest in a
          business, and is not a promise of profit, income, or financial return. Backers support
          projects they believe in; they do not acquire an investment or ownership position.
          Sprout provides the interface and infrastructure for deploying and interacting
          with these smart contracts. Sprout does not hold, control, or have access to any
          user funds or private keys at any time. The Service is a technology platform, not a
          financial or investment service, and nothing offered through it constitutes an offer
          or sale of securities.
        </P>
      </Section>

      <Section n={3} title="Definitions">
        <Ul items={[
          '"Agreement" means these Terms and Conditions.',
          '"Client" means any person or entity using the Service.',
          '"Creator" means a Client who deploys a crowdfunding campaign through the Service.',
          '"Backer" means a Client who contributes ALGO to a campaign.',
          '"Smart Contract" means the on-chain Algorand application deployed for each campaign.',
          '"Campaign" means a crowdfunding project deployed and managed through the Service.',
          '"Contribution" means ALGO deposited by a Backer into a Campaign smart contract.',
          '"Reward Campaign" means a Campaign in which Backers may receive a Project Token.',
          '"Contribution Campaign" means a Campaign in which no token is distributed to Backers.',
          '"Project Token" means an Algorand Standard Asset distributed by a Reward Campaign, intended solely to represent early access to or utility within a Creator\'s project. A Project Token is not equity, a security, a share, or an ownership interest in any business, and confers no right to profit, income, dividends, or financial return.',
        ]} />
      </Section>

      <Section n={4} title="Sprout's Responsibilities">
        <P>
          Sprout operates the Service in a diligent and professional manner in accordance
          with applicable industry standards. Sprout provides the platform interface,
          smart contract templates, and supporting infrastructure.
        </P>
        <P>
          The Service is non-custodial: Clients are solely responsible for maintaining the
          security of their own accounts, wallets, and private keys at all times. Sprout
          will never ask for private keys under any circumstance. Sprout does not act as
          a custodian of Client funds.
        </P>
      </Section>

      <Section n={5} title="Client Responsibilities">
        <P>
          Clients are responsible for all activity conducted through their wallets. Creators
          are responsible for accurately representing their projects and fulfilling any
          commitments made to Backers. Backers are responsible for conducting their own due
          diligence before contributing to any campaign.
        </P>
      </Section>

      <Section n={6} title="Availability of the Service">
        <P>
          Sprout will provide Clients with the information necessary to use the Service.
          The Client acknowledges that access to the Service is dependent on the Algorand
          blockchain, the Internet, and other systems beyond Sprout's control. Sprout
          shall not be liable for any inability to access the Service due to blockchain or
          network issues. Sprout will strive to maintain the Service and repair any faults
          under its reasonable control.
        </P>
      </Section>

      <Section n={7} title="Access to the Service; Restrictions on Use">
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>a. Access</h3>
        <P>
          Access to the Service is open to any person who connects a compatible Algorand wallet.
          The Client shall not permit any other entity or person to use the Service through
          their account and shall immediately notify Sprout of any unauthorized use.
        </P>

        <h3 style={{ fontSize: 15, fontWeight: 600, margin: '16px 0 8px' }}>b. Restrictions</h3>
        <P>The Client agrees not to use the Service:</P>
        <Ul items={[
          'In a manner that negatively affects other users or interferes with or disrupts the Service',
          'In any manner that violates any applicable law, regulation, or sanction',
          'To submit fraudulent, misleading, or impersonating campaign content',
          'To contribute funds belonging to third parties without their authorization',
        ]} />

        <h3 style={{ fontSize: 15, fontWeight: 600, margin: '16px 0 8px' }}>c. Acceptable Use</h3>
        <P>
          The Client may not reverse engineer, disassemble, or decompile any part of the
          Service. The Client agrees not to send or store malicious code, use automated tools
          to scan or probe the Service for vulnerabilities, or attempt to gain unauthorized
          access to the Service or its related systems.
        </P>
      </Section>

      <Section n={8} title="Term; Termination">
        <P>
          This Agreement begins when the Client first uses the Service. Either party may
          terminate this Agreement at any time for any or no reason. Upon termination, all
          rights to access and use the Service terminate. Any obligations that by their nature
          extend beyond termination — including confidentiality, warranty disclaimers,
          indemnification, and limitations of liability — will survive termination.
        </P>
        <P>
          Smart contracts already deployed to the Algorand blockchain continue to operate
          according to their on-chain logic regardless of termination. Clients retain the
          ability to interact directly with deployed smart contracts through any
          Algorand-compatible tool even if they no longer have access to the Sprout
          platform.
        </P>
      </Section>

      <Section n={9} title="Fees">
        <P>
          <strong>Listing fee:</strong> Creators pay a non-refundable listing fee at the time
          of campaign deployment, calculated as 0.001% of the funding goal per day of campaign
          duration, subject to a minimum of 10 ALGO. This fee is paid directly to Sprout Ventures
          LLC at deployment and is not held in the smart contract. It is non-refundable regardless
          of campaign outcome.
        </P>
        <P>
          <strong>Success fee:</strong> A 4% fee on the funded goal amount is retained in the
          smart contract and claimed by Sprout Ventures LLC after successful campaign
          settlement. This fee is deducted from the Creator's payout. There is no success fee
          on failed or cancelled campaigns.
        </P>
        <P>
          <strong>Failure or cancellation:</strong> If a campaign fails to reach its goal or
          is cancelled, Backers receive a full refund of their contributions. The Creator
          loses only the listing fee paid at deployment — no additional penalty is imposed.
        </P>
        <P>
          <strong>Minimum balance:</strong> A 0.4 ALGO payment is required during campaign
          setup to fund the smart contract account's Algorand network minimum balance
          requirement.
        </P>
        <P>
          Sprout Ventures LLC reserves the right to modify its fee structure and will provide
          reasonable notice of any changes. All fees are denominated in ALGO.
        </P>
        <P>
          Clients are solely responsible for all Algorand network transaction fees (minimum
          balance reservations and per-transaction fees) incurred through their use of the Service.
        </P>
      </Section>

      <Section n={10} title="Proprietary Information">
        <P>
          The Client acknowledges that Sprout owns all right, title, and interest in the
          Service, including its user interface, software, source code, and all related
          intellectual property rights. The Client agrees not to reverse engineer, copy,
          reproduce, republish, or create derivative works based on the Service without the
          prior written consent of Sprout.
        </P>
        <P>
          The Sprout smart contract source code is open source and available for review.
          Sprout's platform code, branding, and proprietary infrastructure remain the
          exclusive property of Sprout.
        </P>
      </Section>

      <Section n={11} title="Confidentiality; Use of Data">
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>a. Confidentiality</h3>
        <P>
          Information exchanged between the parties in connection with this Agreement that is
          designated as confidential shall be treated as such. Information is not confidential
          to the extent it is publicly available, independently derived by the receiving party,
          or disclosed pursuant to legal requirement.
        </P>

        <h3 style={{ fontSize: 15, fontWeight: 600, margin: '16px 0 8px' }}>b. Use of Data</h3>
        <P>
          Sprout may collect and store information regarding the Client to provide the
          Service and manage Sprout's business, in accordance with our{' '}
          <Link to="/privacy" style={{ color: 'var(--accent)' }}>Privacy Policy</Link>.
        </P>
      </Section>

      <Section n={12} title="Mutual Representations and Warranties">
        <P>Each party represents and warrants that:</P>
        <Ul items={[
          'It has the full power and authority to enter into and perform its obligations under this Agreement.',
          'This Agreement has been duly authorized on its behalf.',
        ]} />
      </Section>

      <Section n={13} title="Client Warranties">
        <P>By using the Service, the Client warrants that:</P>
        <Ul items={[
          'Knowledge & expertise: it has read, understood, and agreed to these Terms and has adequate knowledge of blockchain technologies, Algorand, and digital asset crowdfunding.',
          'Due diligence: it has conducted its own independent due diligence on any campaign before contributing.',
          'Risk awareness: it understands that contributions are subject to risks including smart contract risk, market risk, and the risk of campaign failure.',
          'Own account: it is acting on its own account and has made its own independent decision to use the Service.',
          'No breach: its use of the Service will not violate any applicable law, regulation, or restriction.',
          'Sanctions: neither the Client nor any beneficial owner bears a name appearing on OFAC, UN, EU, or other applicable sanctions lists.',
        ]} />
      </Section>

      <Section n={14} title="Disclaimer of Warranties">
        <P style={{ textTransform: 'uppercase', fontSize: 13, letterSpacing: '0.01em' }}>
          EXCEPT AS EXPRESSLY SET FORTH HEREIN, THE SERVICE IS PROVIDED ON AN "AS IS" AND "AS
          AVAILABLE" BASIS WITH ALL FAULTS AND WITHOUT WARRANTY OF ANY KIND. SPROUT MAKES
          NO REPRESENTATION OR WARRANTY THAT THE SERVICE WILL BE ERROR FREE, UNINTERRUPTED, OR
          AVAILABLE AT ALL TIMES. SPROUT SPECIFICALLY DISCLAIMS ALL IMPLIED WARRANTIES OF
          MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT TO THE
          FULLEST EXTENT PERMITTED BY LAW.
        </P>
        <P>
          Sprout does not warrant that any campaign will reach its funding goal, that any
          Creator will fulfill their obligations to Backers, or that any token received through
          the Service will have any particular value.
        </P>
      </Section>

      <Section n={15} title="Blockchain and Third-Party Risk">
        <P>
          Sprout shall not be held liable for any damages caused by the Algorand network
          protocol, including but not limited to forks, network congestion, bugs, or other
          protocol-level events, provided that Sprout did not act with intent or gross
          negligence.
        </P>
        <P>
          Sprout shall not be liable for defects in third-party software, open-source
          libraries, or other components that are not proprietary to Sprout but are used
          in providing the Service.
        </P>
      </Section>

      <Section n={16} title="Indemnification">
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>a. By Sprout</h3>
        <P>
          Sprout will indemnify, defend, and hold harmless the Client from damages arising
          out of any claim that the Service, as provided by Sprout, infringes the
          intellectual property rights of a third party, subject to the limitations set forth
          herein.
        </P>

        <h3 style={{ fontSize: 15, fontWeight: 600, margin: '16px 0 8px' }}>b. By the Client</h3>
        <P>
          The Client will indemnify, defend, and hold Sprout and its officers, directors,
          employees, and agents harmless from any damages, liabilities, losses, costs, and
          expenses (including reasonable attorneys' fees) arising out of any breach of this
          Agreement by the Client, the Client's use of the Service, or the Client's failure to
          comply with any applicable law or regulation.
        </P>
      </Section>

      <Section n={17} title="Limitations of Liability">
        <P style={{ textTransform: 'uppercase', fontSize: 13, letterSpacing: '0.01em' }}>
          SPROUT SHALL NOT BE LIABLE FOR ANY INDIRECT, SPECIAL, INCIDENTAL, CONSEQUENTIAL,
          OR PUNITIVE DAMAGES OF ANY KIND, INCLUDING LOSS OF REVENUE, LOSS OF PROFITS, LOSS OF
          DATA, OR LOSS OF GOODWILL, ARISING OUT OF OR RELATED TO THIS AGREEMENT OR THE SERVICE,
          REGARDLESS OF THE FORM OF ACTION OR THE BASIS OF THE CLAIM. IN NO EVENT SHALL
          SPROUT'S AGGREGATE LIABILITY UNDER THIS AGREEMENT EXCEED THE FEES PAID BY THE
          CLIENT TO SPROUT DURING THE SIX (6) MONTHS PRIOR TO THE EVENT GIVING RISE TO
          THE CLAIM.
        </P>
        <P>
          Sprout shall not be liable for: any loss or theft of digital assets or private
          keys; transaction errors made by the Client; late execution or settlement of any
          transaction; any security breach or bug in any digital asset or technology stack;
          or any configuration or installation errors by the Client.
        </P>
      </Section>

      <Section n={18} title="Notices">
        <P>
          Any notice required or permitted in connection with this Agreement will be deemed
          delivered if sent by electronic mail to{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--accent)' }}>{CONTACT_EMAIL}</a>
          {' '}or via a prominent notice posted on the Sprout platform.
        </P>
      </Section>

      <Section n={19} title="No Future Commitments">
        <P>
          Sprout has made no commitments or promises with respect to future features or
          functions of the Service. Any product roadmap information is for informational
          purposes only and does not constitute a binding commitment.
        </P>
      </Section>

      <Section n={20} title="Discontinuation of Service">
        <P>
          Sprout reserves the right to discontinue the Service at any time for any or no
          reason. Because all campaign funds are held in on-chain smart contracts — not by
          Sprout — discontinuation of the platform does not affect your ability to interact
          directly with deployed smart contracts through any Algorand-compatible tool.
        </P>
      </Section>

      <Section n={21} title="Taxes">
        <P>
          The Client is solely responsible for all taxes, fees, and surcharges arising from
          their use of the Service and any digital assets received. Sprout and its agents
          do not provide tax advice. The Client is strongly encouraged to seek advice from a
          qualified tax advisor.
        </P>
      </Section>

      <Section n={22} title="Assignment">
        <P>
          Neither party may assign, transfer, or otherwise dispose of this Agreement or any
          rights or obligations hereunder without the prior written consent of the other party,
          except that Sprout may assign this Agreement to an affiliate or in connection
          with a merger, acquisition, or sale of substantially all of its assets.
        </P>
      </Section>

      <Section n={23} title="Governing Law; Jurisdiction">
        <P>
          This Agreement will be governed by and construed in accordance with the laws of{' '}
          {GOVERNING_STATE}. The parties agree to submit to the exclusive jurisdiction of
          the state and federal courts located in {GOVERNING_STATE} for the adjudication of
          any dispute arising under this Agreement.
        </P>
      </Section>

      <Section n={24} title="Amendments">
        <P>
          Sprout is entitled to amend and modify this Agreement at any time. Clients will
          be notified of any amendments via email or via a notice posted on the platform.
          Amendments are deemed accepted unless an objection is raised in writing within 30
          days of notification, or in any event when the Service continues to be used.
        </P>
      </Section>

      <Section n={25} title="Force Majeure">
        <P>
          Any delay or failure of performance by either party under this Agreement will be
          excused to the extent caused by events beyond the reasonable control of such party,
          including acts of God, civil or military authority, strikes, fires, pandemics,
          internet or network outages, blockchain protocol events, third-party software
          failures, power outages, or governmental restrictions.
        </P>
      </Section>

      <Section n={26} title="Severability">
        <P>
          If any provision of this Agreement is held invalid by a court or other authority,
          the remainder of this Agreement will not be affected and the provisions of this
          Agreement will be deemed severable.
        </P>
      </Section>

      <Section n={27} title="Entire Agreement">
        <P>
          This Agreement constitutes the sole and entire agreement of the parties with respect
          to the subject matter contained herein and supersedes all prior agreements,
          understandings, representations, and warranties, whether written or oral, with
          respect to such subject matter.
        </P>
      </Section>

      <Section n={28} title="No Waiver">
        <P>
          No failure on the part of any party to exercise, and no delay in exercising, any
          right or remedy under this Agreement will operate as a waiver thereof, nor will any
          single or partial exercise preclude any other or further exercise of any right or remedy.
        </P>
      </Section>

      <Section n={29} title="Contact Us">
        <P>
          If you have any questions about these Terms and Conditions, please contact us:
        </P>
        <P>
          By email:{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--accent)' }}>{CONTACT_EMAIL}</a>
        </P>
      </Section>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 24, marginTop: 16, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <Link to="/privacy" style={{ fontSize: 13.5, color: 'var(--accent)' }}>Privacy Policy</Link>
        <Link to="/faq" style={{ fontSize: 13.5, color: 'var(--accent)' }}>FAQ</Link>
        <Link to="/" style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>← Back to explore</Link>
      </div>
    </div>
  )
}
