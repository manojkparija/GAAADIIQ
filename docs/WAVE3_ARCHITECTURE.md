# WAVE 3 Architecture: Advanced Media Management

## Overview
WAVE 3 adds intelligent image understanding, versioning, and observability. Priority: reduce manual metadata entry and improve discovery.

## Task #10: Embeddings & Semantic Search

### Goal
Enable dealers to find images by semantic meaning ("red car exterior shots") without exact metadata matching.

### Design Decision: Vector Database Strategy

**Choice:** Supabase pgvector extension + PostgreSQL native vector ops
**Rationale:**
- pgvector is battle-tested for image embeddings at scale
- Keeps data in existing PostgreSQL (no new infrastructure)
- Native SQL `<=>` operator for cosine distance queries
- Seamless integration with SQLAlchemy ORM via `sqlalchemy-json`

### Implementation Phases

#### Phase 1: Vector Extraction (Week 1)
- **Model:** CLIP (OpenAI's Contrastive Language–Image Pre-training)
  - Text-to-image alignment enables semantic queries: "show me luxury sedans"
  - Smaller variant (ViT-B/32) runs locally in 2-4GB VRAM
  - 512-dim embeddings (compact, fast, standard)
  
- **Where:** Process during upload, store in `vehicle_media.embedding_vector`
- **Async:** Non-blocking; store image first, queue embedding job

#### Phase 2: Query Interface (Week 2)
- **Endpoint:** `GET /brochures/search?q=exterior+red+car&limit=10`
- **Response:** Images ranked by semantic relevance (cosine distance)
- **Filters:** Still support exact matches on category, make, model

#### Phase 3: Gallery UX (Week 3)
- Add search bar to dealer dashboard gallery
- Real-time suggestions as user types
- Visual badges showing match confidence (e.g., "96% match")

### Database Schema Changes

```sql
ALTER TABLE vehicle_media ADD COLUMN embedding_vector vector(512);
CREATE INDEX ON vehicle_media USING ivfflat (embedding_vector vector_cosine_ops);
```

**Migration:** Backfill existing images with embeddings (async job).

### Cost & Performance

| Operation | Latency | Cost |
|-----------|---------|------|
| Embedding (CLIP) | ~200ms/image | Free (local) |
| Semantic search (pgvector) | ~50ms (index) | Negligible |
| Text query encoding | ~30ms | Free (local) |

**Scaling:** 100K images × 512 dims = ~200MB vector storage (acceptable in PostgreSQL).

---

## Task #11: Version History

### Goal
Preserve image edits (metadata, crops) and enable rollback.

### Design: Immutable Events Log

**Choice:** New `vehicle_media_versions` table (event-sourced)
**Rationale:**
- Audit trail for compliance (licensing, copyright changes)
- Restore old metadata without re-uploading
- Track who changed what and when

### Schema

```sql
CREATE TABLE vehicle_media_versions (
    id BIGINT PRIMARY KEY,
    media_id UUID NOT NULL REFERENCES vehicle_media(id),
    event_type ENUM('created', 'metadata_updated', 'cropped', 'deleted') NOT NULL,
    actor_id UUID REFERENCES auth.users(id),
    old_value JSONB,  -- Pre-change state
    new_value JSONB,  -- Post-change state
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

**Immutability:** Versions are append-only; no deletes except full table drop (admin audit).

### Dealer UX

- **Timeline:** Show "edited X times" on image card; click to view history
- **Rollback:** "Restore to version 3" button (re-applies old metadata)
- **Diff:** Highlight what changed between versions

---

## Task #12: OCR on Brochure Images

### Goal
Extract text (year, model, features) from uploaded brochures for auto-population.

### Strategy: Tesseract + Layout Analysis

**Tool:** Tesseract 5 (open-source, SOTA for structured PDFs)
**When:** Process brochures (uploaded via /admin/pdf-ingestion) to extract vehicle specs

### Input: PDF Pages → Output: Structured Text

1. **Page Layout Segmentation:** Identify tables, callouts (year, price, engine size)
2. **OCR:** Extract text with confidence scores
3. **Entity Extraction:** Parse "2024 Tata Nexon EV | 7.99L | 1.2 Turbo" into fields
4. **Confidence Filtering:** Ignore low-confidence extracts (<70%)

### Async Pipeline

```
PDF upload → Queue OCR job → Extract metadata → Notify dealer
```

---

## Task #13: NSFW & License Plate Detection

### Goal
Automatically flag inappropriate or privacy-sensitive images.

### Approach: Multi-Model Classification

**Models:**
- **NSFW:** Nudity classification (OpenAI CLIP fine-tuned)
- **License Plate:** YOLOv8 (detects plates, doesn't read them)

**When:** Process immediately after upload (synchronously, <100ms).

### API Response

```json
{
  "images": [{
    "id": "...",
    "url": "...",
    "safety": {
      "nsfw_flag": false,
      "nsfw_score": 0.02,
      "license_plate_detected": true,
      "plate_count": 1
    }
  }]
}
```

**Dealer Action:** Flag images with issues for review; auto-blur license plates.

---

## Task #14: Performance & Scalability

### Targets (NFR-002)

| Metric | Target | Current |
|--------|--------|---------|
| Upload (5 MB) | p95 ≤ 10s | ~3s (WAVE 2) |
| Embedding generation | p95 ≤ 5s per image | TBD (async) |
| Semantic search | p95 ≤ 500ms | TBD (pgvector) |
| Gallery load (50 images) | p95 ≤ 2s | ~1.5s (WAVE 2) |

### Optimizations

1. **Async Workers:** Offload embeddings, OCR, safety checks to Celery
2. **CDN Caching:** CloudFront in front of Supabase Storage
3. **Connection Pooling:** Increase pgvector connection pool for concurrent searches
4. **Batch Operations:** Process images in groups of 10

---

## Task #15: Audit Logging

### Goal
Compliance: track all media operations (upload, edit, delete, download).

### Schema

```sql
CREATE TABLE vehicle_media_audit (
    id BIGINT PRIMARY KEY,
    media_id UUID NOT NULL REFERENCES vehicle_media(id),
    action ENUM('upload', 'view', 'edit', 'delete', 'share', 'download') NOT NULL,
    actor_id UUID REFERENCES auth.users(id),
    ip_address INET,
    user_agent TEXT,
    metadata JSONB,  -- Action-specific context
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_media_id ON vehicle_media_audit(media_id);
CREATE INDEX idx_audit_actor_id ON vehicle_media_audit(actor_id);
CREATE INDEX idx_audit_created_at ON vehicle_media_audit(created_at DESC);
```

**Retention:** Keep 2 years minimum (configurable per deployment).

### Dealer Dashboard

- **Audit Tab:** Filter by action, date range, actor
- **Export:** CSV report for compliance reviews
- **Alerts:** Email summaries of high-risk actions (bulk delete, IP anomalies)

---

## Implementation Priority (Weeks 4–12)

| Week | Feature | Owner | Est. Hours |
|------|---------|-------|-----------|
| 4–5 | Embeddings (CLIP + pgvector) | BE | 16 |
| 6 | Vector search UI | FE | 8 |
| 7 | Version history (schema + API) | BE | 12 |
| 8 | Rollback UX | FE | 8 |
| 9–10 | OCR (Tesseract + pipeline) | BE | 20 |
| 11 | Safety detection (NSFW + plates) | BE | 16 |
| 12 | Audit logging + dashboard | BE + FE | 12 |

**Total:** ~92 engineering hours (~2.3 weeks at 40 hrs/week, accounting for reviews & testing).

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| CLIP model requires GPU | Use CPU inference; fallback to mock embeddings in dev |
| OCR accuracy on blurry images | Confidence thresholding; skip low-quality extracts |
| License plate false positives | Manual review queue for borderline cases |
| Audit table disk usage | Automatic partitioning by date; archive >2 years |
| Semantic search latency | Pre-compute common queries; cache top 100 results |

---

## Success Criteria (WAVE 3 Completion)

- [ ] Semantic search returns results within 500ms (p95)
- [ ] 90%+ of brochure PDFs extract at least 3 valid fields
- [ ] NSFW detection has <5% false positive rate
- [ ] Audit log captures 100% of media operations
- [ ] Version rollback works without data loss
- [ ] No regressions in WAVE 1–2 functionality
