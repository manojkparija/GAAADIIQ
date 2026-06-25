# GAADIIQ.COM — Competitor Analysis & Feature Gap Analysis

**Version:** 1.0  
**Date:** 2026-06-24  
**Status:** Approved for Phase 0

---

## 1. Competitive Landscape

### 1.1 Primary Competitors

| Platform | Monthly Traffic (Est.) | Primary Strength | Revenue Model |
|---|---|---|---|
| CarDekho | 45M visits | Largest catalog; new + used | Leads, ads, insurance |
| CarWale | 20M visits | Editorial quality; EMI tools | Leads, ads, OEM |
| V3Cars | 2M visits | Deep spec comparison; unbiased | Ads, affiliate |
| ZigWheels | 8M visits | News + reviews; community | Ads, leads |
| Autocar India | 5M visits | Editorial authority; road tests | Ads, OEM |
| Car and Bike | 6M visits | Video reviews | Ads, affiliate |
| BikeDekho | 15M visits | Two-wheelers (adjacent) | Leads, ads |

---

## 2. Feature Gap Analysis vs. V3Cars (Primary Benchmark)

V3Cars is the closest benchmark for GAADIIQ — deep spec comparison, no dealer noise. We must match V3Cars on data quality and exceed it on intelligence.

| Feature | V3Cars | CarDekho | CarWale | **GAADIIQ** |
|---|---|---|---|---|
| Car Catalog depth | ★★★★★ | ★★★★☆ | ★★★★☆ | ★★★★★ |
| Variant comparison | ★★★★★ | ★★★☆☆ | ★★★☆☆ | ★★★★★ |
| AI Advisor / Chat | ✗ | ✗ | ✗ | ✅ LLM-backed |
| ML Recommendation | ✗ | Basic filters | Basic filters | ✅ Personalised |
| 5-Year TCO Model | ★★☆☆☆ | ★★★☆☆ | ★★★☆☆ | ★★★★★ |
| Depreciation curve | ✗ | ✗ | ✗ | ✅ |
| Explainable AI picks | ✗ | ✗ | ✗ | ✅ |
| NCAP safety filter | ★★☆☆☆ | ★★★☆☆ | ★★★☆☆ | ★★★★★ |
| EV intelligence | ★★☆☆☆ | ★★★☆☆ | ★★☆☆☆ | ★★★★☆ |
| Compare 5 cars | ✅ | ✅ (3 max) | ✅ (3 max) | ✅ (5 cars) |
| User shortlist | ✗ | ✅ | ✅ | ✅ |
| Dealer leads | ✗ | ✅ | ✅ | ✅ Intent-scored |
| Test drive booking | ✗ | ✅ | ✅ | ✅ |
| Loan EMI calculator | ★★★☆☆ | ★★★★☆ | ★★★★☆ | ★★★★★ |
| Insurance quotes | ✗ | ✅ | ✅ | ✅ |
| SEO schema markup | ★★★☆☆ | ★★★★☆ | ★★★★☆ | ★★★★★ |
| Mobile performance | ★★★☆☆ | ★★☆☆☆ | ★★★☆☆ | ★★★★★ |
| Page load speed | ★★★☆☆ | ★★☆☆☆ | ★★★☆☆ | ★★★★★ |
| Ad density | Low | High | Medium | Low (premium) |
| API-first design | ✗ | ✗ | ✗ | ✅ |

### Key Gaps GAADIIQ Fills

1. **AI Advisor** — No competitor has a conversational AI for car selection.
2. **Explainable recommendations** — Buyers don't just want a list; they want to understand why.
3. **Predictive TCO** — V3Cars has basic calculators; no one models real depreciation curves.
4. **Intent-scored leads** — Dealers pay the same rate for window-shoppers and ready buyers; we differentiate.
5. **Speed & mobile experience** — CarDekho Lighthouse score is ~35; we target >85.

---

## 3. SEO Opportunity Analysis

V3Cars ranks for high-intent keywords like:
- "best car under 10 lakh" (90,500 searches/month)
- "Hyundai Creta vs Kia Seltos" (33,100/month)
- "car ownership cost calculator" (5,400/month)

GAADIIQ strategy:
- Target comparison keywords: "X vs Y" pages (programmatically generated for top 500 pairs)
- Target intent keywords: "best [body type] under [budget] in [city]"
- Target calculator keywords: TCO, EMI, insurance calculators
- Target review keywords: "[car name] review 2026"

---

## 4. Technology Differentiation

| Dimension | Competitors | GAADIIQ Advantage |
|---|---|---|
| Tech stack | Legacy PHP/Java monoliths | Next.js + FastAPI + AI layer |
| Recommendations | Manual editorial picks | ML + LLM real-time |
| Data freshness | Weekly batch updates | Near real-time (webhooks) |
| API design | Tightly coupled | API-first, headless |
| Infrastructure cost | ₹10L+/month | < ₹5,000/month (free tier) |
| Development speed | 50-person teams | AI-first, single founder |

---

## 5. SWOT Analysis

### Strengths
- Zero infrastructure cost (free-tier hosting)
- AI-first — capabilities competitors can't match without multi-year investment
- No legacy technical debt
- Single founder = fast decision-making

### Weaknesses
- No brand recognition (Day 1)
- No user-generated review content yet
- No existing dealer relationships
- Single founder = limited bandwidth for sales/partnerships

### Opportunities
- India car sales growing 8% CAGR
- EV adoption creating new research behaviour
- No AI-first automotive platform exists in India
- Dealer digital spend increasing post-pandemic

### Threats
- CarDekho / CarWale can copy AI features with their engineering teams
- Google SGE reducing organic traffic to informational pages
- OEM direct-to-consumer shift reducing dealer ecosystem
- Platform risk: dependency on Vercel/Supabase free tiers

---

*Previous: [PRD.md](PRD.md) | Next: [MVPRoadmap.md](MVPRoadmap.md)*
