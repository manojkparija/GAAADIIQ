"""
Calibration guard for MIN_SEMANTIC_SIMILARITY.

The threshold decides whether a driver is shown a curated diagnosis or falls
through to a model. It was 0.62 because 0.62 felt safe. This turns it into a
measured value with a regression guard: the labelled set in
`tests/data/semantic_threshold_labels.py` is swept, and the configured
constant has to clear an explicit precision bar and be at least as good as the
alternatives by the metric we actually care about.

WHY THESE ASSERTIONS AND NOT "the optimum equals the constant"

Pinning equality would make the suite fail every time the embedding model or a
single label changed by a hair, and the fix for that failure is always "move
the constant", which is not a test — it is a ratchet with extra steps. What is
asserted instead is what would actually hurt:

  * precision at the configured threshold (a wrong served answer is the
    expensive error, so this is the hard floor)
  * that no near-miss is served (the negatives must stay rejected)
  * that recall has not collapsed (a threshold of 0.99 is "safe" and useless)

SKIPPED WITHOUT fastembed

fastembed downloads its model on first use, so a sandbox without access to the
model host cannot run this and skips. CI has access and runs it — which is the
same asymmetry that let the semantic rung ship ignoring vehicle scope, with CI
the only thing that caught it.
"""

import pytest

from services.diagnosis_kb_lookup import MIN_SEMANTIC_SIMILARITY
from services.embeddings import embed_texts

from .data.semantic_threshold_labels import CORPUS, LABELLED

pytestmark = pytest.mark.skipif(
    embed_texts(["probe"]) is None,
    reason="fastembed unavailable (no model download in this environment)",
)

# A curated answer carries a named source and a cost range. Serving the wrong
# one is worse than serving none, so precision is a floor rather than a target.
MIN_PRECISION = 0.9
# And a threshold that rejects everything would satisfy that floor trivially.
MIN_RECALL = 0.6


@pytest.fixture(scope="module")
def scored():
    from scripts.tune_semantic_threshold import score_queries

    return score_queries()


def _evaluate(threshold, scored):
    from scripts.tune_semantic_threshold import evaluate

    return evaluate(threshold, scored)


def _table(scored) -> str:
    """The whole sweep, for the failure message.

    A bare "precision 0.842 < 0.9" tells you the constant is wrong but not what
    to change it to, which costs a CI round-trip per guess. Printing the sweep
    means one red run carries the answer with it.
    """
    from scripts.tune_semantic_threshold import sweep_scored

    lines = ["", f"{'thresh':>7} {'prec':>6} {'recall':>7} {'F0.5':>7} "
                 f"{'TP':>3} {'FP':>3} {'FN':>3} {'TN':>3}"]
    for r in sweep_scored(scored, 0.50, 0.90, 0.02):
        lines.append(
            f"{r['threshold']:>7.2f} {r['precision']:>6.3f} {r['recall']:>7.3f} "
            f"{r['f_half']:>7.4f} {r['tp']:>3} {r['fp']:>3} {r['fn']:>3} {r['tn']:>3}"
        )
    worst = sorted(scored, key=lambda t: -t[2])[:6]
    lines.append("")
    lines.append("highest-scoring queries (expected, matched, score):")
    for expected, best, score in worst:
        lines.append(f"  {expected!s:>12}  {best:>12}  {float(score):.3f}")
    return "\n".join(lines)


class TestSemanticThresholdSuite:
    def test_configured_threshold_meets_the_precision_floor(self, scored):
        result = _evaluate(MIN_SEMANTIC_SIMILARITY, scored)
        assert result["precision"] >= MIN_PRECISION, (
            f"precision {result['precision']} at threshold {MIN_SEMANTIC_SIMILARITY} "
            f"— {result['fp']} of {result['tp'] + result['fp']} served matches were wrong"
            + _table(scored)
        )

    def test_configured_threshold_still_answers_most_real_symptoms(self, scored):
        # The other half of the trade. Without this, 0.99 passes the test above.
        result = _evaluate(MIN_SEMANTIC_SIMILARITY, scored)
        assert result["recall"] >= MIN_RECALL, (
            f"recall {result['recall']} at threshold {MIN_SEMANTIC_SIMILARITY} "
            f"— {result['fn']} symptoms the corpus covers fell through to a model"
            + _table(scored)
        )

    def test_no_near_miss_is_served(self, scored):
        # The negatives are adjacent-system queries chosen to share vocabulary
        # with a row. Every one of them must score below the threshold.
        served = [
            (expected, best, round(score, 3))
            for expected, best, score in scored
            if expected is None and score >= MIN_SEMANTIC_SIMILARITY
        ]
        assert not served, (
            f"queries with no correct answer were matched anyway: {served}"
            + _table(scored)
        )

    def test_the_constant_is_not_far_from_the_measured_optimum(self, scored):
        # Not equality — that is a ratchet, not a test. But a constant sitting
        # 0.1 away from the optimum means the labels and the code have drifted
        # apart and somebody should look at which one is wrong.
        from scripts.tune_semantic_threshold import sweep_scored

        results = sweep_scored(scored, 0.40, 0.90, 0.02)
        best = max(results, key=lambda r: (r["f_half"], r["threshold"]))
        assert abs(best["threshold"] - MIN_SEMANTIC_SIMILARITY) <= 0.1, (
            f"measured optimum {best['threshold']} vs configured "
            f"{MIN_SEMANTIC_SIMILARITY}; run scripts/tune_semantic_threshold.py"
        )

    def test_the_labelled_set_is_worth_calibrating_against(self):
        # A calibration set with no negatives tunes the threshold to zero. Guard
        # the fixture itself, because that failure is silent and the resulting
        # threshold looks like a measurement.
        negatives = [q for q, expected in LABELLED if expected is None]
        positives = [q for q, expected in LABELLED if expected is not None]
        assert len(negatives) >= 5
        assert len(positives) >= 10
        # Every positive names a row that exists.
        codes = {row[0] for row in CORPUS}
        unknown = {e for _, e in LABELLED if e is not None and e not in codes}
        assert not unknown, f"labels point at rows that do not exist: {unknown}"
