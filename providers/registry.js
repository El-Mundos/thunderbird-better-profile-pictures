/**
 * Single source of truth describing every avatar provider.
 *
 * ProviderFactory, the default settings, the lookup chains and the options UI
 * all read from this list, so adding a provider means adding one entry here
 * rather than touching four files.
 *
 * @typedef {Object} ProviderDescriptor
 * @property {string} id - Provider id, matching ProviderFactory.createProvider.
 * @property {string} labelKey - _locales message key for the display name.
 * @property {"email"|"domain"} kind - What the provider looks the avatar up by.
 *   "email" providers hash or query a specific address and are the only ones
 *   meaningful for public mail hosts: a domain lookup on gmail.com returns
 *   Gmail's own logo for every sender, which is why the public chain has always
 *   been restricted to them.
 * @property {boolean} thirdParty - Whether resolving sends the correspondent's
 *   address or domain to a service unrelated to the sender. BIMI and the
 *   favicon scraper talk only to the sender's own domain; everything else
 *   discloses who you are receiving mail from to an outside party.
 * @property {boolean} slow - Whether a miss is expensive. Currently only the
 *   favicon scraper, which fetches and parses a full page.
 */

/** @type {Array<ProviderDescriptor>} */
export const PROVIDERS = [
  {
    id: "bimi",
    labelKey: "providerBimi",
    kind: "domain",
    thirdParty: false,
    slow: false,
  },
  {
    id: "gravatar",
    labelKey: "providerGravatar",
    kind: "email",
    thirdParty: true,
    slow: false,
  },
  {
    id: "libravatar",
    labelKey: "providerLibravatar",
    kind: "email",
    thirdParty: true,
    slow: false,
  },
  {
    id: "duckduckgo",
    labelKey: "providerDuckDuckGo",
    kind: "domain",
    thirdParty: true,
    slow: false,
  },
  {
    id: "google",
    labelKey: "providerGoogle",
    kind: "domain",
    thirdParty: true,
    slow: false,
  },
  {
    id: "iconhorse",
    labelKey: "providerIconHorse",
    kind: "domain",
    thirdParty: true,
    slow: false,
  },
  {
    id: "splitbee",
    labelKey: "providerSplitbee",
    kind: "domain",
    thirdParty: true,
    slow: false,
  },
  {
    id: "favicon_webpage",
    labelKey: "providerFaviconWebpage",
    kind: "domain",
    thirdParty: false,
    slow: true,
  },
];

/**
 * Looks up a provider descriptor by id.
 * @param {string} id
 * @returns {ProviderDescriptor|undefined}
 */
export function getProviderDescriptor(id) {
  return PROVIDERS.find((provider) => provider.id === id);
}

/**
 * Reconciles a stored provider list against the registry.
 *
 * Stored settings are written once and read for years, so they drift: a
 * provider added in a later release is missing from them, and a provider
 * removed from the registry lingers. Drop unknown ids and append any registry
 * entries the stored list has never seen (disabled, so a new provider never
 * silently starts making requests on upgrade).
 *
 * @param {Array<{id: string, enabled: boolean}>} stored - Possibly stale list.
 * @returns {Array<{id: string, enabled: boolean}>} Reconciled list.
 */
export function reconcileProviderList(stored) {
  const known = Array.isArray(stored)
    ? stored.filter((entry) => entry && getProviderDescriptor(entry.id))
    : [];
  const seen = new Set(known.map((entry) => entry.id));
  const added = PROVIDERS.filter((provider) => !seen.has(provider.id)).map(
    (provider) => ({ id: provider.id, enabled: false }),
  );
  return [...known, ...added];
}
