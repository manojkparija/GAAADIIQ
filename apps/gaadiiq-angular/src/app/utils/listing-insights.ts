/**
 * Why a listing is not selling, in words the seller can act on.
 *
 * The analytics page showed views, bookings, inquiries and reviews per
 * listing — four numbers with no interpretation. A seller looking at "38 views,
 * 0 bookings" has to work out for themselves whether that is bad, and what to
 * do about it. That is the work this does.
 *
 * TWO RULES
 *
 * Every insight names the evidence it is drawn from, because "consider
 * lowering your price" with nothing behind it is just nagging.
 *
 * And nothing is said at all until the numbers can support it. A listing with
 * four views has not failed to convert — nobody has seen it. Saying "your
 * photos may be putting buyers off" on the strength of four views sends a
 * seller off to reshoot a car for no reason.
 */

export interface ListingStats {
  title: string;
  price: number;
  views: number;
  bookings: number;
  loanInquiries: number;
  daysOnMarket?: number;
  /** The platform's median time-to-sell, when it has one. */
  medianDaysToSell?: number | null;
}

export interface Insight {
  /** 'watch' is neutral information; 'act' is something to change. */
  kind: 'act' | 'watch' | 'good';
  message: string;
  /** The reading behind it, shown alongside. */
  evidence: string;
}

/** Below this, a listing has not been seen enough to draw any conclusion. */
export const MIN_VIEWS_FOR_INSIGHT = 25;

/**
 * Views per enquiry that counts as healthy.
 *
 * A round number chosen to be conservative rather than a measured rate — the
 * platform has no conversion history yet. It is used only to decide whether to
 * raise the subject, never quoted to the seller as an industry figure, because
 * it is not one.
 */
const HEALTHY_VIEWS_PER_ENQUIRY = 40;

export function listingInsights(s: ListingStats): Insight[] {
  const insights: Insight[] = [];
  const enquiries = s.bookings + s.loanInquiries;

  if (s.views < MIN_VIEWS_FOR_INSIGHT) {
    return [{
      kind: 'watch',
      message:
        'Not enough views yet to tell you anything useful about this listing. '
        + 'Nothing here has gone wrong — it has not been seen.',
      evidence: `${s.views} view${s.views === 1 ? '' : 's'} so far`,
    }];
  }

  // Seen plenty, contacted by nobody. The most actionable state there is, and
  // the one the four bare numbers hid.
  if (enquiries === 0) {
    insights.push({
      kind: 'act',
      message:
        'Buyers are finding this car and not getting in touch. That usually '
        + 'means the price, the photographs, or a description that leaves '
        + 'questions unanswered.',
      evidence: `${s.views} views, no enquiries`,
    });
  } else if (s.views / enquiries > HEALTHY_VIEWS_PER_ENQUIRY) {
    insights.push({
      kind: 'act',
      message:
        'Plenty of interest, few enquiries. Worth checking the price against '
        + 'similar cars and adding photographs of the interior and the odometer.',
      evidence: `${Math.round(s.views / enquiries)} views per enquiry`,
    });
  } else {
    insights.push({
      kind: 'good',
      message: 'This listing is converting views into enquiries at a healthy rate.',
      evidence: `${enquiries} enquir${enquiries === 1 ? 'y' : 'ies'} from ${s.views} views`,
    });
  }

  // Only when there is a real median to compare against. Without one, "this is
  // taking a long time" is a comparison to nothing.
  const median = s.medianDaysToSell;
  const days = s.daysOnMarket;
  if (median && days && days > median * 1.5) {
    insights.push({
      kind: 'act',
      message:
        'This car has been listed considerably longer than most cars here take '
        + 'to sell. A price change is the usual way to restart interest.',
      evidence: `${days} days listed, against a typical ${median}`,
    });
  }

  return insights;
}
