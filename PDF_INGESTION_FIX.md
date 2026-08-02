# PDF Brochure Ingestion Fix

## Problem

PDF images are being extracted and displayed on the frontend, but they're not being persisted to the database. The `pdf_ingestion_jobs` and `vehicle_media` tables remain empty after uploads.

## Root Causes

1. **GEMINI_API_KEY not configured** - The `.env` file has the placeholder `your_gemini_api_key_here` instead of your actual API key
2. **media_store directory missing** - Local storage wasn't initialized (fixed)
3. **Possible network timeouts** - Supabase connections from your environment may timeout during database commits

## Solution

### Step 1: Get Your Gemini API Key

If you don't have one already:
1. Go to https://aistudio.google.com/app/apikey
2. Click "Create API Key"
3. Select your project (or create one)
4. Copy the generated API key

### Step 2: Update .env File

Edit `/home/user/GAAADIIQ/apps/api/.env` and replace:
```env
GEMINI_API_KEY=your_gemini_api_key_here
```

With:
```env
GEMINI_API_KEY=AIzaSy_xxxxxxxxxxxxxxxxxxxxx
```
(Replace with your actual key)

### Step 3: Optional - Configure Groq (Free Fallback)

If you want a free alternative to Gemini:
1. Get a free API key from https://console.groq.com
2. Add to `.env`:
```env
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxxx
```

### Step 4: Test the Setup

Run the diagnostic script:
```bash
cd /home/user/GAAADIIQ/apps/api
python test_pdf_upload.py ~/Downloads/DZIRE.pdf
```

This will test:
- ✅ PDF validation
- ✅ Image extraction  
- ✅ Text extraction
- ✅ Local storage
- ✅ Vehicle extraction (with Gemini/Groq)
- ✅ Database connection

### Step 5: Test Upload

Restart the API server:
```bash
cd /home/user/GAAADIIQ/apps/api
python -m uvicorn main:app --reload
```

In another terminal, upload a PDF:
```bash
curl -X POST http://localhost:8000/brochures/upload \
  -F "file=@/path/to/DZIRE.pdf" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

Or use the Swagger UI at: http://localhost:8000/docs

### Step 6: Verify Database

After upload, check the tables:

**Via Supabase SQL Editor:**
```sql
SELECT COUNT(*) FROM pdf_ingestion_jobs;
SELECT COUNT(*) FROM vehicle_media;
SELECT COUNT(*) FROM extracted_vehicles;
```

**Via API:**
```bash
curl http://localhost:8000/brochures/jobs
```

## Troubleshooting

### "Images extracted but nothing in database"

Check API logs during upload for errors:
```bash
# On Windows PowerShell, view most recent API output
Get-Process -Name python | Select-Object Handles,Name,Id
```

The enhanced logging will show:
- `Stored image brochures/... (...bytes) for job ...` (success)
- `StorageError storing image` (storage issue)
- `Unexpected error storing image` (other errors)
- `Job ...: stored=X media_rows=Y vehicles=Z` (summary)

### "StorageError" Messages

If you see "Could not store image":
- Check disk space: `df -h`
- Check permissions on `media_store` directory
- Check if `media_store` directory exists

### "Vehicle extraction failed / no vehicles found"

- GEMINI_API_KEY is invalid or exhausted quota
- Try adding GROQ_API_KEY as fallback
- Check PDF has readable text or visible specification tables

### "Database connection timeout"

This is a network issue with your Supabase connection:
- Try reconnecting to WiFi or hotspot
- Reduce database pool size if you have low bandwidth

## File Structure After Upload

```
/home/user/GAAADIIQ/apps/api/media_store/
└── brochures/
    └── {job_id}/
        ├── 000.jpg          # Extracted image
        ├── 000_thumb.webp   # Thumbnail
        ├── 001.jpg
        ├── 001_thumb.webp
        └── ...
```

## Database Schema

**pdf_ingestion_jobs** - Records of uploaded PDFs
```
id          | UUID
source_pdf_name | TEXT
file_size_bytes | BIGINT
status      | VARCHAR (processing|completed|failed)
error_message | TEXT
page_count  | INT
image_count | INT
vehicle_count | INT
ai_engine   | VARCHAR (gemini|groq|ollama|none)
uploaded_by | UUID (user_id)
created_at  | TIMESTAMP
completed_at | TIMESTAMP
```

**vehicle_media** - Extracted images with metadata
```
id          | UUID
storage_key | VARCHAR (path to file in storage)
thumbnail_key | VARCHAR
content_type | VARCHAR
size_bytes  | BIGINT
width       | INT
height      | INT
make        | VARCHAR
model       | VARCHAR
variant     | VARCHAR
colour      | VARCHAR
job_id      | UUID (pdf_ingestion_jobs.id)
created_at  | TIMESTAMP
```

**extracted_vehicles** - Vehicle data extracted from PDF text
```
id          | UUID
job_id      | UUID
make        | VARCHAR
model       | VARCHAR
variant     | VARCHAR
price_inr   | BIGINT
fuel_type   | VARCHAR
transmission | VARCHAR
body_type   | VARCHAR
colours     | JSONB
features    | JSONB
specs       | JSONB
confidence  | FLOAT
review_status | VARCHAR
created_at  | TIMESTAMP
```

## Support

If you still have issues:
1. Run the diagnostic: `python test_pdf_upload.py your-pdf.pdf`
2. Check API logs for detailed error messages
3. Verify GEMINI_API_KEY is set correctly
4. Ensure media_store directory exists and is writable
5. Test database connection (see test_pdf_upload.py output)
