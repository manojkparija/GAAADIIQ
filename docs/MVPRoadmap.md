# GAADIIQ.COM — MVP Scope & Product Roadmap

**Version:** 1.0  
**Date:** 2026-06-24  
**Status:** Approved for Phase 0

---

## 1. MVP Definition

The MVP launches GAADIIQ.COM with the core value proposition: **find and compare the right car with AI, understand true ownership cost, and connect with verified dealers** — in one platform.

**MVP Success Criteria:**
- 300+ car variants in catalog
- AI Advisor functional (rule-based + LLM)
- TCO calculator live for all cars
- Dealer lead capture operational
- SEO-ready car pages indexed
- < 2.5s LCP on mobile
- Zero paid infrastructure

---

## 2. Phase Roadmap

### Phase 0 — Product Discovery *(Current — Week 1)*
Deliverables: Vision.md, BRD.md, PRD.md, CompetitorAnalysis.md, MVPRoadmap.md  
**Checkpoint:** Founder approves all 5 documents before Phase 1 begins.

---

### Phase 1 — High Level Design *(Week 1–2)*
Deliverables: HLD.md, ArchitectureDiagram.md, DeploymentDiagram.md, SecurityArchitecture.md, MonitoringArchitecture.md  
No code.  
**Checkpoint:** Architecture approved before LLD.

---

### Phase 2 — Low Level Design *(Week 2–3)*
Deliverables: DatabaseDesign.md, ERDiagram.md, APIContracts.md, SequenceDiagrams.md, UIArchitecture.md, AIArchitecture.md  
No code.  
**Checkpoint:** LLD approved before implementation begins.

---

### Phase 3 — Repository Setup *(Week 3)*
Create monorepo structure, Docker environment, CI/CD skeleton, coding standards.  
**Output:** Working local dev environment.

---

### Phase 4 — Database Implementation *(Week 3–4)*
PostgreSQL schema: brands, cars, variants, specs, features, images, reviews, users, dealers, leads, recommendations, analytics.  
Migrations + seed data (300 variants).  
**Output:** Populated local database.

---

### Phase 5 — Car Catalog Module *(Week 4–5)*
Backend: FastAPI CRUD for brands/cars/variants/features/reviews.  
Frontend: Brand listing, car listing, variant detail pages.  
**Output:** Browsable car catalog.

---

### Phase 6 — Search Module *(Week 5)*
OpenSearch integration. Filter API. Frontend search UI.  
**Output:** Full-text + filtered search.

---

### Phase 7 — Comparison Module *(Week 6)*
Compare 2–5 cars. Highlight winners per category. Shareable URL.  
**Output:** Comparison tool live.

---

### Phase 8 — Ownership Analytics Module *(Week 6–7)*
TCO calculator: fuel, insurance, maintenance, depreciation, EMI.  
Integrated into variant pages and standalone tool.  
**Output:** TCO on every variant page.

---

### Phase 9 — AI Recommendation Engine *(Week 7–8)*
6-question wizard. Rule engine + Llama 3 LLM via Ollama. Match score. Explainability card.  
**Output:** "Find My Car" AI Advisor live.

---

### Phase 10 — Lead Management Module *(Week 8–9)*
Dealer lead form. Test drive booking. Loan/insurance enquiry routing. Dealer dashboard.  
**Output:** Revenue-generating lead capture live.

---

### Phase 11 — Admin Portal *(Week 9–10)*
User management, car management, lead management, analytics dashboard.  
**Output:** Founder can manage platform without code.

---

### Phase 12 — Testing *(Week 10–11)*
Unit, integration, API, security, performance tests. Test report.  
**Output:** All modules tested, bugs resolved.

---

### Phase 13 — DevOps *(Week 11)*
Dockerfiles, Docker Compose, GitHub Actions CI/CD, deployment scripts for Vercel + Oracle Cloud.  
**Output:** One-command deploy to production.

---

### Phase 14 — SEO *(Week 11–12)*
Schema markup, meta tags, sitemap, robots.txt. AI-generated page descriptions.  
**Output:** All pages SEO-optimised, submitted to Google Search Console.

---

### Phase 15 — Production Release *(Week 12)*
Production checklist, go-live, monitoring, rollback plan.  
**Output:** GAADIIQ.COM live at production domain.

---

## 3. Post-MVP Roadmap (Months 4–12)

| Quarter | Features |
|---|---|
| Q2 (Months 4–6) | Premium subscription, price alerts, used car section, OEM dashboard |
| Q3 (Months 7–9) | ~~Mobile app (React Native)~~ → **shipped as Capacitor, see `MOBILE_ROADMAP.md`**; EV charging map, community reviews |
| Q4 (Months 10–12) | Collaborative filtering ML model (live user data), AI price prediction, API for dealer integrations |

---

## 4. Revenue Timeline

| Month | Focus | Target MRR |
|---|---|---|
| 1 | Launch, SEO indexing | ₹0 (Google AdSense only) |
| 2 | First dealer partnerships | ₹50,000 |
| 3 | Affiliate integrations live | ₹2,00,000 |
| 4 | 10 dealer accounts | ₹5,00,000 |
| 5 | OEM pilot | ₹10,00,000 |
| 6 | Stable operations | ₹15,00,000 |

---

## 5. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Free-tier limits breached by traffic | Medium | High | Oracle Cloud scale-out; Cloudflare caching |
| Google algorithm change reduces SEO traffic | Medium | High | Diversify: social, direct, email, WhatsApp |
| CarDekho copies AI features | High | Medium | Speed advantage; deeper personalisation |
| Dealer sign-up slower than expected | Medium | High | Start with Google AdSense revenue first |
| LLM quality poor on Indian cars | Low | Medium | Fallback rule engine always available |
| Supabase free-tier storage exhausted | Low | Low | Migrate to Oracle Cloud PostgreSQL (free tier) |

---

## 6. Approval Checkpoint

**Phase 0 Complete.** All 5 documents delivered:
- [x] [Vision.md](Vision.md)
- [x] [BRD.md](BRD.md)
- [x] [PRD.md](PRD.md)
- [x] [CompetitorAnalysis.md](CompetitorAnalysis.md)
- [x] [MVPRoadmap.md](MVPRoadmap.md)

**Founder approval required to proceed to Phase 1 (HLD).**

---

*Previous: [CompetitorAnalysis.md](CompetitorAnalysis.md)*
