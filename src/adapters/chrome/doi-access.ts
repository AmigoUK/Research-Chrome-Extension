/**
 * Host access for the DOI registry lookup, shared by every caller that
 * resolves a DOI (Import by DOI, and Refresh from DOI on an already-filed
 * source): `doi.org` holds no metadata itself — it 303-redirects content
 * negotiation to whichever registration agency owns the record — so a lookup
 * can land on `data.crossref.org` or `data.datacite.org` as well as
 * `doi.org`. All three must be requested together, or a lookup that happens
 * to redirect to one Chrome hasn't granted yet fails with a raw fetch error.
 */
export const DOI_LOOKUP_ORIGINS = [
  'https://doi.org/*',
  'https://data.crossref.org/*',
  'https://data.datacite.org/*',
];

/** Ask for the DOI-lookup hosts. MUST be called from a user gesture. */
export async function requestDoiAccess(): Promise<boolean> {
  try {
    return await chrome.permissions.request({ origins: DOI_LOOKUP_ORIGINS });
  } catch {
    return false;
  }
}
