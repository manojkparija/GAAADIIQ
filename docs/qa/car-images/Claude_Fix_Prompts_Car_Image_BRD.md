# Claude Code Fix Prompts — Car Image Asset Management BRD

**BRD readiness:** 55/100 · Tip: `claude/gaadiiq-app-dev-abj5fo @ 0b0bb10`  
**Source:** `docs/qa/car-images/Car_Image_BRD_QA_Summary.md` + uploaded BRD

---

## MASTER PROMPT (paste into Claude Code)

```
# ROLE
Implement GAADIIQ Car Image Asset Management BRD gaps on tip that already has
POST /media-admin/* and vehicle_media (do not rebuild from scratch).

# READ
docs/qa/car-images/BRD_Car_Image_Asset_Management.txt
docs/qa/car-images/Car_Image_BRD_QA_Summary.md
docs/qa/car-images/Claude_Fix_Prompts_Car_Image_BRD.md

# KEEP WORKING
- POST /media-admin/inspect, /upload, PATCH /media-admin/{id}
- vehicle_media + ImageCategory enum + filename_metadata
- sha256/phash dedupe, thumbnails, GET /brochures/images
- test_media_admin.py / test_filename_metadata.py
- PDF brochure pipeline POST /brochures/upload (PDF-only) — keep for brochures

# DO NOT BREAK
PDF ingestion for real PDFs, media dedupe, admin auth (get_admin_user),
New Cars/Compare VehicleImageService wiring.

# WAVE 1 — P0 (ship first)

## 1) UX-001 + TC-IMG-013 — Stop "File is not a PDF" trap for car images
Option A (preferred): New Angular route `/admin/car-images` (Car Image Management)
  - Multi-file picker accept image/* (+ heic/tiff)
  - Call POST /media-admin/inspect → editable metadata grid → POST /media-admin/upload
  - Fields: manufacturer, model, variant?, year, body/category, fuel, transmission,
    image_category, colour?, primary flag
  - Nav: Admin → Car Image Management (keep File Ingestion for PDFs)
Option B (minimum): On /admin/pdf-ingestion, if file is image, route to /media-admin/upload
  with required metadata modal; if not PDF and not image, clear client error.
Also: change accept + help text so PDF page does NOT claim "all file types / images"
unless Option B is fully wired.

## 2) AC-004 — Pre-save review
Inspect → edit AI suggestions → confirm upload. Do not save until admin confirms.

## 3) BR-DSP-04 — Wire AI Advisor (and Dealer if in scope) to VehicleImageService /
   GET /brochures/images so recommendations show DAM assets, not placeholders.

# WAVE 2 — P1
- BR-STO-01: storage key car-images/{make}/{model}/{year}/{category}/{hash}.ext
- BR-004: populate EXIF into vehicle_media.exif; merge into inspect suggestions
- FR-008 / AC-009: convert delivery derivative to WebP (keep original)
- NFR-001: document real max; implement chunked/resumable if 15GB still required
  (or officially revise BRD to e.g. 100MB with MEDIA_MAX_UPLOAD_MB)
- BR-DB-01: either introduce manufacturers/models/variants FKs OR document that
  vehicle_media free-text + cars table is the accepted model (update BRD)
- TC-IMG-021: Dealer dashboard shared media

# WAVE 3 — P2
- FR-010 version history
- Image embeddings + semantic search ("White Nexon Front View")
- OCR on brochure images already in PDF path — optional link to media
- NSFW/plate blur hooks (stub OK)
- NFR-002: perf test for 5MB upload p95≤10s (informational CI)
- Audit log table for media upload/patch/delete

# TESTS
Extend apps/api/tests/test_media_admin.py for category path, EXIF (mocked), WebP.
Add Angular e2e/smoke for /admin/car-images happy path (mock API).
Keep brochure PDF upload test: non-PDF still rejected on /brochures/upload.

# ACCEPTANCE
- Admin can upload 3 JPGs via Car Image UI with metadata → appears in GET images
- Uploading JPG on PDF-only page does not show confusing success path; either
  redirected to car-images or clear client validation
- AI Advisor shows library image when available
- pytest media suites green
```

---

## Compact Wave 1 only

```
Implement Wave 1 from docs/qa/car-images/Claude_Fix_Prompts_Car_Image_BRD.md:
(1) /admin/car-images UI → /media-admin inspect+upload
(2) Fix File Ingestion accept/copy so images aren't sent to PDF endpoint
(3) Wire AI Advisor to shared vehicle_media images.
Keep PDF brochure upload working. Add tests.
```

---

## Single-issue: File is not a PDF

```
Bug: Admin File Ingestion UI accepts images but POST /brochures/upload returns
"File is not a PDF". BRD is Car Image DAM (BR-001), not brochures.

Fix: Add /admin/car-images using /media-admin/* OR client-route images to
media-admin with metadata. Update accept= and help text on PDF page.
Do not weaken PDF magic-byte check on /brochures/upload.
```
