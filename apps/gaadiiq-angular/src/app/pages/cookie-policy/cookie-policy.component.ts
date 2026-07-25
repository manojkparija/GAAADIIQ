import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-cookie-policy',
  standalone: true,
  imports: [CommonModule],
  template: `
<div class="legal-page">
  <div class="legal-hero">
    <div class="legal-icon">🍪</div>
    <h1>Cookie Policy</h1>
    <p class="legal-meta">Effective date: 1 January 2026 · Last updated: 1 July 2026</p>
  </div>

  <div class="legal-body">

    <section>
      <h2>1. What Are Cookies?</h2>
      <p>Cookies are small text files placed on your device when you visit a website. They help the site remember your preferences, keep you logged in, and understand how you use the platform. We also use similar technologies like local storage, session storage, and pixel tags — collectively referred to as "cookies" in this policy.</p>
    </section>

    <section>
      <h2>2. Cookies We Use</h2>
      <div class="cookie-table-wrap">
        <table class="cookie-table">
          <thead>
            <tr>
              <th>Category</th>
              <th>Purpose</th>
              <th>Examples</th>
              <th>Duration</th>
              <th>Required?</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Essential</strong></td>
              <td>Authentication, session management, CSRF protection, load balancing</td>
              <td>auth_token, csrf_token, session_id</td>
              <td>Session / 30 days</td>
              <td>Yes — cannot opt out</td>
            </tr>
            <tr>
              <td><strong>Functional</strong></td>
              <td>Remember your city, dark-mode preference, recently viewed cars</td>
              <td>gq_city, gq_theme, gq_recent</td>
              <td>1 year</td>
              <td>Optional</td>
            </tr>
            <tr>
              <td><strong>Analytics</strong></td>
              <td>Understand which pages and features are used most (anonymised)</td>
              <td>_ga, _gid, gq_analytics</td>
              <td>13 months</td>
              <td>Optional</td>
            </tr>
            <tr>
              <td><strong>Marketing</strong></td>
              <td>Show relevant car ads on third-party sites; measure campaign effectiveness</td>
              <td>_fbp, gq_ads, gclid</td>
              <td>90 days</td>
              <td>Optional</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section>
      <h2>3. Third-Party Cookies</h2>
      <p>Some cookies are set by third-party services we use:</p>
      <ul>
        <li><strong>Google Analytics</strong> — anonymous usage statistics. <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google Privacy Policy</a></li>
        <li><strong>Meta Pixel</strong> — advertising and retargeting. <a href="https://www.facebook.com/privacy/explanation" target="_blank" rel="noopener">Meta Privacy Policy</a></li>
        <li><strong>Razorpay</strong> — payment processing. <a href="https://razorpay.com/privacy/" target="_blank" rel="noopener">Razorpay Privacy Policy</a></li>
        <li><strong>Cloudflare</strong> — security and performance. <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener">Cloudflare Privacy Policy</a></li>
      </ul>
      <p>We do not control these third-party cookies. Review their policies for details.</p>
    </section>

    <section>
      <h2>4. Your Choices</h2>
      <h3>4.1 Cookie Banner</h3>
      <p>On your first visit we present a cookie consent banner. You can accept all, accept only essential cookies, or customise your preferences. You can change your choice at any time via <strong>Settings → Cookie Preferences</strong>.</p>
      <h3>4.2 Browser Settings</h3>
      <p>You can block or delete cookies through your browser settings. Note that disabling essential cookies may break core functionality like staying logged in.</p>
      <ul>
        <li><a href="https://support.google.com/chrome/answer/95647" target="_blank" rel="noopener">Chrome</a></li>
        <li><a href="https://support.mozilla.org/en-US/kb/cookies-information-websites-store-on-your-computer" target="_blank" rel="noopener">Firefox</a></li>
        <li><a href="https://support.apple.com/en-in/guide/safari/sfri11471/mac" target="_blank" rel="noopener">Safari</a></li>
        <li><a href="https://support.microsoft.com/en-us/windows/manage-cookies-in-microsoft-edge" target="_blank" rel="noopener">Edge</a></li>
      </ul>
      <h3>4.3 Opt-Out of Analytics</h3>
      <p>Install the <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener">Google Analytics Opt-out Browser Add-on</a> to prevent Google Analytics from collecting data on any website.</p>
    </section>

    <section>
      <h2>5. Local Storage & Session Storage</h2>
      <p>In addition to cookies, we use browser local storage to save your AI chat history, car comparison selections, and EMI calculator inputs. This data stays on your device and is never sent to our servers unless you explicitly save or share it.</p>
    </section>

    <section>
      <h2>6. Do Not Track</h2>
      <p>Some browsers send a "Do Not Track" (DNT) signal. We currently do not alter our data collection practices in response to DNT signals, but we honour your in-product cookie preferences.</p>
    </section>

    <section>
      <h2>7. Updates to This Policy</h2>
      <p>We may update this Cookie Policy when we add or remove cookies. We will notify you of significant changes via the cookie consent banner on your next visit.</p>
    </section>

    <section>
      <h2>8. Contact</h2>
      <p>Questions about cookies? Email <a href="mailto:privacy@gaadiiq.com">privacy@gaadiiq.com</a></p>
    </section>

  </div>
</div>
  `,
  styleUrls: ['../legal.shared.scss'],
})
export class CookiePolicyComponent {}
