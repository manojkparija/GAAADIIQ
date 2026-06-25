# GAADIIQ.COM — Business Requirements Document (BRD)

**Version:** 1.0  
**Date:** 2026-06-24  
**Status:** Approved for Phase 0

---

## 1. Business Context

GAADIIQ.COM is a bootstrapped, AI-first automotive intelligence platform targeting the Indian market. The platform is operated by a single founder with AI performing 95% of implementation. The goal is to reach revenue-positive operations within 6 months of launch using zero or near-zero infrastructure cost through free-tier cloud services.

## 2. Stakeholders

| Role | Responsibility |
|---|---|
| Founder / Product Owner | Vision, approvals, partnership outreach |
| AI Development System | All code, docs, tests, infrastructure |
| Car Buyers | Primary end-users (free) |
| Dealers | B2B customers (paid leads) |
| OEM Partners | Premium placement & data partnerships |
| Affiliate Partners | Loan / Insurance referral revenue |

## 3. Business Requirements

### BR-01: Car Catalog
- Maintain a comprehensive catalog of all passenger vehicles sold in India.
- Cover all brands, models, variants, and specifications.
- Update pricing and availability data at least weekly.

### BR-02: Search & Discovery
- Users must be able to find cars in under 3 interactions.
- Support filtering by 20+ parameters.
- Return results in under 500ms (P95).

### BR-03: AI Recommendation
- Platform must recommend top 3 cars based on user inputs.
- Inputs: budget, city, usage, family size, fuel preference, features.
- Recommendations must be explainable ("why this car was recommended").

### BR-04: Ownership Cost Intelligence
- Every car must show 5-year TCO breakdown.
- Include: fuel cost, insurance, maintenance, depreciation, EMI.
- Allow user to customise inputs (km/year, city, loan tenure).

### BR-05: Car Comparison
- Users can compare up to 5 cars side-by-side.
- Comparison covers 100+ parameters.
- Highlight winner per category.

### BR-06: Dealer Lead Generation
- Capture buyer intent and route to nearest verified dealer.
- Lead must include: car of interest, variant, budget, location, contact.
- Dealer dashboard to view and manage leads.

### BR-07: Test Drive Booking
- User can book test drive directly on platform.
- Dealer receives notification within 5 minutes.
- User receives confirmation email/SMS.

### BR-08: Loan & Insurance Affiliates
- Show personalised loan quotes from 3+ partner banks/NBFCs.
- Show insurance quotes from 2+ insurers.
- Track clicks and conversions for affiliate revenue.

### BR-09: Admin Portal
- Admin can add/edit/delete cars, variants, specs.
- Admin can manage dealers and leads.
- Admin can view platform analytics dashboard.

### BR-10: SEO & Content
- All car pages must be SEO-optimised.
- Schema markup for rich snippets.
- Auto-generated meta descriptions using AI.

## 4. Revenue Requirements

| Stream | Model | Target (Month 6) |
|---|---|---|
| Dealer Lead Generation | ₹500–₹2,000 per lead | ₹5L/month |
| Test Drive Booking | ₹300/booking | ₹1.5L/month |
| Vehicle Loan Affiliate | 0.3% commission on disbursal | ₹2L/month |
| Insurance Affiliate | ₹500–₹1,500 per policy | ₹2L/month |
| Sponsored Listings | ₹10,000–₹50,000/month per dealer | ₹2L/month |
| Google AdSense | CPM-based | ₹1L/month |
| Premium Subscription | ₹299/month | ₹1L/month |
| OEM Partnerships | Annual contracts | ₹1L/month avg |

**Total MRR Target (Month 6):** ₹15.5 Lakhs

## 5. Non-Functional Requirements

| Requirement | Target |
|---|---|
| Uptime | 99.5% |
| Page Load (LCP) | < 2.5s on 4G |
| API Response (P95) | < 500ms |
| Security | OWASP Top 10 compliant |
| Data Privacy | DPDP Act 2023 compliant |
| Scalability | Handle 10x traffic spike without manual intervention |
| Mobile Performance | Lighthouse score > 85 |

## 6. Constraints

- Infrastructure cost must be < ₹5,000/month (primarily free-tier services).
- No full-time engineering team — AI executes all implementation.
- Must use open-source or free-tier tools exclusively (see Technology Stack).
- Launch MVP within 90 days of Phase 0 approval.

## 7. Assumptions

- imagin.studio or equivalent will be licensed for car imagery before launch.
- Domain gaadiiq.com is already owned by the founder.
- Oracle Cloud Free Tier will be used for backend compute (4 OCPUs, 24GB RAM — always free).
- Supabase Free Tier for PostgreSQL (500MB, sufficient for MVP).
- Vercel Free Tier for Next.js frontend.

## 8. Acceptance Criteria

Each phase is accepted when:
1. All documented deliverables are present in `/docs`.
2. All tests pass (where applicable).
3. Founder approves the phase checkpoint.

---

*Previous: [Vision.md](Vision.md) | Next: [PRD.md](PRD.md)*
