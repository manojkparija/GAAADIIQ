#!/usr/bin/env python3
"""
Test the PDF brochure upload flow to diagnose issues.

Usage:
  python test_pdf_upload.py <pdf_file_path>

Example:
  python test_pdf_upload.py ~/Downloads/DZIRE.pdf
"""

import asyncio
import sys
from pathlib import Path

async def test_upload():
    """Test PDF upload and image extraction."""
    if len(sys.argv) < 2:
        print("Usage: python test_pdf_upload.py <pdf_file_path>")
        print("\nExample: python test_pdf_upload.py ~/Downloads/DZIRE.pdf")
        sys.exit(1)

    pdf_path = Path(sys.argv[1]).resolve()
    if not pdf_path.exists():
        print(f"❌ PDF file not found: {pdf_path}")
        sys.exit(1)

    print(f"📄 Testing with: {pdf_path}")
    print(f"   Size: {pdf_path.stat().st_size / 1024 / 1024:.1f} MB")

    # Test 1: PDF validation
    print("\n1️⃣  Testing PDF validation...")
    from services import pdf_ingest
    header = pdf_path.read_bytes()[:100]
    if pdf_ingest.is_pdf(header):
        print("   ✅ Valid PDF")
    else:
        print("   ❌ Not a valid PDF")
        sys.exit(1)

    # Test 2: Image extraction
    print("\n2️⃣  Testing image extraction...")
    try:
        images = pdf_ingest.extract_images(pdf_path.read_bytes())
        print(f"   ✅ Extracted {len(images)} images")
        for i, img in enumerate(images[:3]):
            print(f"      {i+1}. {img['width']}x{img['height']} ({img['content_type']})")
        if len(images) > 3:
            print(f"      ... and {len(images) - 3} more")
    except Exception as e:
        print(f"   ❌ Image extraction failed: {e}")
        sys.exit(1)

    # Test 3: Text extraction
    print("\n3️⃣  Testing text extraction...")
    try:
        text = pdf_ingest.extract_text(pdf_path.read_bytes())
        print(f"   ✅ Extracted {len(text)} characters of text")
        print(f"      First 100 chars: {text[:100]!r}...")
    except Exception as e:
        print(f"   ❌ Text extraction failed: {e}")
        sys.exit(1)

    # Test 4: Storage
    print("\n4️⃣  Testing local storage...")
    from services.media_storage import get_storage
    import uuid
    storage = get_storage()
    test_key = f"test/{uuid.uuid4()}.txt"
    test_data = b"test data"
    try:
        obj = await storage.save(test_key, test_data, "text/plain")
        print(f"   ✅ Successfully stored test file")
        print(f"      Key: {obj.key}")
        print(f"      URL: {obj.url}")

        # Verify it can be loaded back
        loaded = await storage.load(test_key)
        if loaded == test_data:
            print(f"   ✅ Successfully retrieved test file")
        else:
            print(f"   ❌ Retrieved data doesn't match")
    except Exception as e:
        print(f"   ❌ Storage test failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

    # Test 5: Vehicle extraction (requires API keys)
    print("\n5️⃣  Testing vehicle extraction...")
    from core.config import settings
    if not settings.gemini_api_key or settings.gemini_api_key == "your_gemini_api_key_here":
        print("   ⚠️  GEMINI_API_KEY not configured")
        print(f"      Current value: {settings.gemini_api_key[:20]}...")
        print("      Set GEMINI_API_KEY in .env to a real API key to test vehicle extraction")
    else:
        try:
            vehicles, engine = await pdf_ingest.extract_vehicles(text, source=pdf_path)
            print(f"   ✅ Vehicle extraction completed (engine: {engine})")
            print(f"      Found {len(vehicles)} vehicles")
            for v in vehicles[:2]:
                print(f"      - {v.get('make')} {v.get('model')} {v.get('variant')}")
        except Exception as e:
            print(f"   ⚠️  Vehicle extraction failed: {e}")

    # Test 6: Database
    print("\n6️⃣  Testing database connection...")
    from db.session import engine
    try:
        async with engine.connect() as conn:
            result = await conn.execute("SELECT 1 as test")
            row = result.fetchone()
            if row:
                print("   ✅ Database connection successful")
            else:
                print("   ❌ Database query failed")
    except Exception as e:
        print(f"   ❌ Database connection failed: {e}")
        print("      This might be a network issue or database is unreachable")

    print("\n✅ All tests completed!")
    print("\nNext steps:")
    print("  1. If any tests failed, check the error messages above")
    print("  2. Set GEMINI_API_KEY=your_actual_key in .env to enable vehicle extraction")
    print("  3. Test full upload via: curl -F 'file=@DZIRE.pdf' http://localhost:8000/brochures/upload")

if __name__ == "__main__":
    asyncio.run(test_upload())
