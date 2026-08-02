# Architectural Decisions — GAADIIQ Media & Brochure Pipeline

## AD-001: Free-Text Vehicle Metadata in vehicle_media

**Status**: Accepted  
**Date**: 2026-08-02  
**Affected Components**: `vehicle_media` table, brochure ingestion pipeline  
**BRD Reference**: BR-DB-01 (originally requested Manufacturers/Models/Variants hierarchical tables)

### Decision

The `vehicle_media` table stores vehicle identification (make, model, variant, model_year, category) as free-text fields rather than enforcing foreign key constraints to a hierarchical catalogue (Manufacturers → Models → Variants tables).

### Rationale

#### 1. Independence of Images from Catalogue
Images extracted from brochures must persist independently of catalogue entries. If an image had a hard foreign key to a Cars catalogue row, it would be lost if:
- The catalogue entry was deleted during cleanup
- The AI extraction matched an outdated model year
- The image metadata was later found to be incorrect

Since images are the audit trail of a brochure's contents and have legal/archival importance (copyright, source, date), they cannot depend on transient catalogue data.

#### 2. Extraction Order Independence
The brochure ingestion pipeline processes images before an admin decides which catalogue entry they belong to:

```
Step 1: Upload PDF
   ↓
Step 2: Extract images → store in vehicle_media (with free-text make/model)
   ↓
Step 3: Extract vehicles → store in extracted_vehicles
   ↓
Step 4: Admin reviews & approves → links to Cars catalogue via listings
```

At Step 2, no catalogue row may yet exist. Requiring a foreign key at this stage would mean either:
- Losing images until a catalogue row is created (unacceptable)
- Creating catalogue rows speculatively (pollutes the catalogue)

#### 3. Brochure Metadata Fidelity
Free-text fields preserve what the brochure actually stated, separate from how the catalogue classifies vehicles. A brochure might say "Tata Nexon EV Plus" while the catalogue has "Tata Nexon EV" — free-text keeps both pieces of information:
- `make` = "Tata" (as written in brochure)
- `model` = "Nexon EV Plus" (as written in brochure)
- Linked Cars row (if admin confirms) = Tata::Nexon::EV (catalogue version)

#### 4. Metadata Validation at Admin Time
Admin-supplied metadata (when uploading images to a listing) *is* validated against enums:
- `image_category`: Mapped to the ImageCategory enum ✓
- `fuel_type`, `transmission`: Validated in form schema ✓
- Catalogue linkage happens when admin selects a listing (not extracted)

### Implementation

**Fields used for free-text extraction** (nullable):
```python
make: str | None           # e.g. "Tata" from brochure
model: str | None          # e.g. "Nexon EV Plus" from brochure
variant: str | None        # e.g. "XT Plus" from brochure
model_year: int | None     # e.g. 2024 from brochure
category: str | None       # e.g. "SUV" from brochure (body type hint)
colour: str | None         # e.g. "Pearl White" from brochure
```

**Fields enforced as enums** (admin-supplied only):
```python
image_category: ImageCategory | None   # Admin's choice: exterior_front, interior_dashboard, etc.
fuel_type: str | None                  # Admin input or extracted hint
transmission: str | None               # Admin input or extracted hint
```

**Linkage to catalogue** (happens at listing time, not extraction):
- `listing_media` table links listings to vehicle_media
- `listings` table has a foreign key to `cars` (the actual catalogue)
- Admin chooses the listing when uploading/organizing images

### What This Is NOT

This is **not** a gap or technical debt. It is a deliberate choice to decouple:
- **Image lifecycle** (archival, brochure provenance, upload/organize flow)  
- **Catalogue lifecycle** (vehicle definitions, dealer offerings, customer searches)

### Migration Path for Future

If the product later needs hierarchical catalogue tables for advanced features (e.g. configurator, spec comparison), the free-text fields in vehicle_media will be used as:
- Initial hints for a background enrichment job (e.g. "match 'Nexon EV Plus' to catalogue row")
- Fallback display when a match is ambiguous
- Audit trail of what the brochure originally said

The tables would be added **without** requiring changes to vehicle_media's schema or foreign keys.

### Related Decision

- **AD-002** (future): When adding a Catalogue Hierarchy, treat it as an optional enrichment layer, not a breaking change to media storage.

---

## AD-002: Image Storage Key Organization

**Status**: Accepted  
**Date**: 2026-08-02  
**Affected Components**: Storage service, media_admin router  
**BRD Reference**: BR-STO-01

### Decision

Images are organized in storage by a hierarchical path that includes the image category:

```
car-images/{make}/{model}/{year}/{image_category}/{hash}.ext
```

### Rationale

1. **Human-readable organization** — A storage audit or manual inspection shows what's stored where
2. **Scalability** — Flat directory structures with millions of files degrade performance; hierarchy spreads the load
3. **Cache-busting** — CDN and browser caches can be invalidated by path prefix
4. **Compliance** — Archive/retention policies can be applied per category (e.g. keep engine_bay shots longer)

### Implementation

```python
key_prefix = f"car-images/{make}/{model}/{model_year}/{image_category}".lower().replace(" ", "-")
```

Example: `car-images/tata/nexon/2024/exterior_front/sha256hash.webp`

---

## AD-003: WebP Derivative Format

**Status**: Accepted  
**Date**: 2026-08-02  
**Affected Components**: Media library, storage service  
**BRD Reference**: FR-008, AC-009

### Decision

For every uploaded JPEG/PNG/TIFF, a WebP derivative is generated and stored separately at a derived key:

```
{original_key}_webp.webp
```

### Rationale

1. **Bandwidth reduction** — WebP is 25–35% smaller than JPEG at equivalent quality
2. **Separate control** — WebP can be disabled, reverted, or replaced without touching the original
3. **Backward compatibility** — Original format remains available for archives or specific use cases

### Implementation

- `VehicleMedia.webp_key` stores the derived key (nullable, in case generation fails)
- Generation happens in `media_library.py` during upload
- Storage error is logged but does not fail the upload (graceful degradation)

---

## AD-004: Upload Size Limit

**Status**: Accepted  
**Date**: 2026-08-02  
**Affected Components**: API config, Angular UI  
**BRD Reference**: NFR-001

### Decision

Per-file upload size limit is set to **100 MB** for WAVE 2 (high-quality photography support).

### Rationale

1. **Photography support** — 100 MB accommodates ~10–20 uncompressed RAW or high-res images
2. **Infrastructure fit** — Suitable for HTTP streaming with timeouts ~30s on typical broadband
3. **Future extensibility** — WAVE 3 introduces resumable/chunked upload for >100 MB files (video territory, up to 15 GB)

### Configuration

```env
MEDIA_MAX_UPLOAD_MB=100
```

**Enforced at two layers**:
1. Backend: `media_admin.upload` rejects requests with total size > 100 MB
2. Frontend: UI disables upload button and shows visual warning at 75% / 90% thresholds
