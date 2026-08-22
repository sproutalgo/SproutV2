import React from 'react'
import { Link } from 'react-router-dom'

const EFFECTIVE_DATE = 'May 31, 2026'
const CONTACT_EMAIL  = 'admin@sproutalgo.com'

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

export default function PrivacyPolicy() {
  return (
    <div className="wrap rise" style={{ maxWidth: 780, paddingTop: 48, paddingBottom: 80 }}>
      <span className="eyebrow">Legal</span>
      <h1 style={{ marginTop: 12, marginBottom: 4 }}>Privacy &amp; Cookie Policy</h1>
      <p style={{ fontSize: 13.5, color: 'var(--text-muted)', marginBottom: 40 }}>
        Effective date: {EFFECTIVE_DATE}
      </p>

      <P>
        Sprout Ventures LLC ("us", "we", or "our") operates the Sprout platform (the "Service"). We are
        committed to protecting and respecting your privacy. We use your data solely to provide and
        improve the Service. We may update this Policy from time to time — please check this page
        occasionally to ensure you are happy with any changes. By using our platform, you agree to
        be bound by this Policy.
      </P>

      <Section n={1} title="Information Collection and Use">
        <P>
          We collect several types of information for various purposes to provide and improve our
          Service to you.
        </P>
      </Section>

      <Section n={2} title="Types of Data Collected">
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>2.1 Personal Data</h3>
        <P>
          While using our Service, we may ask you to provide certain personally identifiable
          information that can be used to contact or identify you ("Personal Data"). This may
          include, but is not limited to:
        </P>
        <Ul items={[
          'Email address',
          'Algorand wallet address',
          'Usage Data',
          'Cookies and tracking data',
        ]} />

        <h3 style={{ fontSize: 15, fontWeight: 600, margin: '16px 0 8px' }}>2.2 Usage Data</h3>
        <P>
          We may also collect information about how the Service is accessed and used ("Usage Data").
          This may include your Internet Protocol address, browser type and version, the pages of
          our Service that you visit, the time and date of your visit, time spent on those pages,
          unique device identifiers, and other diagnostic data.
        </P>

        <h3 style={{ fontSize: 15, fontWeight: 600, margin: '16px 0 8px' }}>2.3 Tracking &amp; Cookies Data</h3>
        <P>
          We use cookies and similar tracking technologies to track activity on our Service and
          hold certain information. You can instruct your browser to refuse all cookies or to
          indicate when a cookie is being sent. If you do not accept cookies, some portions of
          our Service may not function correctly.
        </P>
        <P>Types of cookies we use:</P>
        <Ul items={[
          'Session Cookies — to operate our Service.',
          'Preference Cookies — to remember your preferences and settings.',
          'Security Cookies — for security purposes.',
        ]} />
      </Section>

      <Section n={3} title="Use of Data">
        <P>Sprout uses collected data for the following purposes:</P>
        <Ul items={[
          'To provide and maintain the Service',
          'To notify you about changes to our Service',
          'To allow you to participate in interactive features of our Service',
          'To provide customer care and support',
          'To provide analysis or valuable information so that we can improve the Service',
          'To monitor the usage of the Service',
          'To detect, prevent, and address technical issues',
        ]} />
      </Section>

      <Section n={4} title="Transfer of Data">
        <P>
          Your information, including Personal Data, may be transferred to and maintained on
          computers located outside of your state, province, country, or other governmental
          jurisdiction where data protection laws may differ from those in your jurisdiction.
        </P>
        <P>
          If you are located outside the U.S. and choose to provide information to us, please
          note that we transfer and process that data in the U.S. Your consent to this Privacy
          Policy, followed by your submission of such information, represents your agreement to
          that transfer.
        </P>
        <P>
          Sprout will take all steps reasonably necessary to ensure your data is treated
          securely and in accordance with this Privacy Policy.
        </P>
      </Section>

      <Section n={5} title="Disclosure of Data">
        <P>
          Sprout may disclose your Personal Data in the good faith belief that such action
          is necessary to:
        </P>
        <Ul items={[
          'Comply with a legal obligation',
          'Protect and defend the rights or property of Sprout',
          'Prevent or investigate possible wrongdoing in connection with the Service',
          'Protect the personal safety of users of the Service or the public',
          'Protect against legal liability',
        ]} />
      </Section>

      <Section n={6} title="Security of Data">
        <P>
          The security of your data is important to us. However, no method of transmission over
          the Internet or electronic storage is 100% secure. While we strive to use commercially
          acceptable means to protect your Personal Data, we cannot guarantee its absolute security.
        </P>
        <P>
          Importantly, Sprout is a non-custodial platform. We do not hold, store, or have
          access to your Algorand private keys or digital assets at any time. All on-chain
          transactions are executed directly by smart contracts and signed by your own wallet.
        </P>
      </Section>

      <Section n={7} title="Service Providers">
        <P>
          We may employ third-party companies and individuals to facilitate our Service ("Service
          Providers"), to provide the Service on our behalf, to perform Service-related services,
          or to assist us in analyzing how our Service is used. These third parties have access
          to your Personal Data only to perform these tasks on our behalf and are obligated not
          to disclose or use it for any other purpose.
        </P>
      </Section>

      <Section n={8} title="Analytics">
        <P>
          We may use third-party Service Providers to monitor and analyze the use of our Service.
          Any such provider will be subject to their own privacy policies governing data handling.
        </P>
      </Section>

      <Section n={9} title="General Data Protection Regulation (GDPR)">
        <P>
          We are a Data Controller of your information. Sprout's legal basis for collecting
          and using the personal information described in this Privacy Policy depends on the
          Personal Data we collect and the specific context in which we collect it:
        </P>
        <Ul items={[
          'Sprout needs to perform a contract with you',
          'You have given Sprout permission to do so',
          'Processing your personal information is in Sprout\'s legitimate interests',
          'Sprout needs to comply with the law',
        ]} />
        <P>
          If you are a resident of the European Economic Area (EEA), you have the following
          data protection rights:
        </P>
        <Ul items={[
          'The right to access, update, or delete the information we hold about you',
          'The right of rectification',
          'The right to object',
          'The right of restriction',
          'The right to data portability',
          'The right to withdraw consent',
        ]} />
        <P>
          To exercise any of these rights, please contact us at{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--accent)' }}>{CONTACT_EMAIL}</a>.
        </P>
      </Section>

      <Section n={10} title="Log Files">
        <P>
          Sprout follows a standard procedure of using log files. These files log visitors
          when they visit the platform. Information collected by log files includes IP addresses,
          browser type, Internet Service Provider (ISP), date and time stamp, referring/exit
          pages, and possibly the number of clicks. These are not linked to any personally
          identifiable information. The purpose of this information is for analyzing trends,
          administering the site, tracking users' movement on the platform, and gathering
          demographic information.
        </P>
      </Section>

      <Section n={11} title="Links to Other Sites">
        <P>
          Our Service may contain links to other sites that are not operated by us. If you click
          a third-party link, you will be directed to that third party's site. We strongly advise
          you to review the privacy policy of every site you visit. We have no control over and
          assume no responsibility for the content, privacy policies, or practices of any
          third-party sites or services.
        </P>
      </Section>

      <Section n={12} title="Children's Privacy">
        <P>
          Sprout is not intended for children under the age of 18, and we do not knowingly
          collect Personal Data from children under the age of 18. If we learn that we have
          collected any Personal Data from a child under the age of 18, we will promptly delete
          it from our systems.
        </P>
      </Section>

      <Section n={13} title="Changes to This Privacy Policy">
        <P>
          We may update our Privacy Policy from time to time. We will notify you of any changes
          by posting the new Privacy Policy on this page and updating the effective date at the
          top. You are advised to review this Privacy Policy periodically for any changes.
          Changes are effective when they are posted on this page.
        </P>
      </Section>

      <Section n={14} title="California Privacy Rights (CCPA)">
        <P>
          California consumers have the following additional rights under the CCPA with respect
          to their Personal Information:
        </P>
        <Ul items={[
          'Right to Request Access — You may request that Sprout disclose the categories of personal information we have collected about you in the past 12 months.',
          'Right to Request Deletion — You may request that Sprout delete the personal information we have collected from you.',
          'Right Not to Receive Discriminatory Treatment — You have the right to exercise these privacy rights without discriminatory treatment.',
        ]} />
        <P>
          To submit a request, email us at{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--accent)' }}>{CONTACT_EMAIL}</a>.
          We are legally obligated to verify your identity when you submit a request and may
          request additional information to do so.
        </P>
      </Section>

      <Section n={15} title="Contact Us">
        <P>
          If you have any questions about this Privacy Policy, please contact us:
        </P>
        <P>
          By email:{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--accent)' }}>{CONTACT_EMAIL}</a>
        </P>
      </Section>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 24, marginTop: 16, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <Link to="/terms" style={{ fontSize: 13.5, color: 'var(--accent)' }}>Terms &amp; Conditions</Link>
        <Link to="/faq" style={{ fontSize: 13.5, color: 'var(--accent)' }}>FAQ</Link>
        <Link to="/" style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>← Back to explore</Link>
      </div>
    </div>
  )
}
