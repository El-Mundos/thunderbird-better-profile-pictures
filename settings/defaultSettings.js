/**
 * Default settings for the application.
 * @type {Object}
 * @property {boolean} inboxListEnabled - Whether the inbox list feature is enabled. MUTABLE.
 * @property {boolean} contactsIntegrationEnabled - Whether the contacts integration feature is enabled. MUTABLE.
 * @property {Array<string>} publicMails - List of public mail domains.
 * @property {number} cacheRefreshNotFoundDays - Days before a "no picture" result is retried. 0 never retries.
 * @property {number} cacheRefreshFoundDays - Days before a saved picture is looked up again, so new BIMI records and logo changes are picked up. 0 keeps it indefinitely.
 * @property {number} WAIT_TIME_MS - Wait time in milliseconds for displaying the inbox list.
 * @property {number} SUBBATCH_SIZE - Size of the subbatch for processing messages.
 * @property {Array<{id: string, enabled: boolean}>} providers - Avatar providers in lookup order. MUTABLE.
 * @property {Array<{match: string, mode: string, url?: string}>} domainOverrides - Per-sender rules. MUTABLE.
 * @property {string} avatarShape - circle, rounded or square. MUTABLE.
 * @property {string} initialsColor - auto (derived from the address) or neutral. MUTABLE.
 * @property {string} privacyMode - One of PrivacyMode: off, balanced, strict. MUTABLE.
 */
const defaultSettings = {
  inboxListEnabled: true,
  contactsIntegrationEnabled: true,
  publicMails: [
    "gmail",
    "yahoo",
    "hotmail",
    "outlook",
    "aol",
    "protonmail",
    "yandex",
    "icloud",
    "gmx",
    "laposte",
    "sfr",
    "free",
    "bbox",
    "wanadoo",
    "orange.fr",
    "live",
    "msn",
    "yandex",
  ],
  // Expressed in days because that is the unit the settings UI offers and the
  // one a user reasons in. 0 means "never expire" for both.
  //
  // The not-found retry was briefly 1 day, which is a 30x increase in requests
  // to the picture sources for domains that will never resolve. A week keeps
  // newly-published BIMI records appearing promptly without that cost, and a
  // user who wants it sooner can now say so.
  cacheRefreshNotFoundDays: 7,
  cacheRefreshFoundDays: 14,
  WAIT_TIME_MS: 200,
  SUBBATCH_SIZE: 15,
  MAX_REQUEST_SIZE: 100,
  // Defaults to "off" so upgrading changes nobody's behaviour. A user who wants
  // the stricter modes opts in.
  privacyMode: "off",
  domainOverrides: [],
  avatarShape: "circle",
  initialsColor: "auto",
  // Avatar providers, in the order they are tried. Only enabled entries are
  // consulted, and the first hit wins, so order is a real behaviour knob:
  // earlier entries cost latency on every miss but win on every hit.
  //
  // The default keeps BIMI first (authoritative — the sender's own domain
  // publishes it, and it involves no third party), then Gravatar for
  // individuals, then DuckDuckGo for company logos. The rest ship disabled:
  // they are alternative sources for the same lookups, so enabling all of them
  // mostly adds round-trips to the miss path rather than finding more logos.
  providers: [
    { id: "bimi", enabled: true },
    { id: "gravatar", enabled: true },
    { id: "duckduckgo", enabled: true },
    { id: "google", enabled: false },
    { id: "libravatar", enabled: false },
    { id: "iconhorse", enabled: false },
    { id: "splitbee", enabled: false },
    { id: "favicon_webpage", enabled: false },
  ],
};

export default defaultSettings;
