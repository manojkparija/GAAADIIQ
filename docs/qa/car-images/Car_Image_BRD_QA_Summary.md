# GAADIIQ — Car Image Asset Management BRD QA

| Field | Value |
|-------|-------|
| Feature | AI-Powered Car Image Upload & Intelligent Asset Management |
| BRD source | `docs/qa/car-images/BRD_Car_Image_Asset_Management.txt` |
| Code tip audited | `claude/gaadiiq-app-dev-abj5fo @ 0b0bb10` |
| Date | 2026-08-02 06:57 UTC |
| BRD readiness | **55/100** |
| Requirements | 11 PASS / 21 PARTIAL / 7 FAIL |
| Test cases | 15 PASS / 2 PARTIAL / 15 FAIL |
| Verdict | **NO-GO** for full BRD · **Conditional** API-only DAM foundation |

---

## Executive finding

Tip implements a **backend media library** (`POST /media-admin/*` + `vehicle_media`) with categories, filename AI inspect, dedupe, and thumbs. There is **no Angular Car Image Admin**. Operators use **File Ingestion** (`/admin/pdf-ingestion`), which calls **PDF-only** `POST /brochures/upload` → **"File is not a PDF"** when uploading car images — matching the live UI failure.

---

## Requirements vs code

| ID | Area | Priority | Requirement | Status | Gap |
|----|------|----------|-------------|--------|-----|
| BR-001 | Upload | Must Have | Multi image upload JPG/JPEG/PNG/WEBP/HEIC/TIFF; configurable max up to 15GB | **PARTIAL** | No Angular UI; no 15GB/chunked path; HEIC/TIFF not browser-converted |
| BR-002 | Metadata | Must Have | Mandatory make/model/year/body/fuel/transmission/category; optional variant/color/primary | **PARTIAL** | No admin metadata form UI; body_type naming differs |
| BR-003 | Categories | Must Have | Full image category vocabulary (exterior/interior/360/etc.) | **PASS** | Videos future — enum has video value |
| BR-004 | AI Extract | Must Have | AI extract from filename/EXIF; admin editable before save | **PARTIAL** | EXIF never populated; no pre-save review UI |
| BR-005 | Storage Meta | Must Have | Rich metadata: hash, thumb, resolution, SEO, embedding, OCR, copyright… | **PARTIAL** | OCR, embedding vector, EXIF fill, AI description generation missing |
| BR-DB-01 | Database | Must Have | Manufacturers / Models / Variants / CarImages relational tables | **FAIL** | No BRD hierarchy tables; design-only in LLD |
| BR-STO-01 | Storage | Must Have | Path /car-images/{make}/{model}/{year}/{category}/; no duplicate bytes | **PARTIAL** | Category folder segment missing |
| BR-DSP-01 | Display | Must Have | Manufacturer page auto-display from single source | **PARTIAL** | No dedicated manufacturer page DAM wiring everywhere |
| BR-DSP-02 | Display | Must Have | Model page auto-display | **PARTIAL** | Incomplete vs all model surfaces |
| BR-DSP-03 | Display | Must Have | Variant page auto-display | **PARTIAL** | Variant-specific surfaces incomplete |
| BR-DSP-04 | Display | Must Have | Search / AI Advisor / Compare / Dealer reuse same asset | **PARTIAL** | Wire Advisor + Dealer to vehicle_media |
| BR-SRCH-01 | Search | Should Have | Smart search: make/model/color/view filters | **PARTIAL** | Semantic 'White Nexon Front View' natural language incomplete |
| BR-AI-01 | AI Features | Should Have | Auto-tag, dedupe, compress, thumb, SEO alt, description, semantic search, OCR, quality, moderation | **PARTIAL** | OCR/embeddings/moderation/blur/quality gates missing |
| FR-001 | Functional | Must Have | Admin multi-image upload | **PASS** | No Angular Car Image Admin UI |
| FR-002 | Functional | Must Have | Mandatory metadata validation before save | **PASS** | UI missing |
| FR-003 | Functional | Must Have | AI auto-populates metadata | **PARTIAL** | EXIF/vision auto-tag missing |
| FR-004 | Functional | Must Have | Admin can override AI values | **PASS** | Pre-save override UI missing |
| FR-005 | Functional | Must Have | Images stored once in cloud | **PASS** | — |
| FR-006 | Functional | Must Have | Same image reused across surfaces | **PARTIAL** | Advisor/Dealer not wired |
| FR-007 | Functional | Must Have | Automatic thumbnail generation | **PASS** | — |
| FR-008 | Functional | Should Have | Automatic WebP conversion | **FAIL** | Add convert-to-WebP pipeline |
| FR-009 | Functional | Must Have | Duplicate detection before save | **PASS** | — |
| FR-010 | Functional | Should Have | Version history for image updates | **FAIL** | Add vehicle_media_versions |
| NFR-001 | NFR | Must Have | Support uploads up to 15 GB | **FAIL** | Resumable/chunked upload |
| NFR-002 | NFR | Must Have | Upload response ≤10s for standard images | **FAIL** | Add perf test + timeout policy |
| NFR-003 | NFR | Must Have | CDN integration | **PARTIAL** | Default local /media paths in many envs |
| NFR-004 | NFR | Must Have | RBAC for admin upload | **PASS** | Dev shortcut localOnly has no token (ops issue) |
| NFR-005 | NFR | Should Have | Audit logging for uploads/modifications | **PARTIAL** | Dedicated audit table incomplete |
| AC-001 | Acceptance | Must Have | Admin can upload one or multiple car images | **PARTIAL** | Build Car Image Admin UI |
| AC-002 | Acceptance | Must Have | Mandatory fields validated before save | **PASS** | Surface validation in UI |
| AC-003 | Acceptance | Must Have | AI extracts metadata from filename/image meta | **PARTIAL** | Populate EXIF + UI prefill |
| AC-004 | Acceptance | Must Have | Admin review/modify AI metadata before save | **FAIL** | Inspect → edit grid → upload flow in UI |
| AC-005 | Acceptance | Must Have | Stored once and linked via metadata | **PASS** | — |
| AC-006 | Acceptance | Must Have | Appear on Manufacturer/Model/Variant without re-upload | **PARTIAL** | Complete all pages |
| AC-007 | Acceptance | Must Have | Search shows correct images by metadata filters | **PARTIAL** | NL semantic search |
| AC-008 | Acceptance | Must Have | Duplicate uploads detected and flagged | **PASS** | — |
| AC-009 | Acceptance | Must Have | Thumbnails and optimized formats auto-generated | **PARTIAL** | WebP conversion |
| AC-010 | Acceptance | Should Have | Metadata supports SEO/AI search/analytics | **PARTIAL** | Embeddings + analytics events |
| UX-001 | UX Bug | Must Have | Admin File Ingestion must not claim image upload if PDF-only | **FAIL** | Separate Car Image Admin OR route images to /media-admin |

---

## Non-PASS test cases

| ID | Status | Severity | Detail |
|----|--------|----------|--------|
| TC-IMG-009 | FAIL | P1 | Storage key includes {category} folder — Key omits category segment |
| TC-IMG-010 | FAIL | P1 | Upload 100MB with default config — Default cap 64MB |
| TC-IMG-011 | PARTIAL | P1 | Configure MEDIA_MAX_UPLOAD_MB raises limit — Config works; not 15GB/chunked |
| TC-IMG-012 | FAIL | P0 | Angular Car Image Admin multi-select + metadata grid — No /media-admin UI; only PDF page |
| TC-IMG-013 | FAIL | P0 | File Ingestion upload JPG as car image — API returns File is not a PDF |
| TC-IMG-015 | FAIL | P1 | EXIF make/model auto-fill — EXIF column never populated |
| TC-IMG-016 | FAIL | P2 | OCR text stored on media row — Not implemented for car images |
| TC-IMG-017 | FAIL | P2 | Image embedding vector for semantic search — Not on vehicle_media |
| TC-IMG-020 | FAIL | P0 | AI Advisor uses shared media library — Still placeholders/car.image |
| TC-IMG-021 | FAIL | P1 | Dealer dashboard uses shared media — Not wired |
| TC-IMG-023 | FAIL | P2 | 5MB image upload p95 ≤10s — No SLA test/monitor |
| TC-IMG-024 | PARTIAL | P2 | CDN public URL when R2 configured — S3Storage public_base |
| TC-IMG-028 | FAIL | P0 | Pre-save AI metadata review grid — No inspect→edit→upload UI |
| TC-IMG-029 | FAIL | P1 | Manufacturers/Models/Variants/CarImages tables exist — Not as BRD specifies |
| TC-IMG-030 | FAIL | P1 | Automatic WebP conversion on store — Not implemented |
| TC-IMG-031 | FAIL | P2 | Image version history on replace — No versions table |
| TC-IMG-032 | FAIL | P1 | Nav label 'Car Image Management' vs File Ingestion only — Navbar only File Ingestion |

---

## P0 gaps
1. Build **Car Image Admin** UI wired to `/media-admin/inspect` + `/upload` + metadata grid (AC-001/004).
2. Fix **File Ingestion** UX: either reject non-PDF client-side OR route images to media-admin; stop advertising image upload on PDF page (UX-001 / TC-IMG-013).
3. Wire **AI Advisor** (and Dealer) to shared `vehicle_media` (BR-DSP-04).

## P1 gaps
Category folder in storage key · 15GB/chunked upload · EXIF fill · WebP conversion · relational Manufacturers/Models/Variants or documented free-text strategy · Dealer dashboard images.

## Artifacts
- Excel: `GAADIIQ_Car_Image_BRD_QA.xlsx`
- Claude prompt: `Claude_Fix_Prompts_Car_Image_BRD.md`
- JSON: `car-image-brd-qa.json`
