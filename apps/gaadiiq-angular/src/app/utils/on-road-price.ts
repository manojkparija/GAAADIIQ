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
 * The slab is decided by engine capacity where it is known, and only guessed
 * from body type or price where it is not — see `rates`.
 */
const SMALL_CAR_GST = 0.18;
const LARGE_CAR_GST = 0.40;
const EV_GST = 0.05;

/** The small-car engine limits the 18% slab is defined by. */
const SMALL_PETROL_CC = 1200;
const SMALL_DIESEL_CC = 1500;

/** Above this, a car with no recorded engine is priced like a large one. */
const SMALL_CAR_PRICE_CEILING = 1000000;

const DIESEL = /diesel/i;

/**
 * Which GST slab this car sits in.
 *
 * Body type is NOT the test, and treating it as one was wrong in a way that
 * mattered. The rule was "an SUV is outside the small-car definition by length
 * and ground clearance whatever it costs" — ground clearance belonged to the
 * OLD compensation cess, which the September 2025 reform abolished, and the
 * 18% slab is defined purely by fuel, engine capacity and a 4000mm length.
 *
 * India's best-selling "SUVs" are sub-4m cars with sub-1200cc petrol engines —
 * Fronx, Nexon, Venue, Brezza, Punch, Exter, Magnite, Sonet. Every one of them
 * qualifies for 18% and every one of them was being shown 40%. On a ₹6.84L
 * Fronx that is ₹1.95L of GST reported where the real figure is ₹1.04L.
 *
 * Engine capacity is the half of the legal test that is recorded, so it decides
 * where it is known. The half that is not recorded is length, which leaves one
 * case still wrong: a car OVER 4m with a small engine — a 1.0 TSI Slavia or
 * Virtus — is 40% in law and will read 18% here. Fixing that needs a length on
 * the catalogue row; guessing it from price would trade one wrong answer for
 * another.
 *
 * None of this moves the on-road total. These rates describe tax already inside
 * the ex-showroom price, not anything added to it.
 */
function rates(base: number, fuel: string, bodyType: string, engineCc?: number | null) {
  if (fuel === 'Electric') return { gstRate: EV_GST, cessRate: 0 };

  if (engineCc && engineCc > 0) {
    const limit = DIESEL.test(fuel) ? SMALL_DIESEL_CC : SMALL_PETROL_CC;
    return {
      gstRate: engineCc <= limit ? SMALL_CAR_GST : LARGE_CAR_GST,
      cessRate: 0,
    };
  }

  // No engine on the row. Body type and price are the only signals left, and
  // both are guesses — but a car with no capacity recorded is more often a
  // large one, and an SUV badge is weak evidence rather than none.
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
  /** Decides the GST slab where it is known. See `rates`. */
  engineCc?: number | null,
): OnRoadPrice {
  const { gstRate, cessRate } = rates(base, fuel, bodyType, engineCc);

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
