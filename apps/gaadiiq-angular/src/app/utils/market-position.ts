/**
 * Two buyer-facing judgements about a used car: is the price fair, and is the
 * car itself sound.
 *
 * Both are deliberately built only on what GAADIIQ actually holds.
 *
 * The price side reuses `computeHeuristicValuation` — the same engine behind
 * /ai-valuation and the listing flow — so a car cannot be called fairly priced
 * on one page and overpriced on another. It compares the asking price against
 * that band rather than against comparable listings, because there is no
 * corpus of comparables to compare with: the marketplace has almost no used
 * listings yet, and a "12% below the 3 similar cars near you" built on three
 * rows is a worse answer than no answer.
 *
 * The condition side is a score out of 100 over four factors — age, distance
 * driven, owners, and seller-stated condition. It is NOT the "vehicle history
 * score" the brief describes, and it does not pretend to be: there is no
 * accident history, no service record and no VIN-history integration in this
 * codebase, so `missingFactors` names what is absent and the UI prints it.
 * Rolling four known factors into a number that looks like it also read a
 * history report is the same failure as inventing a credit score — the buyer
 * cannot tell the difference at the point they read it, and would trust it.
 */

import { computeHeuristicValuation, ComputeParams } from './valuation-engine';

export type PriceStatus = 'below' | 'at' | 'above';

export interface MarketBand {
  low: number;
  mid: number;
  high: number;
  confidence: number;
  /** 'listing' when the server valued this car, 'heuristic' when computed here. */
  source: 'listing' | 'heuristic';
}

export interface MarketPosition {
  status: PriceStatus;
  /** Signed percentage away from the mid — negative is cheaper than mid. */
  deltaPct: number;
  /** 0–100, where the asking price sits across the low→high band. Clamped. */
  gaugePct: number;
  band: MarketBand;
  label: string;
  /** One line a buyer can act on, not a restatement of the label. */
  detail: string;
}

/**
 * Within ±5% of the mid reads as "at market".
 *
 * The band itself is only ±10% wide and the engine's own confidence tops out
 * at 82, so a tighter threshold would flip cars between "fair" and "overpriced"
 * on differences the estimate cannot actually resolve.
 */
const AT_MARKET_PCT = 5;

export function marketPosition(askingPrice: number, band: MarketBand): MarketPosition {
  const deltaPct = band.mid > 0
    ? Math.round(((askingPrice - band.mid) / band.mid) * 100)
    : 0;

  const span = band.high - band.low;
  const gaugePct = span > 0
    ? Math.max(0, Math.min(100, Math.round(((askingPrice - band.low) / span) * 100)))
    : 50;

  const status: PriceStatus =
    deltaPct < -AT_MARKET_PCT ? 'below' : deltaPct > AT_MARKET_PCT ? 'above' : 'at';

  const away = Math.abs(deltaPct);
  const label =
    status === 'below' ? `${away}% below market`
    : status === 'above' ? `${away}% above market`
    : 'At market price';

  const detail =
    status === 'below'
      ? 'Priced under our estimate for this car. Worth checking the service history and paperwork to understand why.'
      : status === 'above'
      ? 'Priced over our estimate. Ask the seller what justifies it — low running, a full service record or a transferable warranty often do.'
      : 'In line with our estimate for this age, distance and condition.';

  return { status, deltaPct, gaugePct, band, label, detail };
}

/** Builds the band from the shared engine when the server has not valued the car. */
export function bandFromHeuristic(p: ComputeParams): MarketBand {
  const v = computeHeuristicValuation(p);
  return { low: v.low, mid: v.mid, high: v.high, confidence: v.confidence, source: 'heuristic' };
}

// ── Condition score ──────────────────────────────────────────────────────────

export interface ScoreFactor {
  label: string;
  /** 0–100 for this factor alone. */
  score: number;
  /** What the score was read off, in the buyer's words. */
  detail: string;
}

export interface VehicleScore {
  score: number;
  grade: 'Excellent' | 'Good' | 'Fair' | 'Needs inspection';
  factors: ScoreFactor[];
  /** Named on the page, so the number is never read as more than it is. */
  missingFactors: string[];
}

export interface ScoreParams {
  year: number;
  km: number;
  /** '1st Owner' | '2nd Owner' | … — free text, as the listing stores it. */
  owners?: string;
  condition?: string;
}

/** 15,000 km a year is the Indian norm the valuation engine also assumes. */
const KM_PER_YEAR = 15000;

function ageScore(age: number): ScoreFactor {
  // Full marks to three years, then roughly seven points a year, floored at 10
  // — a fifteen-year-old car is not a zero, it is a car to inspect.
  const score = age <= 3 ? 100 : Math.max(10, Math.round(100 - (age - 3) * 7));
  return {
    label: 'Age',
    score,
    detail: age <= 0 ? 'Registered this year' : `${age} year${age === 1 ? '' : 's'} old`,
  };
}

function distanceScore(km: number, age: number): ScoreFactor {
  // Judged against what this car should have covered by now, not a flat number:
  // 60,000 km on a two-year-old car and on an eight-year-old one are different
  // cars entirely.
  const expected = Math.max(KM_PER_YEAR, age * KM_PER_YEAR);
  const ratio = km / expected;

  // Piecewise, because a straight line through this was far too kind at the top
  // end: a twelve-year-old car with 2.4 lakh km — a third more than its age
  // accounts for — scored 82 out of 100 for distance and dragged the whole car
  // up to "Fair". Below three-quarters of expected is simply low; the slope
  // past 1.15 is steep, because that is where the reading stops being ordinary
  // wear and starts being the thing to ask about.
  const score =
    ratio <= 0.75 ? 100
    : ratio <= 1.15 ? Math.round(100 - ((ratio - 0.75) / 0.4) * 20)
    : Math.max(10, Math.round(80 - (ratio - 1.15) * 90));
  const detail =
    ratio <= 0.75 ? `${km.toLocaleString('en-IN')} km — low for its age`
    : ratio <= 1.15 ? `${km.toLocaleString('en-IN')} km — about average for its age`
    : `${km.toLocaleString('en-IN')} km — high for its age`;
  return { label: 'Distance driven', score, detail };
}

function ownersScore(owners?: string): ScoreFactor {
  const n = owners ? parseInt(owners, 10) : NaN;
  const count = Number.isFinite(n) && n > 0 ? n : 1;
  const score = count === 1 ? 100 : count === 2 ? 78 : count === 3 ? 55 : 35;
  return {
    label: 'Ownership',
    score,
    detail: !owners
      ? 'Not stated by the seller — treated as first owner'
      : count === 1 ? 'First owner' : `${count} previous owners`,
  };
}

function conditionScore(condition?: string): ScoreFactor {
  const c = (condition ?? '').toLowerCase();
  const score =
    c.includes('excellent') ? 100
    : c.includes('good') ? 82
    : c.includes('fair') ? 60
    : c.includes('needs') || c.includes('poor') ? 40
    : 70;
  return {
    label: 'Seller-stated condition',
    score,
    // The listing stores the enum label, so it arrives as "good". Printed back
    // to a buyer verbatim it reads as a database value rather than an answer.
    detail: condition
      ? condition.charAt(0).toUpperCase() + condition.slice(1)
      : 'Not stated — scored as average pending inspection',
  };
}

/**
 * Weights: the two facts that are checkable on the papers count for more than
 * the one the seller simply asserts.
 */
const WEIGHTS = { age: 0.25, distance: 0.3, owners: 0.25, condition: 0.2 };

export function vehicleScore(p: ScoreParams): VehicleScore {
  const age = Math.max(0, new Date().getFullYear() - p.year);

  const age_ = ageScore(age);
  const distance = distanceScore(Math.max(0, p.km || 0), age);
  const owners = ownersScore(p.owners);
  const condition = conditionScore(p.condition);

  const score = Math.round(
    age_.score * WEIGHTS.age +
    distance.score * WEIGHTS.distance +
    owners.score * WEIGHTS.owners +
    condition.score * WEIGHTS.condition,
  );

  const grade =
    score >= 85 ? 'Excellent'
    : score >= 70 ? 'Good'
    : score >= 55 ? 'Fair'
    : 'Needs inspection';

  return {
    score,
    grade,
    factors: [age_, distance, owners, condition],
    // Named because the score is worth less than a buyer would assume without
    // them, and they are the three things a history report would have added.
    missingFactors: ['Accident history', 'Service records', 'Insurance claim history'],
  };
}
