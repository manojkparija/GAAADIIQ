#!/usr/bin/env python3
"""
Safely update .env with your Gemini API key without logging it.

Usage:
  python update_env.py
"""

import getpass
from pathlib import Path


def update_env():
    """Update .env file with user's Gemini API key."""
    env_file = Path(".env")
    if not env_file.exists():
        print("❌ .env file not found")
        return False

    # Read current .env
    content = env_file.read_text()

    # Ask for key (input is hidden)
    api_key = getpass.getpass("Enter your GEMINI_API_KEY (input is hidden): ").strip()

    if not api_key:
        print("❌ API key cannot be empty")
        return False

    if len(api_key) < 20:
        print("❌ API key seems too short")
        return False

    # Validate it looks like a Google API key
    if not api_key.startswith("AIzaSy"):
        print("⚠️  Warning: Key doesn't start with 'AIzaSy' (Google API keys usually do)")
        confirm = input("Continue anyway? (y/n): ").strip().lower()
        if confirm != "y":
            return False

    # Replace in content
    if "GEMINI_API_KEY=your_gemini_api_key_here" in content:
        content = content.replace(
            "GEMINI_API_KEY=your_gemini_api_key_here",
            f"GEMINI_API_KEY={api_key}"
        )
    elif "GEMINI_API_KEY=" in content:
        # Replace the existing value (which might be partial)
        lines = content.split("\n")
        for i, line in enumerate(lines):
            if line.startswith("GEMINI_API_KEY="):
                lines[i] = f"GEMINI_API_KEY={api_key}"
                break
        content = "\n".join(lines)
    else:
        print("❌ GEMINI_API_KEY line not found in .env")
        return False

    # Write back
    env_file.write_text(content)
    print("✅ Updated .env with GEMINI_API_KEY")
    print("   Key is NOT logged anywhere")
    print("\n📋 Next steps:")
    print("   1. Restart the API server")
    print("   2. Test with: python test_pdf_upload.py your-pdf.pdf")
    return True

if __name__ == "__main__":
    update_env()
