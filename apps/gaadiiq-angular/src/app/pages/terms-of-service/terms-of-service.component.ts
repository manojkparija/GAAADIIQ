import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-terms-of-service',
  standalone: true,
  imports: [CommonModule],
  template: `
<div class="legal-page">
  <div class="legal-hero">
    <div class="legal-icon">📋</div>
    <h1>Terms of Service</h1>
    <p class="legal-meta">Effective date: 1 January 2026 · Last updated: 1 July 2026</p>
  </div>

  <div class="legal-body">

    <section>
      <h2>1. Acceptance of Terms</h2>
      <p>By accessing or using GAADIIQ ("Platform"), you agree to be bound by these Terms of Service ("Terms") and our <a href="/privacy-policy">Privacy Policy</a>. If you do not agree, do not use the Platform. These Terms constitute a legally binding agreement between you and GAADIIQ Technologies Pvt. Ltd.</p>
    </section>

    <section>
      <h2>2. Eligibility</h2>
      <p>You must be at least 18 years old and legally capable of entering into contracts under Indian law to use the Platform. By using GAADIIQ, you represent that you meet these requirements.</p>
    </section>

    <section>
      <h2>3. Your Account</h2>
      <ul>
        <li>You are responsible for maintaining the confidentiality of your account credentials.</li>
        <li>You are responsible for all activity that occurs under your account.</li>
        <li>Notify us immediately at <a href="mailto:support&#64;gaadiiq.com">support&#64;gaadiiq.com</a> if you suspect unauthorised access.</li>
        <li>You may not create accounts on behalf of others without authorisation.</li>
        <li>We reserve the right to suspend or terminate accounts that violate these Terms.</li>
      </ul>
    </section>

    <section>
      <h2>4. Platform Services</h2>
      <h3>4.1 Vehicle Listings</h3>
      <p>GAADIIQ is a marketplace platform. We do not own, sell, or represent any vehicles listed. Transactions are between buyers and sellers. We are not a party to any vehicle sale.</p>
      <h3>4.2 AI Features</h3>
      <p>Our AI tools (Advisor, Diagnosis, Valuation) are provided for informational purposes only. AI outputs are not professional financial, mechanical, or legal advice. Always verify important decisions independently.</p>
      <h3>4.3 EMI Calculator & Financial Tools</h3>
      <p>Calculations are indicative only. Actual loan terms depend on your lender. GAADIIQ is not a registered financial advisor or NBFC.</p>
    </section>

    <section>
      <h2>5. Seller Obligations</h2>
      <p>If you list a vehicle for sale, you agree to:</p>
      <ul>
        <li>Provide accurate, truthful information about the vehicle.</li>
        <li>Own the vehicle or have legal authority to sell it.</li>
        <li>Not list stolen, encumbered (with undisclosed loans), or legally restricted vehicles.</li>
        <li>Remove listings promptly once the vehicle is sold.</li>
        <li>Comply with all applicable Indian motor vehicle laws and RTO regulations.</li>
      </ul>
    </section>

    <section>
      <h2>6. Prohibited Conduct</h2>
      <p>You may not:</p>
      <ul>
        <li>Post false, misleading, or fraudulent listings or content.</li>
        <li>Scrape, crawl, or data-mine the Platform without written consent.</li>
        <li>Reverse-engineer, decompile, or attempt to extract source code.</li>
        <li>Use the Platform to send spam, phishing, or unsolicited communications.</li>
        <li>Interfere with, disrupt, or perform denial-of-service attacks on the Platform.</li>
        <li>Use automated bots or scripts to interact with the Platform.</li>
        <li>Impersonate any person, dealer, or organisation.</li>
      </ul>
    </section>

    <section>
      <h2>7. Intellectual Property</h2>
      <p>All content, trademarks, logos, AI models, and software on the Platform are owned by or licensed to GAADIIQ Technologies Pvt. Ltd. You may not reproduce, distribute, or create derivative works without our express written consent.</p>
      <p>By submitting content (listings, reviews, images), you grant GAADIIQ a royalty-free, worldwide licence to display, reproduce, and promote that content on the Platform.</p>
    </section>

    <section>
      <h2>8. Disclaimers</h2>
      <p>THE PLATFORM IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED. WE DO NOT WARRANT THAT THE PLATFORM WILL BE UNINTERRUPTED, ERROR-FREE, OR FREE OF VIRUSES. WE MAKE NO WARRANTY AS TO THE ACCURACY OF VEHICLE LISTINGS OR AI OUTPUTS.</p>
    </section>

    <section>
      <h2>9. Limitation of Liability</h2>
      <p>TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, GAADIIQ AND ITS DIRECTORS, EMPLOYEES, AND AGENTS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES ARISING FROM YOUR USE OF THE PLATFORM, INCLUDING BUT NOT LIMITED TO LOSS OF DATA, PROFITS, OR GOODWILL. OUR TOTAL LIABILITY TO YOU SHALL NOT EXCEED THE AMOUNT PAID BY YOU TO GAADIIQ IN THE 3 MONTHS PRECEDING THE CLAIM.</p>
    </section>

    <section>
      <h2>10. Indemnification</h2>
      <p>You agree to indemnify and hold harmless GAADIIQ and its affiliates from any claims, damages, or expenses (including legal fees) arising from your use of the Platform, violation of these Terms, or infringement of any third-party rights.</p>
    </section>

    <section>
      <h2>11. Governing Law & Dispute Resolution</h2>
      <p>These Terms are governed by the laws of India. Any disputes shall first be attempted to be resolved amicably. If unresolved within 30 days, disputes shall be subject to the exclusive jurisdiction of the courts of Bengaluru, Karnataka, India.</p>
    </section>

    <section>
      <h2>12. Changes to Terms</h2>
      <p>We may update these Terms at any time. We will notify you of material changes at least 14 days in advance via email or in-app notice. Continued use after the effective date constitutes acceptance of the revised Terms.</p>
    </section>

    <section>
      <h2>13. Contact</h2>
      <p>Questions about these Terms? Email us at <a href="mailto:legal&#64;gaadiiq.com">legal&#64;gaadiiq.com</a> or write to:<br>GAADIIQ Technologies Pvt. Ltd., Bengaluru, Karnataka, India.</p>
    </section>

  </div>
</div>
  `,
  styleUrls: ['../legal.shared.scss'],
})
export class TermsOfServiceComponent {}
