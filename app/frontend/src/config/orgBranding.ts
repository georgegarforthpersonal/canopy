/**
 * Per-organisation brand assets, keyed by org slug. Orgs listed here get the
 * co-branded auth layout: their logo headlines the card and Canopy moves to a
 * "Powered by Canopy" footer. Orgs without an entry (e.g. Cannwood, which has
 * no logo) get the Canopy lockup on top instead — exactly one brand ever owns
 * the top of the card.
 *
 * Hardcoded for the beta, like BETA_GROUPS; if orgs multiply this becomes an
 * uploadable Organisation field.
 */
import healLogo from '../assets/orgs/heal-logo.jpg';

const ORG_LOGOS: Record<string, string> = {
  heal: healLogo,
};

/** The org's logo asset URL, or null when the org has no logo. */
export function orgLogoUrl(orgSlug: string | null | undefined): string | null {
  return (orgSlug && ORG_LOGOS[orgSlug]) || null;
}
