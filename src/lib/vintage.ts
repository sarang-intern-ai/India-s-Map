/**
 * Human-readable label for a boundary `year_stat` value from the source layer.
 *
 * This is presentation only — it never invents information. Unknown codes fall back to the
 * raw string so nothing is hidden, and a null vintage is reported as "Not recorded" rather
 * than guessed. The raw code is always returned alongside the label so the UI can surface
 * it verbatim.
 *
 * Observed codes in the dataset: 2011_c, 2012_c, 2014_c, 2015_c, 2016_c, 2017_c,
 * update2014, 2018, 2019, 201920, 2020, 2022, 2023, and null.
 */
export function vintageLabel(raw: string | null): { label: string; raw: string | null } {
  if (raw === null || raw.trim() === '') return { label: 'Not recorded', raw };

  const value = raw.trim();

  // "2011_c" → Census 2011 delineation.
  const census = /^(\d{4})_c$/.exec(value);
  if (census) return { label: `Census ${census[1]}`, raw };

  // "update2014" → an incremental update in that year.
  const update = /^update(\d{4})$/.exec(value);
  if (update) return { label: `Updated ${update[1]}`, raw };

  // "201920" → a financial-year span.
  const span = /^(\d{4})(\d{2})$/.exec(value);
  if (span) return { label: `${span[1]}–${span[2]}`, raw };

  // Plain year.
  if (/^\d{4}$/.test(value)) return { label: value, raw };

  return { label: value, raw };
}
