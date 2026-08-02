# Claude Code Fix Prompts — Car Image BRD Remaining Gaps (Retest)

**Score now:** 83/100 (was 55) · Tip: `origin/master @ 15518ac (WAVE 2 complete + WAVE 3 partial)`  
**Source:** `docs/qa/car-images/Car_Image_BRD_Retest_Summary.md`

---

## DO NOT RE-IMPLEMENT (confirmed PASS)

```
KEEP WORKING — already merged on master:
- /admin/car-images UI + nav Car Images
- PDF File Ingestion accept=.pdf only (no image trap)
- /media-admin inspect → edit → upload, PATCH
- Category storage path, EXIF store, WebP, thumbs, dedupe
- AI Advisor VehicleImageService + Dealer gallery endpoint
- vehicle_media_versions + vehicle_media_audit
- media_max_upload_mb=100 + 413
- AD-001 free-text metadata decision
- pytest media suites green (70 passed in retest)

DO NOT BREAK these.
```

---

## MASTER PROMPT — Remaining gaps only

```
# ROLE
Close remaining Car Image Asset Management BRD gaps after WAVE 1–2 merge.
Work on current master (15518ac+). Do not rebuild Car Images UI or PDF accept fix.

# READ
docs/qa/car-images/Car_Image_BRD_Retest_Summary.md
docs/IMPLEMENTATION_STATUS.md
docs/ARCHITECTURAL_DECISIONS.md

# WAVE R1 — P1 production polish (do first)

## R1.1 TC-IMG-021b — Dealer gallery API URL
File: apps/gaadiiq-angular/src/app/services/vehicle-image-gallery.service.ts
Replace hardcoded `http://localhost:8000/media-admin/dealer-images` with
`environment.apiUrl` (+ auth header via interceptor or fetch with session token).
Add a unit/smoke test or at least ensure prod Render URL is used.

## R1.2 FR-003 — Auto-apply inspect hints
On successful POST /media-admin/inspect, if form fields empty, apply suggested
make/model/year/category/colour into form signals (admin can still edit).
Prefer per-file suggestions when batch size=1; for multi-file keep shared defaults
but show per-file hint chips.

## R1.3 AC-006 / BR-DSP-01 / BR-DSP-03 — Manufacturer & Variant surfaces
- Manufacturer view: when user filters/opens a make, show DAM images for that make
  (reuse GET /brochures/images?make= or media-admin list).
- Variant: when variant selected on detail/compare, prefer variant-tagged images,
  fallback to model-level.
Do not invent new DB hierarchy (AD-001 stands).

## R1.4 NFR-001 — 15GB vs 100MB decision
Either:
A) Officially revise BRD/docs: max 100MB images; 15GB only if/when video/chunked ships, OR
B) Implement resumable/chunked upload (TUS or multipart) with MEDIA_MAX_UPLOAD_MB raise.
Update IMPLEMENTATION_STATUS with the chosen decision. Prefer A unless product insists on B.

# WAVE R2 — P2 WAVE 3 ML (merge carefully)
Claude tip 633f885 has CLIP search, OCR, NSFW/plate detection — NOT on master.
If merging:
- Rebase onto master; DO NOT drop finished-job polling fixes from PDF ingestion (#28).
- Wire GET /media-admin/search for "White Nexon Front View"
- Store OCR text + embedding on vehicle_media
- NSFW/plate: detect is OK; add configurable blur ONLY if safe/performant
- Keep feature flags so environments without models still upload

# WAVE R3 — P2 quality
- NFR-002: add informational pytest/bench for 5MB upload latency (mock storage OK)
- Per-file image_category on multi-upload
- EXIF make/model → form prefill when filename parse empty
- Strengthen tests asserting storage key contains /{category}/ and webp_key set

# ACCEPTANCE
- Dealer gallery works against deployed apiUrl (not localhost)
- Inspect of Tata_Nexon_FearlessPlus_Front_2025.webp prefills form when empty
- Manufacturer/model/variant image resolution documented + visible on at least one UI path each
- NFR-001 decision recorded in docs
- Existing media pytest suites stay green
```

---

## Compact P1 only

```
On master after Car Image WAVE 1–2 merge, fix ONLY:
1) vehicle-image-gallery.service.ts use environment.apiUrl not localhost:8000
2) Auto-apply /media-admin/inspect hints into empty form fields
3) Manufacturer + variant DAM image display paths (free-text filters)
4) Document NFR-001 as 100MB (or implement chunked 15GB)
Keep Car Images UI, PDF accept, WebP, EXIF, versions, audit. Add/adjust tests.
```
