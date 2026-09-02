/**
 * What a car actually costs to put on the road.
 *
 *     on-road = ex-showroom + road tax + insurance + handling
 *
 * GST is neither added nor reported. An ex-showroom price is the factory cost
 * plus the dealer's margin plus GST and cess, so the tax is already inside the
 * figure this starts from; what a buyer still has to pay is road tax,
 * registration and insurance, and those are what this adds.
 *
 * The breakdown used to carry an indented "GST (x%) — included" line, on the
 * reasoning that a buyer wants to know what tax is in the price. Two problems.
 * It read as another charge on a list of charges. And it had to be RIGHT: the
 * slab was picked from body type, so a sub-4m SUV — Fronx, Nexon, Venue,
 * Brezza — showed 40% where 18% applies, ₹1.95L against ₹1.04L on a ₹6.84L
 * Fronx. A figure that is not part of the sum and is hard to keep true is
 * better not shown at all.
 *
 * Adding GST to the total, which an earlier version did, was worse still: it
 * charged a ₹5.25L S-Presso tax a second time and quoted ₹7.4L on the road for
 * a car that costs about ₹5.8L. That is why the total below is base + road tax
 * + insurance + handling and nothing else.
 *
 * Extracted from the car detail page so this can be tested directly. A wrong
 * number here is money, and it is worth more than a component that has to be
 * stood up with ten injected services before it can be asked one question.
 */

export interface OnRoadPrice {
  /** Ex-showroom, which already contains GST and cess. */
  base: number;
  registration: number;
  regRate: number;
  insurance: number;
  handling: number;
  total: number;
}

/** Dealer handling and logistics, which no published price includes. */
const HANDLING = 10000;

/**
 * Insurance: the IRDAI-mandated third-party premium plus own damage at
 * roughly 2% of the insured value. The TP band follows engine capacity, which
 * price stands in for.
 */
function insuranceFor(base: number): number {
  const tp = base < 600000 ? 2094 : base < 1500000 ? 3416 : 7897;
  return tp + Math.round(base * 0.02);
}

/**
 * `bodyType` is unused since the GST line was dropped, and is kept so the two
 * call sites do not have to change shape for a parameter that may well come
 * back — an engine-capacity-aware slab already exists in this file's history.
 */
export function computeOnRoadPrice(
  base: number,
  fuel: string,
  _bodyType: string,
  stateRegRate: number,
): OnRoadPrice {
  // Most states charge an EV half the road tax or none at all.
  const effectiveRegRate = fuel === 'Electric' ? stateRegRate * 0.5 : stateRegRate;
  const registration = Math.round(base * effectiveRegRate);

  const insurance = insuranceFor(base);

  return {
    base,
    registration,
    regRate: Math.round(effectiveRegRate * 100),
    insurance,
    handling: HANDLING,
    // No tax term: GST and cess are inside `base` already.
    total: Math.round(base + registration + insurance + HANDLING),
  };
}
