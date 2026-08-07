# GAADIIQ Database Schema Setup Instructions

> **⚠️ Superseded for `cars` and `listings`.** Batch 1's definitions of those
> two tables disagree with the application's models — different column names
> (`price_inr` vs `price`, `mileage` vs `km_driven`, `year` vs
> `registration_year`, `location` vs `city`, `views` vs `views_count`), missing
> columns, and a `bigserial` key where the application uses `uuid`. Both this
> guide and Alembic create tables only if they are absent, so whichever ran
> first won silently. In the deployed database this guide won, and every
> listing read failed with `column listings.price does not exist` — emptying
> Used Cars, and New Cars with it — until migration `0017` repaired it.
>
> `apps/api/alembic` is the schema of record. It runs automatically whenever
> the API starts, so `cars` and `listings` need no manual step. Skip those
> sections of Batch 1.

## Overview

This guide walks you through setting up the complete GAADIIQ database schema in Supabase. The schema has been split into 5 executable batches to ensure proper dependency management and clear troubleshooting.

**Current Status**: Users table already exists ✓

## Prerequisites

- Access to your Supabase SQL Editor
- All 5 SQL batch files are ready to execute
- No active transactions or locks on the database

## Execution Order

Execute these batches **in sequence**, waiting for each to complete successfully before proceeding to the next.

### Batch 1: Enum Types & Core Tables
**File**: `schema_setup_batch1_enums_and_core.sql`
**Duration**: ~30 seconds
**Creates**:
- 4 enum types (ingestion_status, media_kind, media_view, image_category)
- cars table (3 indexes)
- dealers table (2 indexes)
- listings table (6 indexes)
- refresh_tokens table (2 indexes)

**Dependencies**: 
- users table (already created ✓)

**Copy & Execute**:
1. Open Supabase SQL Editor
2. Copy entire contents of `schema_setup_batch1_enums_and_core.sql`
3. Paste into SQL Editor
4. Click "Run" and wait for "Success. No rows returned"

---

### Batch 2: Feature Tables
**File**: `schema_setup_batch2_feature_tables.sql`
**Duration**: ~20 seconds
**Creates**:
- notifications table (4 indexes)
- test_drive_bookings table (4 indexes)
- loan_inquiries table (3 indexes)
- price_alerts table (3 indexes + 1 unique constraint)
- reviews table (4 indexes + 1 unique constraint)
- payments table (4 indexes)
- subscriptions table (3 indexes)

**Dependencies**: 
- users table ✓
- listings table (from Batch 1)

**Copy & Execute**:
1. Open Supabase SQL Editor
2. Copy entire contents of `schema_setup_batch2_feature_tables.sql`
3. Paste into SQL Editor
4. Click "Run" and wait for "Success. No rows returned"

---

### Batch 3: Brochure Ingestion (CRITICAL FOR PDF UPLOAD)
**File**: `schema_setup_batch3_brochure_ingestion.sql`
**Duration**: ~15 seconds
**Creates**:
- pdf_ingestion_jobs table (3 indexes) - tracks uploaded brochures
- extracted_vehicles table (3 indexes) - AI-extracted vehicle data
- vehicle_media table (14 indexes) - extracted images with full metadata
- listing_media table (2 indexes) - association table for listings ↔ images

**This batch enables the PDF upload feature!**

**Dependencies**: 
- users table ✓
- listings table (from Batch 1)

**Copy & Execute**:
1. Open Supabase SQL Editor
2. Copy entire contents of `schema_setup_batch3_brochure_ingestion.sql`
3. Paste into SQL Editor
4. Click "Run" and wait for "Success. No rows returned"

---

### Batch 4: Analytics & Diagnosis Tables
**File**: `schema_setup_batch4_analytics.sql`
**Duration**: ~20 seconds
**Creates**:
- customer_activities table (4 indexes) - user behavior tracking
- customer_intent_scores table (4 indexes) - lead grading
- vehicle_diagnoses table (3 indexes) - AI vehicle analysis
- diagnosis_conversations table (2 indexes) - multi-turn diagnosis chat
- voice_transcripts table (2 indexes) - speech-to-text results
- diagnosis_audit_events table (3 indexes) - audit trail

**Dependencies**: 
- users table ✓
- listings table (from Batch 1)
- cars table (from Batch 1)

**Copy & Execute**:
1. Open Supabase SQL Editor
2. Copy entire contents of `schema_setup_batch4_analytics.sql`
3. Paste into SQL Editor
4. Click "Run" and wait for "Success. No rows returned"

---

### Batch 5: Final Constraints & Verification
**File**: `schema_setup_batch5_constraints_and_final.sql`
**Duration**: ~10 seconds
**Adds**:
- Remaining unique constraints (4 constraints)
- Missing foreign key indexes (5 indexes)
- Verification query templates

**Dependencies**: 
- All previous batches must be complete

**Copy & Execute**:
1. Open Supabase SQL Editor
2. Copy entire contents of `schema_setup_batch5_constraints_and_final.sql`
3. Paste into SQL Editor
4. Click "Run" and wait for "Success. No rows returned"

---

## Verification Steps

After all batches complete, run these verification queries:

### 1. Verify All Tables Exist
```sql
SELECT COUNT(*) as table_count
FROM information_schema.tables
WHERE table_schema='public';
-- Expected: 22 tables
```

### 2. Verify All Enum Types
```sql
SELECT COUNT(*) as enum_count
FROM pg_type
WHERE typkind='e';
-- Expected: 17+ enums (including pre-existing ones)
```

### 3. Verify Core Tables
```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema='public'
AND table_name IN (
    'users', 'cars', 'dealers', 'listings',
    'pdf_ingestion_jobs', 'vehicle_media', 'extracted_vehicles', 'listing_media'
)
ORDER BY table_name;
-- Expected: 8 tables
```

### 4. Verify Critical Indexes
```sql
SELECT COUNT(*) as index_count
FROM pg_indexes
WHERE schemaname='public';
-- Expected: 80+ indexes
```

### 5. Verify Unique Constraints
```sql
SELECT COUNT(*) as constraint_count
FROM information_schema.table_constraints
WHERE table_schema='public'
AND constraint_type='UNIQUE';
-- Expected: 5+ unique constraints
```

---

## Troubleshooting

### Error: "type ingestion_status already exists"
**Solution**: This is expected if Batch 1 partially executed. Simply re-run the batch - all statements use `IF NOT EXISTS` to prevent duplicates.

### Error: "relation 'listings' does not exist"
**Solution**: Batch 2, 3, 4 depend on Batch 1 completing first. Ensure Batch 1 succeeded before running subsequent batches.

### Error: "constraint 'uq_' already exists"
**Solution**: Batch 5 won't re-add existing constraints. This means the constraint already exists, which is fine.

### Error: "references undefined table"
**Solution**: A referenced table wasn't created. Check that all previous batches executed successfully.

### Error: "column of type uuid does not exist"
**Solution**: This shouldn't happen with these scripts. If it does, verify the users table exists:
```sql
SELECT COUNT(*) FROM users;
```

---

## Success Criteria

After completing all 5 batches, you should have:

✓ 22 database tables
✓ 80+ indexes for query performance
✓ 4 enum types for brochure ingestion (ingestion_status, media_kind, media_view, image_category)
✓ Complete PDF upload pipeline:
  - pdf_ingestion_jobs (brochure tracking)
  - extracted_vehicles (AI extraction results)
  - vehicle_media (image metadata)
  - listing_media (image-to-listing associations)
✓ Complete diagnostic system:
  - vehicle_diagnoses (AI analysis)
  - diagnosis_conversations (chat history)
  - voice_transcripts (speech-to-text)
  - diagnosis_audit_events (audit trail)
✓ Analytics & customer intent scoring
✓ All unique constraints for data integrity
✓ All foreign key indexes for query performance

---

## Next Steps After Schema Setup

1. **Test PDF Upload Feature**:
   ```bash
   # Start the API with OLLAMA_VISION fallback
   OLLAMA_VISION=true python -m uvicorn apps/api/main.py
   ```

2. **Run Migration Scripts** (if any):
   ```bash
   cd apps/api
   alembic upgrade head
   ```

3. **Execute Integration Tests**:
   ```bash
   pytest apps/api/tests/test_brochure_upload.py -v
   ```

4. **Monitor Database**:
   - Watch `pdf_ingestion_jobs` table during upload
   - Check `vehicle_media` for extracted images
   - Review `extracted_vehicles` for AI results

---

## Schema Diagram (Relationships)

```
users ─┬─> dealers (1:1, unique user_id)
       ├─> listings (1:many, seller_id)
       ├─> pdf_ingestion_jobs (1:many, uploaded_by)
       ├─> vehicle_media (1:many, uploaded_by)
       ├─> test_drive_bookings
       ├─> loan_inquiries
       ├─> price_alerts
       ├─> reviews (as reviewer_id AND seller_id)
       ├─> payments
       ├─> subscriptions (1:1, unique user_id)
       ├─> customer_activities
       ├─> customer_intent_scores (1:1)
       └─> vehicle_diagnoses

cars ──> listings (1:many, car_id)

dealers ──> listings (1:many, dealer_id)

listings ─┬─> test_drive_bookings
          ├─> loan_inquiries
          ├─> price_alerts
          ├─> reviews
          ├─> payments
          ├─> notifications
          └─> listing_media ──> vehicle_media

pdf_ingestion_jobs ──┬─> vehicle_media (1:many, job_id CASCADE)
                     └─> extracted_vehicles (1:many, job_id CASCADE)

extracted_vehicles ──> vehicle_media (1:many, extracted_vehicle_id SET NULL)
```

---

## Support

If you encounter issues:

1. Check Supabase status at https://status.supabase.com
2. Verify no active queries are locking tables
3. Try re-running the failed batch (idempotent - won't cause duplicates)
4. Check SQL Editor logs for specific error messages
5. Review constraint violations - they indicate FK issues

---

**Schema Setup Ready!** 🚀

All 5 batches are prepared and ready to execute. Follow the instructions above to build out your complete production database schema.
