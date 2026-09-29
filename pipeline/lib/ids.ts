/**
 * Canonical identifier derivation. See docs/DECISIONS.md D-003.
 *
 * LGD codes are the only join keys in this project. District and state NAMES are display
 * values and must never be used to key, join, index or look anything up. Verified name
 * instability in the live data:
 *   Anupgarh / Anoopgarh · Sanchore / Sanchor · Jaipur Rural / Jaipur Gramin
 */

export const UNADMINISTERED_PREFIX = 'unadministered:';

/**
 * Two features in the source carry dist_lgd = 0: Mirpur (dtcode11 991) and Muzaffarabad
 * (dtcode11 992), both in Jammu & Kashmir. These are districts in Pakistan-administered
 * Kashmir; LGD assigns no code to territory it does not administer. That is correct
 * upstream behaviour, not a defect, and we must not invent codes for them.
 */
export function toDistrictId(distLgd: number, censusDistrictCode: string): string {
  if (Number.isInteger(distLgd) && distLgd > 0) return String(distLgd);
  const census = String(censusDistrictCode ?? '').trim();
  if (!census) {
    throw new Error(
      `Cannot derive a districtId: dist_lgd is ${distLgd} and dtcode11 is empty. ` +
        'Refusing to invent an identifier.',
    );
  }
  return `${UNADMINISTERED_PREFIX}${census}`;
}

export function isUnadministered(districtId: string): boolean {
  return districtId.startsWith(UNADMINISTERED_PREFIX);
}

export function toStateId(stateLgd: number): string {
  if (!Number.isInteger(stateLgd) || stateLgd <= 0) {
    throw new Error(`Invalid state_lgd: ${stateLgd}. Refusing to invent an identifier.`);
  }
  return String(stateLgd);
}
