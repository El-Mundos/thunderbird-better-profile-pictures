import Provider from "./Provider.js";

/**
 * Whether a BIMI logo location is safe to fetch.
 *
 * The location comes from the sender's DNS, so it is whatever they want it to
 * be, and it is fetched as soon as the message is listed. BIMI requires an
 * HTTPS URL; anything else is refused, as are the forms that only make sense
 * for reaching into the recipient's own network: IP literals, single-label,
 * .local and .localhost names, and non-default ports.
 *
 * This cannot stop a public name that resolves to a private address; that
 * would need resolving it first, which the add-on has no permission to do.
 *
 * @param {string} location - Value of the record's l= tag.
 * @returns {boolean}
 */
export function isAcceptableLogoUrl(location) {
  let url;
  try {
    url = new URL(location);
  } catch (_error) {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username) {
    return false;
  }
  // The URL parser has already normalised IPv4 spellings such as 0x7f.1 or
  // 2130706433 to dotted decimal, and wraps IPv6 in brackets.
  const host = url.hostname;
  if (host.startsWith("[") || /^\d+(\.\d+){3}$/.test(host)) {
    return false;
  }
  return (
    host.includes(".") &&
    !host.endsWith(".local") &&
    !host.endsWith(".localhost")
  );
}

/**
 * Extracts the logo location from a BIMI TXT record.
 *
 * DNS splits TXT data longer than 255 bytes into quoted strings that must be
 * joined without a separator, which is where a long logo URL gets cut.
 *
 * @param {string} record - TXT data as returned by DNS-over-HTTPS.
 * @returns {string|null} The l= value, or null if absent or empty.
 */
export function parseLogoLocation(record) {
  const joined = record.replace(/"\s*"/g, "").replace(/"/g, "");
  const tag = joined
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("l="));
  const location = tag?.slice(2).trim();
  return location || null;
}

export default class BimiProvider extends Provider {
  constructor(wdow) {
    super("BIMI");
    this.wdow = wdow;
  }

  async getUrl(mail) {
    const domain = mail.getDomain();
    if (!domain) return false;
    const name = encodeURIComponent(`default._bimi.${domain}`);
    const response = await this.wdow.fetch(
      `https://cloudflare-dns.com/dns-query?name=${name}&type=TXT`,
      { headers: { Accept: "application/dns-json" } },
    );
    const json = await response.json();
    const records = json.Answer;
    if (!records) return false;

    const bimiRecord = records
      .filter((record) => record.type === 16 && record.data.includes("BIMI"))
      .map((record) => record.data)
      .find(Boolean);

    if (!bimiRecord) return false;

    const location = parseLogoLocation(bimiRecord);
    if (!location || !isAcceptableLogoUrl(location)) return false;
    return location;
  }
}
