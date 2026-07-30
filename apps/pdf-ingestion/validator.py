"""Duplicate detection and conflict flagging for extracted vehicles."""

from __future__ import annotations
import logging
from typing import Optional

from models import ExtractedVehicle, VehicleStatus

logger = logging.getLogger(__name__)

try:
    from rapidfuzz import fuzz
    _HAS_RAPIDFUZZ = True
except ImportError:
    _HAS_RAPIDFUZZ = False
    logger.warning("rapidfuzz not installed; duplicate detection disabled")


def _fuzzy_score(a: str, b: str) -> float:
    if _HAS_RAPIDFUZZ:
        return fuzz.token_sort_ratio(a, b) / 100.0
    # Fallback: simple char overlap
    sa, sb = set(a.lower().split()), set(b.lower().split())
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / max(len(sa), len(sb))


def _vehicle_key(v: ExtractedVehicle) -> str:
    return " ".join(filter(None, [v.make, v.model, v.variant, str(v.year or "")])).lower()


def detect_duplicates(
    new_vehicles: list[ExtractedVehicle],
    existing_vehicles: list[ExtractedVehicle],
    threshold: float = 0.85,
) -> list[ExtractedVehicle]:
    """
    For each new vehicle, check against existing. If fuzzy similarity ≥ threshold,
    mark duplicate_of = existing vehicle id and set status = NEEDS_REVIEW.
    """
    for nv in new_vehicles:
        nv_key = _vehicle_key(nv)
        best_score, best_id = 0.0, None

        for ev in existing_vehicles:
            ev_key = _vehicle_key(ev)
            score = _fuzzy_score(nv_key, ev_key)
            if score > best_score:
                best_score, best_id = score, ev.id

        if best_score >= threshold and best_id:
            nv.duplicate_of = best_id
            nv.status = VehicleStatus.NEEDS_REVIEW
            logger.debug(f"Duplicate detected: '{nv_key}' ~ '{best_id}' (score={best_score:.2f})")

    return new_vehicles


def flag_conflicts(vehicles: list[ExtractedVehicle]) -> list[ExtractedVehicle]:
    """
    Within a single job's vehicle list, flag pairs that share (make, model, variant)
    but differ in price > 5%. Appends admin_notes.
    """
    for i, a in enumerate(vehicles):
        for b in vehicles[i + 1:]:
            if not (a.make and b.make):
                continue
            if (
                (a.make or "").lower() == (b.make or "").lower()
                and (a.model or "").lower() == (b.model or "").lower()
                and (a.variant or "").lower() == (b.variant or "").lower()
            ):
                if a.price_inr and b.price_inr:
                    diff = abs(a.price_inr - b.price_inr) / max(a.price_inr, b.price_inr)
                    if diff > 0.05:
                        note = f"Price conflict with another record (diff {diff:.0%})."
                        a.admin_notes = (a.admin_notes + " " + note).strip()
                        b.admin_notes = (b.admin_notes + " " + note).strip()

    return vehicles
