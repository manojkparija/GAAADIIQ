"""
A resale projection is a number someone may price a real sale against.

Two properties matter more than accuracy, because neither the heuristic nor the
model can promise accuracy: the curve must always decrease, and a curve the
model got wrong must never reach the page. The validation in _clean exists to
throw away a plausible-looking bad answer in favour of an honest heuristic.
"""
import pytest

from services.resale_forecast import (
    MAX_YEARS,
    _clean,
    heuristic_forecast,
)


class TestHeuristicSuite:
    def test_values_decrease_every_year(self):
        rows = heuristic_forecast(price=1_000_000, fuel="Petrol", years=5)
        values = [r["value"] for r in rows]
        assert values == sorted(values, reverse=True)

    def test_first_year_takes_the_steepest_drop(self):
        """The drive-off cliff is the whole reason buyers ask this question."""
        rows = heuristic_forecast(price=1_000_000, fuel="Petrol", years=3)
        drop1 = 1_000_000 - rows[0]["value"]
        drop2 = rows[0]["value"] - rows[1]["value"]
        assert drop1 > drop2

    def test_ev_depreciates_faster_than_petrol(self):
        petrol = heuristic_forecast(price=2_000_000, fuel="Petrol", years=5)
        ev = heuristic_forecast(price=2_000_000, fuel="Electric", years=5)
        assert ev[-1]["value"] < petrol[-1]["value"]

    def test_hybrid_holds_value_better_than_petrol(self):
        petrol = heuristic_forecast(price=2_000_000, fuel="Petrol", years=5)
        hybrid = heuristic_forecast(price=2_000_000, fuel="Hybrid", years=5)
        assert hybrid[-1]["value"] > petrol[-1]["value"]

    def test_an_older_car_loses_less_in_its_next_year(self):
        """
        Depreciation slows with age: a 5-year-old car gives up far less over the
        coming year than a new one does driving out of the showroom.
        """
        new_car = heuristic_forecast(price=1_000_000, fuel="Petrol", years=1, age=0)
        old_car = heuristic_forecast(price=1_000_000, fuel="Petrol", years=1, age=5)
        assert old_car[0]["value"] > new_car[0]["value"]

    def test_age_shifts_the_curve_without_discounting_the_price(self):
        """
        `price` is what the car is worth today, whatever its age. A used listing's
        asking price has already absorbed the years behind it, so the projection
        must start from that price rather than depreciating it a second time.
        """
        rows = heuristic_forecast(price=500_000, fuel="Petrol", years=1, age=6)
        # One year on from today's ₹5L, not from ₹5L walked down six years.
        assert rows[0]["value"] > 400_000
        assert rows[0]["retained_pct"] > 80

    def test_value_never_falls_below_the_floor(self):
        """A running car is never worth nothing, however long the projection."""
        rows = heuristic_forecast(price=1_000_000, fuel="Electric", years=MAX_YEARS)
        assert rows[-1]["value"] >= 100_000

    def test_years_is_clamped_to_the_supported_range(self):
        assert len(heuristic_forecast(price=500_000, fuel="Petrol", years=99)) == MAX_YEARS
        assert len(heuristic_forecast(price=500_000, fuel="Petrol", years=0)) == 1

    def test_unknown_fuel_falls_back_to_the_base_curve(self):
        rows = heuristic_forecast(price=800_000, fuel="Hydrogen", years=3)
        petrol = heuristic_forecast(price=800_000, fuel="Petrol", years=3)
        assert [r["value"] for r in rows] == [r["value"] for r in petrol]

    def test_retained_pct_matches_the_value(self):
        rows = heuristic_forecast(price=1_000_000, fuel="Petrol", years=2)
        for row in rows:
            assert row["retained_pct"] == pytest.approx(row["value"] / 10_000, abs=0.1)


class TestCleanRejectsBadModelOutputSuite:
    """Each of these is a real shape a model returns when it is guessing."""

    PRICE = 1_000_000

    def test_a_good_answer_survives(self):
        raw = {
            "forecast": [
                {"year": 1, "value": 850_000, "note": "strong demand"},
                {"year": 2, "value": 760_000, "note": ""},
            ],
            "summary": "Holds value well.",
        }
        rows, summary = _clean(raw, self.PRICE, 2)
        assert [r["value"] for r in rows] == [850_000, 760_000]
        assert summary == "Holds value well."

    def test_a_rising_curve_is_discarded(self):
        raw = {"forecast": [{"year": 1, "value": 800_000}, {"year": 2, "value": 900_000}]}
        rows, _ = _clean(raw, self.PRICE, 2)
        assert rows == []

    def test_a_value_above_the_new_price_is_discarded(self):
        raw = {"forecast": [{"year": 1, "value": 1_200_000}]}
        rows, _ = _clean(raw, self.PRICE, 1)
        assert rows == []

    def test_a_short_curve_is_discarded(self):
        """Asked for five years, given two — that is not the answer."""
        raw = {"forecast": [{"year": 1, "value": 850_000}, {"year": 2, "value": 700_000}]}
        rows, _ = _clean(raw, self.PRICE, 5)
        assert rows == []

    def test_a_non_numeric_value_is_discarded(self):
        raw = {"forecast": [{"year": 1, "value": "8.5 lakh"}]}
        rows, _ = _clean(raw, self.PRICE, 1)
        assert rows == []

    def test_a_lakh_figure_masquerading_as_rupees_is_discarded(self):
        """8.5 (lakh) parses as a number but is not a price; it is not > 0 rupees sane."""
        raw = {"forecast": [{"year": 1, "value": 0}]}
        rows, _ = _clean(raw, self.PRICE, 1)
        assert rows == []

    def test_an_empty_forecast_is_the_model_admitting_it_does_not_know(self):
        rows, _ = _clean({"forecast": []}, self.PRICE, 5)
        assert rows == []

    def test_a_missing_forecast_key_is_discarded(self):
        rows, _ = _clean({"summary": "nice car"}, self.PRICE, 5)
        assert rows == []

    def test_notes_are_truncated_not_rejected(self):
        raw = {"forecast": [{"year": 1, "value": 800_000, "note": "x" * 500}]}
        rows, _ = _clean(raw, self.PRICE, 1)
        assert len(rows[0]["note"]) <= 60

    def test_years_are_renumbered_from_one(self):
        """A model that labels years 2027, 2028 still yields a 1..N curve."""
        raw = {
            "forecast": [
                {"year": 2027, "value": 850_000},
                {"year": 2028, "value": 700_000},
            ]
        }
        rows, _ = _clean(raw, self.PRICE, 2)
        assert [r["year"] for r in rows] == [1, 2]
