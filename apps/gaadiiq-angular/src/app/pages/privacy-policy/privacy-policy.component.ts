import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-privacy-policy',
  standalone: true,
  imports: [CommonModule],
  template: `
<div class="legal-page">
  <div class="legal-hero">
    <div class="legal-icon">🔒</div>
    <h1>Privacy Policy</h1>
    <p class="legal-meta">Effective date: 1 January 2026 · Last updated: 1 July 2026</p>
  </div>

  <div class="legal-body">

    <section>
      <h2>1. Who We Are</h2>
      <p>GAADIIQ ("we", "our", "us") is an AI-first automotive intelligence platform operated by GAADIIQ Technologies Pvt. Ltd., registered in India. We help users discover, compare, buy, and sell vehicles smarter.</p>
      <p>Contact us at: <a href="mailto:privacy@gaadiiq.com">privacy@gaadiiq.com</a></p>
    </section>

    <section>
      <h2>2. Information We Collect</h2>
      <h3>2.1 Information You Provide</h3>
      <ul>
        <li><strong>Account data</strong> — name, email address, phone number, and password when you register.</li>
        <li><strong>Listing data</strong> — vehicle details, images, price, and location when you list a car for sale.</li>
        <li><strong>Communications</strong> — messages you send via contact forms or support email.</li>
        <li><strong>Payment data</strong> — billing details processed through our payment partners (we do not store raw card numbers).</li>
      </ul>
      <h3>2.2 Information Collected Automatically</h3>
      <ul>
        <li><strong>Usage data</strong> — pages visited, search queries, filters applied, and features used.</li>
        <li><strong>Device & browser data</strong> — IP address, browser type, OS version, and screen resolution.</li>
        <li><strong>Location</strong> — city-level location inferred from IP or granted by you for local listings.</li>
        <li><strong>Cookies & trackers</strong> — see our <a href="/cookie-policy">Cookie Policy</a> for full details.</li>
      </ul>
      <h3>2.3 AI Interaction Data</h3>
      <p>When you use AI features (AI Advisor, AI Diagnosis, AI Valuation), your inputs are processed to generate responses. We may retain anonymised transcripts to improve model quality.</p>
    </section>

    <section>
      <h2>3. How We Use Your Information</h2>
      <ul>
        <li>Operate and improve the GAADIIQ platform and its AI features.</li>
        <li>Personalise car recommendations and price alerts.</li>
        <li>Process transactions and send transactional notifications.</li>
        <li>Detect and prevent fraud, abuse, and security incidents.</li>
        <li>Comply with applicable Indian laws and regulations.</li>
        <li>Send marketing communications (only with your consent; opt-out any time).</li>
      </ul>
    </section>

    <section>
      <h2>4. Legal Basis for Processing</h2>
      <p>We process personal data under one or more of the following bases:</p>
      <ul>
        <li><strong>Contract</strong> — to fulfil our service agreement with you.</li>
        <li><strong>Legitimate interests</strong> — to operate, secure, and improve our platform.</li>
        <li><strong>Consent</strong> — for marketing emails and non-essential cookies.</li>
        <li><strong>Legal obligation</strong> — where required by Indian law (e.g. IT Act 2000, DPDPA 2023).</li>
      </ul>
    </section>

    <section>
      <h2>5. Sharing Your Information</h2>
      <p>We do not sell your personal data. We may share it with:</p>
      <ul>
        <li><strong>Service providers</strong> — cloud hosting, payment processors, SMS gateways, and analytics tools operating under data processing agreements.</li>
        <li><strong>Dealers & sellers</strong> — if you express interest in a listed vehicle, limited contact details may be shared with that seller.</li>
        <li><strong>Legal authorities</strong> — when required by court order, law enforcement, or applicable regulation.</li>
        <li><strong>Business transfers</strong> — in the event of a merger, acquisition, or asset sale, your data may transfer to the successor entity.</li>
      </ul>
    </section>

    <section>
      <h2>6. Data Retention</h2>
      <p>We retain your personal data for as long as your account is active or as needed to provide services. You may request deletion at any time (see Section 8). Anonymised, aggregated data may be retained indefinitely for analytics.</p>
    </section>

    <section>
      <h2>7. Security</h2>
      <p>We use industry-standard measures — TLS encryption in transit, AES-256 at rest, access controls, and regular security audits — to protect your data. No system is 100% secure; please use a strong, unique password and enable two-factor authentication if offered.</p>
    </section>

    <section>
      <h2>8. Your Rights</h2>
      <p>Under India's Digital Personal Data Protection Act (DPDPA) 2023 and other applicable laws, you have the right to:</p>
      <ul>
        <li>Access the personal data we hold about you.</li>
        <li>Correct inaccurate or incomplete data.</li>
        <li>Erase your data (subject to legal retention obligations).</li>
        <li>Withdraw consent at any time without affecting prior processing.</li>
        <li>Nominate a representative to exercise rights on your behalf.</li>
        <li>Lodge a complaint with the Data Protection Board of India.</li>
      </ul>
      <p>To exercise these rights, email <a href="mailto:privacy@gaadiiq.com">privacy@gaadiiq.com</a>. We respond within 30 days.</p>
    </section>

    <section>
      <h2>9. Children's Privacy</h2>
      <p>GAADIIQ is not directed at children under 18. We do not knowingly collect data from minors. If you believe a minor has provided us data, please contact us immediately.</p>
    </section>

    <section>
      <h2>10. Changes to This Policy</h2>
      <p>We may update this policy periodically. We will notify you of material changes via email or an in-app banner at least 14 days before they take effect. Continued use after the effective date constitutes acceptance.</p>
    </section>

  </div>
</div>
  `,
  styleUrls: ['../legal.shared.scss'],
})
export class PrivacyPolicyComponent {}
