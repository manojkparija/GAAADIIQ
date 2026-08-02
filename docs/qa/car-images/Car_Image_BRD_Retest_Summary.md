# Car Image BRD — E2E Retest (Post Merge)

| Field | Value |
|-------|-------|
| Date | 2026-08-02 10:26 UTC |
| Code tip | `origin/master @ 15518ac (WAVE 2 complete + WAVE 3 partial)` |
| Prior score | 55/100 |
| **BRD readiness now** | **83/100** |
| Requirements | 26 PASS / 13 PARTIAL / 0 FAIL |
| Test cases | 25 PASS / 4 PARTIAL / 5 FAIL |
| pytest (retest) | **70 passed** (`test_media_admin` + `test_media_storage` + `test_filename_metadata`) |
| Verdict | **Conditional GO** for core DAM · Full BRD (15GB + semantic ML) still open |

---

## What closed since prior audit (55 → 83)

| ID | Was → Now | Fix |
|----|-----------|-----|
| BR-002 | PARTIAL → **PASS** | Admin form + API Form validation |
| BR-004 | PARTIAL → **PASS** | inspect + extract_exif + pre-save UI |
| BR-DB-01 | FAIL → **PASS** | AD-001 documents free-text vehicle_media approach |
| BR-STO-01 | PARTIAL → **PASS** | key_prefix includes category |
| BR-DSP-02 | PARTIAL → **PASS** | New Cars + car-detail + VehicleImageService |
| BR-DSP-04 | PARTIAL → **PASS** | Advisor imageOr + Dealer gallery + Compare |
| FR-006 | PARTIAL → **PASS** | Advisor/Dealer/Compare/New Cars |
| FR-008 | FAIL → **PASS** | make_webp → webp_key |
| FR-010 | FAIL → **PASS** | vehicle_media_versions + rollback API |
| NFR-005 | PARTIAL → **PASS** | vehicle_media_audit + GET trail |
| AC-001 | PARTIAL → **PASS** | /admin/car-images multi-select |
| AC-003 | PARTIAL → **PASS** | inspect + EXIF store |
| AC-004 | FAIL → **PASS** | Inspect → grid → upload |
| AC-009 | PARTIAL → **PASS** | Thumb + WebP |
| UX-001 | FAIL → **PASS** | PDF accept=.pdf; separate Car Images nav |

### Confirmed P0 closures
- `/admin/car-images` UI + nav **Car Images**
- PDF File Ingestion `accept=".pdf"` — no more image → “File is not a PDF” trap
- Pre-save inspect → metadata → upload (AC-004)
- AI Advisor + Dealer wired to `vehicle_media`
- Category storage path, EXIF, WebP, 100MB limit, version history, audit log

---

## Remaining gaps (not all fixed)

### P1
1. **NFR-001** — BRD says 15GB; product is **100MB** (chunked upload or BRD revision)
2. **AC-006 / BR-DSP-01/03** — Manufacturer + Variant dedicated DAM surfaces incomplete
3. **FR-003** — Inspect hints shown as badges but **not auto-applied** into form
4. **TC-IMG-021b** — Dealer gallery hardcodes `http://localhost:8000` (breaks prod)
5. Merge Claude tip WAVE 3 ML carefully onto master (CLIP/OCR/safety) without losing #28 PDF polling fixes

### P2
1. Semantic search “White Nexon Front View” (CLIP) — tip `633f885` only
2. OCR / NSFW / plate **blur** / quality validation
3. **NFR-002** automated ≤10s SLA test
4. Stronger EXIF→form prefill; per-file category on batch upload
5. CDN defaulting in all envs

---

## Requirements matrix

| ID | Area | Priority | Requirement | Prior | Now | Gap |
|----|------|----------|-------------|-------|-----|-----|
| BR-001 | Upload | Must Have | Multi upload JPG/JPEG/PNG/WEBP/HEIC/TIFF; max up to 15GB | PARTIAL | **PARTIAL** | Not 15GB; no chunked/resumable |
| BR-002 | Metadata | Must Have | Mandatory make/model/year/body/fuel/transmission/category | PARTIAL | **PASS** | — |
| BR-003 | Categories | Must Have | Full ImageCategory vocabulary | PASS | **PASS** | — |
| BR-004 | AI Extract | Must Have | Filename/EXIF extract; admin editable before save | PARTIAL | **PASS** | EXIF not auto-applied into form fields |
| BR-005 | Storage Meta | Must Have | Rich metadata incl. OCR/embedding/SEO | PARTIAL | **PARTIAL** | OCR+embeddings on claude tip only, not master |
| BR-DB-01 | Database | Must Have | Manufacturers/Models/Variants/CarImages tables | FAIL | **PASS** | No FK hierarchy (accepted by design) |
| BR-STO-01 | Storage | Must Have | Path /car-images/{make}/{model}/{year}/{category}/ | PARTIAL | **PASS** | — |
| BR-DSP-01 | Display | Must Have | Manufacturer page DAM display | PARTIAL | **PARTIAL** | Dedicated manufacturer gallery incomplete |
| BR-DSP-02 | Display | Must Have | Model page DAM display | PARTIAL | **PASS** | — |
| BR-DSP-03 | Display | Must Have | Variant page DAM display | PARTIAL | **PARTIAL** | No dedicated variant page surface |
| BR-DSP-04 | Display | Must Have | Search/AI Advisor/Compare/Dealer reuse same asset | PARTIAL | **PASS** | Dealer fetch hardcodes localhost:8000 |
| BR-SRCH-01 | Search | Should Have | Smart search incl. White Nexon Front View | PARTIAL | **PARTIAL** | CLIP semantic NL search tip-only |
| BR-AI-01 | AI Features | Should Have | Auto-tag, dedupe, compress, thumb, SEO, OCR, moderation… | PARTIAL | **PARTIAL** | OCR/NSFW/plate blur tip-only or missing |
| FR-001 | Functional | Must Have | Admin multi-image upload | PASS | **PASS** | — |
| FR-002 | Functional | Must Have | Mandatory metadata validation | PASS | **PASS** | — |
| FR-003 | Functional | Must Have | AI auto-populates metadata | PARTIAL | **PARTIAL** | Hints not auto-applied into form signals |
| FR-004 | Functional | Must Have | Admin override AI values | PASS | **PASS** | — |
| FR-005 | Functional | Must Have | Images stored once | PASS | **PASS** | — |
| FR-006 | Functional | Must Have | Reuse across surfaces | PARTIAL | **PASS** | Manufacturer/variant pages thin |
| FR-007 | Functional | Must Have | Thumbnail generation | PASS | **PASS** | — |
| FR-008 | Functional | Should Have | Automatic WebP conversion | FAIL | **PASS** | — |
| FR-009 | Functional | Must Have | Duplicate detection | PASS | **PASS** | — |
| FR-010 | Functional | Should Have | Version history | FAIL | **PASS** | — |
| NFR-001 | NFR | Must Have | Uploads up to 15 GB | FAIL | **PARTIAL** | Revise BRD or add chunked upload |
| NFR-002 | NFR | Must Have | Upload ≤10s for standard images | FAIL | **PARTIAL** | No automated p95 SLA test |
| NFR-003 | NFR | Must Have | CDN integration | PARTIAL | **PARTIAL** | Often local /media in dev |
| NFR-004 | NFR | Must Have | RBAC admin upload | PASS | **PASS** | — |
| NFR-005 | NFR | Should Have | Audit logging | PARTIAL | **PASS** | — |
| AC-001 | Acceptance | Must Have | Admin upload one/multiple car images | PARTIAL | **PASS** | — |
| AC-002 | Acceptance | Must Have | Mandatory fields validated | PASS | **PASS** | — |
| AC-003 | Acceptance | Must Have | AI extracts from filename/image meta | PARTIAL | **PASS** | — |
| AC-004 | Acceptance | Must Have | Review/modify AI metadata before save | FAIL | **PASS** | Batch shared metadata (not per-file category) |
| AC-005 | Acceptance | Must Have | Stored once linked by metadata | PASS | **PASS** | — |
| AC-006 | Acceptance | Must Have | Appear on Manufacturer/Model/Variant pages | PARTIAL | **PARTIAL** | Manufacturer + variant pages incomplete |
| AC-007 | Acceptance | Must Have | Search by metadata filters | PARTIAL | **PARTIAL** | NL semantic search tip-only |
| AC-008 | Acceptance | Must Have | Duplicate flagged | PASS | **PASS** | — |
| AC-009 | Acceptance | Must Have | Thumbs + optimized formats | PARTIAL | **PASS** | — |
| AC-010 | Acceptance | Should Have | SEO/AI search/analytics metadata | PARTIAL | **PARTIAL** | Embeddings tip-only |
| UX-001 | UX Bug | Must Have | File Ingestion must not trap car images as PDF | FAIL | **PASS** | — |

---

## Non-PASS tests

| ID | Status | Severity | Detail |
|----|--------|----------|--------|
| TC-IMG-010 | PARTIAL | P1 | Default max upload 100MB (not 15GB) — 100MB; 15GB not implemented |
| TC-IMG-021b | FAIL | P1 | Dealer gallery uses environment.apiUrl — Hardcoded http://localhost:8000 |
| TC-IMG-033 | PARTIAL | P1 | Manufacturer page DAM gallery — No dedicated manufacturer gallery |
| TC-IMG-034 | PARTIAL | P1 | Variant page DAM gallery — No dedicated variant page |
| TC-IMG-016 | FAIL | P2 | OCR on car image (master) — Tip-only WAVE 3 ML |
| TC-IMG-017 | FAIL | P2 | Embedding semantic search (master) — Tip-only CLIP /search |
| TC-IMG-035 | FAIL | P2 | NSFW/plate blur pipeline (master) — Tip detects; blur not done; not on master |
| TC-IMG-036 | PARTIAL | P1 | Inspect hints auto-apply into form — Badges only |
| TC-IMG-023 | FAIL | P2 | 5MB upload p95 ≤10s automated — No SLA pytest; docs claim ~3s |

---

Claude remaining-gap prompt: `Claude_Fix_Prompts_Car_Image_Retest.md`  
Excel: `GAADIIQ_Car_Image_BRD_Retest.xlsx`
