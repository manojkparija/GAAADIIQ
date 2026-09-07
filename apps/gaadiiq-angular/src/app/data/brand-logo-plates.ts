/**
 * Which brand logos need a dark plate instead of the usual white chip.
 *
 * THE BUG THIS COMES FROM
 *
 * The brand grid on /new-cars painted its logos straight onto the dark glass
 * card. Reported with a screenshot circling Toyota, Kia, Lexus, Mini and
 * Jaguar: "logos are not visible in web application".
 *
 * The home page had already solved this with --logo-chip — a white chip in
 * both themes — and the note there says a light ground "is what every logo in
 * the set was designed to sit on". Measuring the files says that is true of
 * most of them and not of all: the set is mixed polarity. Most marks are dark
 * artwork on transparent, but ten are light or silver artwork (Genesis, Lexus,
 * Volvo, Renault, Rolls-Royce, Aston Martin, Bentley, Skoda) or yellow
 * (Ferrari, Lotus), and those are the ones that read fine on the dark card
 * today. Putting the whole grid on a white chip would have fixed thirteen
 * logos and broken ten — in the very theme the report came from.
 *
 * So the plate is per logo. White is the default, matching home; these ten get
 * --navy instead, which reads as the chip vanishing into the card.
 *
 * MEASURED, NOT EYEBALLED
 *
 * scripts/measure_brand_logo_plates.py produces this list. For each file it
 * takes the fraction of the mark clearing 3:1 — WCAG's threshold for a
 * graphical object — against each candidate plate, at the size the grid
 * paints. A logo moves here only when the white chip actually fails it and the
 * dark plate is better, so marks that are readable either way (BMW 0.69/0.73)
 * stay on the default rather than churning.
 *
 *   slug           on white   on navy
 *   genesis            0.19      0.87
 *   lexus              0.30      0.94
 *   volvo              0.28      0.80
 *   ferrari            0.32      0.81
 *   renault            0.34      0.80
 *   aston-martin       0.36      0.80
 *   bentley            0.40      0.71
 *   lotus              0.40      0.64
 *   skoda              0.45      0.77
 *   rolls-royce        0.48      0.77
 *
 * Re-run that script after adding or replacing anything in
 * src/assets/brand-logos/ and paste its output over the set below.
 *
 * A slug that is not listed — including a logo an admin uploads later, which
 * cannot be measured here — gets the white chip. That is the same default the
 * home page has shipped with, so an unknown logo is no worse off than it is
 * today.
 */
export const DARK_PLATE_SLUGS = new Set([
  'aston-martin',
  'bentley',
  'ferrari',
  'genesis',
  'lexus',
  'lotus',
  'renault',
  'rolls-royce',
  'skoda',
  'volvo',
]);

/** True when this brand's mark needs the dark plate rather than the white chip. */
export function usesDarkPlate(slug: string | null | undefined): boolean {
  return DARK_PLATE_SLUGS.has((slug ?? '').trim().toLowerCase());
}
