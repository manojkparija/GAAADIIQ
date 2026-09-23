/**
 * Matching a fuel filter against what a model is actually sold with.
 *
 * Shared because the two new-car grids have drifted apart on this twice. The
 * New Cars grid and the Browse grid each group catalogue rows into models and
 * each decide which models a fuel chip keeps, and a fix applied to one has
 * repeatedly not reached the other.
 */

/**
 * Whether a model's fuel string offers the fuel a filter asks for.
 *
 * A trim's fuel is free text — the admin screen's own field is an `<input>`
 * whose placeholder reads "Petrol, Petrol + CNG…", so a bi-fuel trim can
 * arrive as one string naming both, and a model's summary joins several trims
 * with " / ". Comparing such a string to a chip with `===` fails on both.
 *
 * Compared as words rather than as a substring: a chip must match a whole
 * token, so "CNG" matches "Petrol + CNG" and "Petrol / CNG" but could never
 * match some future value that merely contains those letters. Splitting on
 * non-letters covers the separators people actually type — "+", "/", ",",
 * "-", "·" and spaces.
 */
export function hasFuel(fuel: string, wanted: string): boolean {
  const target = wanted.trim().toLowerCase();
  if (!target) return false;
  return fuel.toLowerCase().split(/[^a-z]+/).includes(target);
}

/**
 * Every fuel a model is sold with: the catalogue row's own value plus the
 * fuels of its published trims.
 *
 * REPORTED: ticking CNG on Browse emptied a grid whose cars are sold with
 * CNG, while the same filter on New Cars worked. New Cars reads the trims;
 * Browse read only `car.fuel`, the one hand-maintained value on the row. An
 * Alto K10 row says "Petrol" while its published trims include CNG, so
 * Browse filtered out precisely the models that have it.
 *
 * The row's own value stays in the set: it is what a model with no trims
 * entered yet has, and dropping it would hide those models instead.
 */
export function modelFuels(
  rows: { fuel?: string; variantFuels?: string[] }[],
): string[] {
  return [...new Set(
    rows.flatMap(c => [c.fuel ?? '', ...(c.variantFuels ?? [])])
      .map(f => f.trim())
      .filter(Boolean),
  )];
}
