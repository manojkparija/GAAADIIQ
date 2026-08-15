#!/usr/bin/env python3
"""
Sweep MIN_SEMANTIC_SIMILARITY against the labelled set and print the evidence.

    python scripts/tune_semantic_threshold.py
    python scripts/tune_semantic_threshold.py --min 0.40 --max 0.90 --step 0.02

Requires fastembed, which downloads its model on first use. A sandbox without
outbound access to the model host cannot run this; CI can.

HOW THE SCORE IS DECIDED

Not F1. F1 weights a miss and a false match equally, and here they are not
equal: a miss costs one model call, while a false match tells a driver about
the wrong system with a curated source and a cost range attached. So this uses
F-beta with beta = 0.5, which weights precision at twice the value of recall,
and reports precision, recall and both scores so the trade-off stays visible
rather than being hidden inside one number.

WHAT "CORRECT" MEANS HERE

A positive is only correct if it returns the *right* row. Returning some row
above the threshold for a query that has a labelled answer is still a false
positive when it is the wrong row — that is precisely the failure mode the
threshold exists to prevent, and scoring it as a hit would tune the number in
the wrong direction.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tests.data.semantic_threshold_labels import CORPUS, LABELLED  # noqa: E402


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    return dot / (na * nb) if na and nb else 0.0


def row_text(code: str, canonical: str, symptom: str, keywords: str, cause: str) -> str:
    """Mirrors services/diagnosis_kb_lookup._master_text exactly — same fields,
    same order. The calibration is worthless if it embeds a different blob than
    the lookup does."""
    return " ".join(p for p in (symptom, keywords, cause) if p).strip()


def evaluate(threshold: float, scored: list[tuple[str | None, str | None, float]]) -> dict:
    """scored: (expected_code, best_code, best_score) per labelled query."""
    tp = fp = fn = tn = 0
    for expected, best, score in scored:
        predicted = best if score >= threshold else None
        if predicted is None:
            if expected is None:
                tn += 1
            else:
                fn += 1
        elif predicted == expected:
            tp += 1
        else:
            # Either a match where none was wanted, or the wrong row.
            fp += 1
            if expected is not None:
                fn += 1

    precision = tp / (tp + fp) if (tp + fp) else 1.0
    recall = tp / (tp + fn) if (tp + fn) else 1.0
    beta2 = 0.25  # beta = 0.5
    denom = (beta2 * precision) + recall
    f_half = ((1 + beta2) * precision * recall / denom) if denom else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
    return {
        "threshold": round(threshold, 3),
        "tp": tp, "fp": fp, "fn": fn, "tn": tn,
        "precision": round(precision, 3),
        "recall": round(recall, 3),
        "f_half": round(f_half, 4),
        "f1": round(f1, 4),
    }


def score_queries():
    """Embed the corpus and the queries once, returning per-query best matches."""
    from services.embeddings import embed_texts

    corpus_vectors = embed_texts([row_text(*row) for row in CORPUS])
    if corpus_vectors is None:
        raise SystemExit(
            "fastembed is unavailable — cannot calibrate. Install it, or run this in CI."
        )
    codes = [row[0] for row in CORPUS]

    queries = [q for q, _ in LABELLED]
    query_vectors = embed_texts(queries)

    scored = []
    for (query, expected), qv in zip(LABELLED, query_vectors):
        best_score, best_code = max(
            ((cosine(qv, cv), code) for cv, code in zip(corpus_vectors, codes)),
            key=lambda pair: pair[0],
        )
        scored.append((expected, best_code, best_score))
    return scored


def sweep_scored(scored, lo: float, hi: float, step: float) -> list[dict]:
    """Sweep an already-scored set. Separate from `sweep` so callers that have
    paid for the embeddings once — the test suite — do not pay again per
    threshold."""
    results = []
    t = lo
    while t <= hi + 1e-9:
        results.append(evaluate(t, scored))
        t += step
    return results


def sweep(lo: float, hi: float, step: float) -> list[dict]:
    return sweep_scored(score_queries(), lo, hi, step)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--min", type=float, default=0.40)
    parser.add_argument("--max", type=float, default=0.90)
    parser.add_argument("--step", type=float, default=0.02)
    args = parser.parse_args()

    results = sweep(args.min, args.max, args.step)

    print(f"{'thresh':>7} {'prec':>6} {'recall':>7} {'F0.5':>7} {'F1':>7} "
          f"{'TP':>3} {'FP':>3} {'FN':>3} {'TN':>3}")
    print("-" * 60)
    for r in results:
        print(f"{r['threshold']:>7.2f} {r['precision']:>6.3f} {r['recall']:>7.3f} "
              f"{r['f_half']:>7.4f} {r['f1']:>7.4f} "
              f"{r['tp']:>3} {r['fp']:>3} {r['fn']:>3} {r['tn']:>3}")

    # Highest F0.5; ties broken by the higher threshold, because between two
    # equally-scoring numbers the stricter one serves fewer wrong answers.
    best = max(results, key=lambda r: (r["f_half"], r["threshold"]))
    print("\nBest by F0.5 (precision weighted 2:1 over recall):")
    print(f"  MIN_SEMANTIC_SIMILARITY = {best['threshold']}  "
          f"(precision {best['precision']}, recall {best['recall']})")

    from services.diagnosis_kb_lookup import MIN_SEMANTIC_SIMILARITY as current
    print(f"\nCurrently configured: {current}")
    if abs(current - best["threshold"]) > 1e-9:
        print("  → differs from the measured optimum; update the constant or the labels.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
