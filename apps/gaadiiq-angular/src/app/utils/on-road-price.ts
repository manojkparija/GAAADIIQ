/**
 * What a car actually costs to put on the road.
 *
 *     on-road = ex-showroom + road tax + insurance + handling
 *
 * GST is not added. An ex-showroom price already contains it — it is the
 * ex-factory price plus GST plus the dealer's margin, which is why it is the
 * figure a manufacturer publishes and a buyer compares across models. Adding
 * it again charged a ₹5.25L S-Presso tax a second time and quoted ₹7.4L on the
 * road for a car that costs about ₹5.8L — an overstatement of ₹1.5L on the
 * number a buyer budgets against.
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
 * GST rates, per the 56th GST Council meeting of 3 September 2025, in force
 * from 22 September 2025.
 *
 *   Electric:                                            5%
 *   Small car — petrol/CNG/LPG <= 1200cc, diesel
 *   <= 1500cc, and length <= 4000mm:                    18%
 *   Everything larger, including SUVs:                  40%
 *
 * Compensation cess was abolished for automobiles by the same reform. It is
 * still reported as a line so an older quote can be read against a newer one,
 * but the rate is zero and no longer varies by segment.
 *
 * These replaced a 28% slab plus a cess of 1% to 22% that varied by length,
 * engine capacity, fuel and ground clearance. Carrying the old numbers meant
 * quoting a tax breakdown no buyer would recognise from a showroom invoice.
 *
 * Segment is inferred from the price band, because length and engine capacity
 * are not recorded against every catalogue model. That is a heuristic and it
 * will misjudge a cheap large car or an expensive small one; the ex-showroom
 * figure it explains is unaffected either way, since these rates describe what
 * is already inside that price rather than anything added to it.
 */
const SMALL_CAR_GST = 0.18;
const LARGE_CAR_GST = 0.40;
const EV_GST = 0.05;

/** Above this, a car is priced like something outside the small-car limits. */
const SMALL_CAR_PRICE_CEILING = 1000000;

function rates(base: number, fuel: string, bodyType: string) {
  if (fuel === 'Electric') return { gstRate: EV_GST, cessRate: 0 };

  // An SUV is outside the small-car definition by length and ground clearance
  // whatever it costs, so body type decides before price does.
  if (/suv/i.test(bodyType)) return { gstRate: LARGE_CAR_GST, cessRate: 0 };

  return {
    gstRate: base <= SMALL_CAR_PRICE_CEILING ? SMALL_CAR_GST : LARGE_CAR_GST,
    cessRate: 0,
  };
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
