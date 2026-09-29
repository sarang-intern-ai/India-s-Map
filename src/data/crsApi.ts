/**
 * Client for the CRS write-back API. Every mutation goes UI → API → Excel workbook → existing
 * sync → PostgreSQL; the frontend never writes PostgreSQL directly. `baseVersion` is the workbook
 * version the client last saw (from the `X-CRS-Version` header on the CRS list response) so the
 * server can reject a write that would clobber a newer external Excel edit (409 conflict).
 */

export type CrsSync = { status: string; inserted?: number; updated?: number; deleted?: number; unchanged?: number; message?: string };
export type CrsMutationOk = { ok: true; version: string; action: 'add' | 'update' | 'delete'; sourceKey: string; sync: CrsSync };
export type CrsMutationErr = { ok: false; status: number; code: string; error: string };
export type CrsMutationResult = CrsMutationOk | CrsMutationErr;

export type CrsAddBody = {
  districtId: string;
  crsName: string;
  organization?: string | null;
  location?: string | null;
  language?: string | null;
  hours?: number | null;
};
export type CrsEditBody = {
  crsName?: string;
  organization?: string | null;
  location?: string | null;
  language?: string | null;
  hours?: number | null;
};

async function parse(res: Response): Promise<CrsMutationResult> {
  let body: Record<string, unknown> = {};
  try { body = (await res.json()) as Record<string, unknown>; } catch { /* empty/non-JSON */ }
  if (res.ok && body.ok) {
    return {
      ok: true,
      version: String(body.version ?? ''),
      action: body.action as CrsMutationOk['action'],
      sourceKey: String(body.sourceKey ?? ''),
      sync: (body.sync as CrsSync) ?? { status: 'unknown' },
    };
  }
  return { ok: false, status: res.status, code: String(body.code ?? 'error'), error: String(body.error ?? `HTTP ${res.status}`) };
}

export async function crsCreate(apiBase: string, body: CrsAddBody, baseVersion: string | null): Promise<CrsMutationResult> {
  const res = await fetch(`${apiBase}/crs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, baseVersion: baseVersion ?? undefined }),
  });
  return parse(res);
}

export async function crsUpdate(apiBase: string, sourceKey: string, fields: CrsEditBody, baseVersion: string | null): Promise<CrsMutationResult> {
  const res = await fetch(`${apiBase}/crs/${encodeURIComponent(sourceKey)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...fields, baseVersion: baseVersion ?? undefined }),
  });
  return parse(res);
}

export async function crsDelete(apiBase: string, sourceKey: string, baseVersion: string | null): Promise<CrsMutationResult> {
  const res = await fetch(`${apiBase}/crs/${encodeURIComponent(sourceKey)}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseVersion: baseVersion ?? undefined }),
  });
  return parse(res);
}

/** Fields the Speech workbook (Test- CRS - Datasheet.xlsx) owns on the CRS card. */
export type SpeechEditBody = { location?: string | null; language?: string | null; hours?: number | null };

/**
 * Update the Speech-workbook row that owns Location / Language/s / Speech Data (Hrs) for one CRS,
 * matched by canonical districtId + CRS name (+ organization). Flows UI → API → Speech Excel → sync
 * → PostgreSQL, isolated from the CRS(data).xlsx source.
 */
export async function crsSpeechUpdate(
  apiBase: string,
  match: { districtId: string; crsName: string; organization: string | null },
  fields: SpeechEditBody,
  baseVersion: string | null,
): Promise<CrsMutationResult> {
  const res = await fetch(`${apiBase}/crs-speech`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...match, ...fields, baseVersion: baseVersion ?? undefined }),
  });
  return parse(res);
}

/** Current Speech-workbook version token (optimistic-concurrency baseVersion). */
export async function crsSpeechVersion(apiBase: string): Promise<string | null> {
  try {
    const res = await fetch(`${apiBase}/crs-speech/version`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: string };
    return body.version ?? null;
  } catch {
    return null;
  }
}
