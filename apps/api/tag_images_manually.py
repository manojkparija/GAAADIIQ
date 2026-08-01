#!/usr/bin/env python3
"""
Manual tagging script for brochure images.

When vehicle extraction fails (e.g., no Gemini API key), images are stored but
not tagged with make/model. This script manually tags them based on the PDF
they came from.
"""
import asyncio
import sys

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from core.config import settings
from models.vehicle_media import VehicleMedia


async def tag_images_by_pdf(pdf_name: str, make: str, model: str) -> int:
    """Tag all untagged images from a specific PDF."""
    engine = create_async_engine(settings.async_database_url, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        # Find untagged images from this PDF
        stmt = select(VehicleMedia).where(
            VehicleMedia.source_pdf_name == pdf_name,
            VehicleMedia.make.is_(None),  # Only untagged
        )
        result = await session.execute(stmt)
        media = result.scalars().all()

        if not media:
            print(f"No untagged images found for {pdf_name}")
            await engine.dispose()
            return 0

        print(f"Found {len(media)} untagged images from {pdf_name}")

        # Update them
        for m in media:
            m.make = make
            m.model = model

        await session.commit()
        print(f"Tagged {len(media)} images: {make} {model}")
        await engine.dispose()
        return len(media)


async def main():
    """Tag PDFs that were uploaded but whose vehicle extraction failed."""
    # DZIRE.pdf -> Maruti Suzuki Dzire
    count1 = await tag_images_by_pdf("DZIRE.pdf", "Maruti Suzuki", "Dzire")

    # TEXT.pdf -> Maruti Suzuki Dzire (or update with actual make/model if different)
    count2 = await tag_images_by_pdf("TEXT.pdf", "Maruti Suzuki", "Dzire")

    total = count1 + count2
    print(f"\nTotal images tagged: {total}")
    return 0 if total > 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
