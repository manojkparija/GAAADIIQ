/**
 * What a car actually costs to put on the road.
 *
 *     on-road = ex-showroom + road tax + insurance + handling
 *
 * GST and cess are not added. An ex-showroom price already contains them — it
 * is the ex-factory price plus GST, plus cess, plus the dealer's margin, which
 * is why it is the figure a manufacturer publishes and a buyer compares across
 * models. Adding them again charged a ₹5.25L S-Presso 28% GST and 1% cess a
 * second time and quoted ₹7.4L on the road for a car that costs about ₹5.8L —
 * an overstatement of ₹1.5L on the number a buyer budgets against.
 *
 * They are still reported, because a buyer wants to know what tax is in the
 * price, but as a breakdown OF the ex-showroom figure: the taxable value is
 * recovered by dividing out the rates.
 *
 * Extracted from the car detail page so this can be tested directly. A wrong
 * number here is money, and it is worth more than a component that has to be
 * stood up with ten injected services before it can be asked one question.
 */

export interface OnRoadPrice {
  base: number;
  /** GST already inside `base`, not added to it. */
  gst: number;
  gstRate: number;
  /** Cess already inside `base`, not added to it. */
  cess: number;
  cessRate: number;
  registration: number;
  regRate: number;
  insurance: number;
  handling: number;
  total: number;
}

/** Dealer handling and logistics, which no published price includes. */
const HANDLING = 10000;

/**
 * GST & cess rates, per the GST Council notification as updated in 2023:
 *
 *   Electric:                          5% GST, no cess
 *   CNG/Petrol < 4m, engine < 1200cc:  28% GST + 1% cess
 *   Diesel < 4m, engine < 1500cc:      28% GST + 3% cess
 *   Petrol > 4m or engine >= 1200cc:   28% GST + 17% cess
 *   SUV (>4m, >1500cc, GC > 170mm):    28% GST + 22% cess
 *
 * Segment is inferred from the price band, because length and engine capacity
 * are not always recorded against a catalogue model.
 */
function rates(base: number, fuel: string, bodyType: string) {
  if (fuel === 'Electric') return { gstRate: 0.05, cessRate: 0 };
  if (fuel === 'Hybrid') {
    // Strong hybrids take 15%; mild hybrids sit with their fuel type.
    return { gstRate: 0.28, cessRate: base > 1500000 ? 0.15 : 0.17 };
  }

  const isSuv = /suv/i.test(bodyType);
  let cessRate: number;
  if (base < 600000) {
    cessRate = fuel === 'Diesel' ? 0.03 : 0.01;
  } else if (base < 1200000) {
    cessRate = fuel === 'Diesel' ? 0.17 : 0.03;
  } else if (base < 2000000) {
    cessRate = 0.17;
  } else {
    cessRate = isSuv ? 0.22 : 0.17;
  }
  return { gstRate: 0.28, cessRate };
}

/**
 * Insurance: the IRDAI-mandated third-party premium plus own damage at
 * roughly 2% of the insured value. The TP band follows engine capacity, which
 * price stands in for.
 */
function insuranceFor(base: number): number {
  const tp = base < 600000 ? 2094 : base < 1500000 ? 3416 : 7897;
  return tp + Math.round(base * 0.02);
}

export function computeOnRoadPrice(
  base: number,
  fuel: string,
  bodyType: string,
  stateRegRate: number,
): OnRoadPrice {
  const { gstRate, cessRate } = rates(base, fuel, bodyType);

  // ex-showroom = taxable × (1 + gst + cess), so the taxable value is the
  // quotient and each tax is its share — recovered from the price, not added.
  const taxable = base / (1 + gstRate + cessRate);
  const gst = Math.round(taxable * gstRate);
  const cess = Math.round(taxable * cessRate);

  // Most states charge an EV half the road tax or none at all.
  const effectiveRegRate = fuel === 'Electric' ? stateRegRate * 0.5 : stateRegRate;
  const registration = Math.round(base * effectiveRegRate);

  const insurance = insuranceFor(base);

  return {
    base,
    gst,
    gstRate: Math.round(gstRate * 100),
    cess,
    cessRate: Math.round(cessRate * 100),
    registration,
    regRate: Math.round(effectiveRegRate * 100),
    insurance,
    handling: HANDLING,
    // gst and cess are deliberately absent: they are inside base already.
    total: Math.round(base + registration + insurance + HANDLING),
  };
}
