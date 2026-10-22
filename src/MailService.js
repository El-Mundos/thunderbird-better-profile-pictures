import ICAL from "../libs/ical.js";
import Author from "./Author.js";

/**
 * Service for handling mail-related operations.
 */
class MailService {
  constructor(avatarService) {
    this.avatarService = avatarService;
    // Memoizes message.id -> Author so inbox-list re-renders (scroll, sort,
    // selection) don't re-run parseMailboxString / messages.getFull for every
    // row on every event. This is the main cause of scroll lag.
    this.correspondentCache = new Map();
    // Promise of the user's own addresses, normalized; see getOwnAddresses.
    this.ownAddresses = null;
  }

  /**
   * Normalizes an address the way Thunderbird does before comparing it with
   * the user's identities: lowercased, with any +tag dropped.
   * @param {string} email - The email address.
   * @returns {string} - The normalized address.
   */
  static normalizeAddress(email) {
    return (email || "").toLowerCase().replace(/\+[^@]*@/, "@");
  }

  /**
   * Retrieves the addresses of every identity on every account, loaded once
   * and reloaded after invalidateOwnAddresses().
   * @returns {Promise<Set<string>>} - The normalized addresses.
   */
  getOwnAddresses() {
    this.ownAddresses ??= (async () => {
      try {
        const identities = await browser.identities.list();
        return new Set(
          identities.map(({ email }) => MailService.normalizeAddress(email)),
        );
      } catch (_e) {
        return new Set();
      }
    })();
    return this.ownAddresses;
  }

  /**
   * Forgets the user's addresses after an identity changes, along with every
   * correspondent resolved against them.
   */
  invalidateOwnAddresses() {
    this.ownAddresses = null;
    this.correspondentCache.clear();
  }

  /**
   * Retrieves the correspondent for the given message, memoized by message id.
   * @param {Object} message - The message object.
   * @param {string} [context="inboxList"] - The context of the request.
   * @returns {Promise<Author>} - The correspondent.
   */
  async getCorrespondent(message, context = "inboxList") {
    const cacheKey = `${message.id}::${context}`;
    if (message.id != null && this.correspondentCache.has(cacheKey)) {
      return this.correspondentCache.get(cacheKey);
    }
    const author = await this.resolveCorrespondent(message, context);
    if (message.id != null) {
      // Soft cap to keep memory flat on very large folders.
      if (this.correspondentCache.size > 5000) {
        this.correspondentCache.clear();
      }
      this.correspondentCache.set(cacheKey, author);
    }
    return author;
  }

  /**
   * Retrieves the avatar URL for the given message.
   * @param {Object} message - The message object.
   * @param {string} [context="inboxList"] - The context of the request. (inboxList or messageHeader)
   * @returns {Promise<Object>} - The avatar URL.
   */
  async getUrl(message, context = "inboxList") {
    const author = await this.getCorrespondent(message, context);
    let url = await this.avatarService.getAvatar(author);
    if (context === "messageHeader" && !url) {
      url = await this.avatarService.buildInitials(author);
    }
    return { [author.getEmail()]: url };
  }

  /**
   * Retrieves the correspondent for the given message.
   * @param {Object} message - The message object.
   * @param {string} [context="inboxList"] - The context of the request. (inboxList or messageHeader)
   * @returns {Promise<Author>} - The correspondent's email address.
   */
  async resolveCorrespondent(message, context = "inboxList") {
    // A message the user sent is shown by who it went to, decided per message
    // like Thunderbird's Correspondent column. Not by folder: an Archive folder
    // can also be the Sent folder, and holds received mail too.
    if (context === "inboxList" && message.recipients.length > 0) {
      const sender = await Author.parse(message.author);
      const ownAddresses = await this.getOwnAddresses();
      if (ownAddresses.has(MailService.normalizeAddress(sender))) {
        return await Author.fromAuthor(message.recipients[0]);
      }
    }
    if (
      message.author.includes("drive-shares-noreply@google.com") ||
      message.author.includes("drive-shares-dm-noreply@google.com")
    ) {
      // proxy emails
      const fullMessage = await browser.messages.getFull(message.id);
      if (fullMessage.headers["reply-to"]) {
        return await Author.fromAuthor(fullMessage.headers["reply-to"][0]);
      }
      return await Author.fromAuthor(message.author);
    }

    const mail = await Author.fromAuthor(message.author);

    // Handle duck.com aliases
    if (mail?.getEmail().match(/@duck\.com$/)) {
      const fullMessage = await browser.messages.getFull(message.id);
      if (fullMessage.headers["duck-original-from"]) {
        return await Author.fromAuthor(
          fullMessage.headers["duck-original-from"][0],
        );
      }

      // Fallback to parsing the email address if header is not present
      const match = mail.getEmail().match(/^(.+)_at_(.+?)_.+@duck\.com$/);
      if (match) {
        return await Author.fromAuthor(`${match[1]}@${match[2]}`);
      }
    }

    // Handle Proton email aliases (passmail.com, passmail.net, passinbox.com, passfwd.com)
    if (
      mail
        ?.getEmail()
        .match(/@(passmail\.com|passmail\.net|passinbox\.com|passfwd\.com)$/)
    ) {
      const fullMessage = await browser.messages.getFull(message.id);
      if (fullMessage.headers["x-simplelogin-original-from"]) {
        return await Author.fromAuthor(
          fullMessage.headers["x-simplelogin-original-from"][0],
        );
      }

      // Fallback to parsing the email address if header is not present
      const email = mail.getEmail();
      const match = email.match(
        /^(.+)_[a-z0-9]+@(passmail\.com|passmail\.net|passinbox\.com|passfwd\.com)$/,
      );
      if (match) {
        const emailPart = match[1];
        const lastAtIndex = emailPart.lastIndexOf("_at_");
        if (lastAtIndex !== -1) {
          const userPart = emailPart.substring(0, lastAtIndex);
          const domainPart = emailPart.substring(lastAtIndex + 4); // Skip '_at_'
          // Convert underscores back to dots in the domain part
          const domain = domainPart.replace(/_/g, ".");
          return await Author.fromAuthor(`${userPart}@${domain}`);
        }
      }
    }

    // Handle addy.io aliases (anonaddy.me, addy.io, anonaddy.com)
    if (
      mail
        ?.getEmail()
        .match(/@([^.@]+\.)*(anonaddy\.me|addy\.io|anonaddy\.com)$/)
    ) {
      const fullMessage = await browser.messages.getFull(message.id);
      const originalHeader =
        fullMessage.headers["x-anonaddy-original-sender"] ||
        fullMessage.headers["x-addy-original-sender"];
      if (originalHeader) {
        return await Author.fromAuthor(originalHeader[0]);
      }

      // Fallback to parsing the email address if header is not present
      const email = mail.getEmail();
      const localPart = email.split("@")[0];
      const plusIndex = localPart.indexOf("+");
      if (plusIndex !== -1) {
        const encoded = localPart.substring(plusIndex + 1);
        const equalsIndex = encoded.lastIndexOf("=");
        if (equalsIndex !== -1) {
          const userPart = encoded.substring(0, equalsIndex);
          const domainPart = encoded.substring(equalsIndex + 1);
          if (userPart && domainPart) {
            return await Author.fromAuthor(`${userPart}@${domainPart}`);
          }
        }
      }
    }

    return mail;
  }

  /**
   * Retrieves the primary email address from the contact node.
   * @param {Object} contactNode - The contact node.
   * @returns {string|null} - The primary email address or null if not found.
   */
  getPrimaryEmail(contactNode) {
    const [component, jCard] = ICAL.parse(contactNode.properties.vCard);
    if (component !== "vcard") {
      return null;
    }

    const emailEntry = jCard.find((data) => data[0] === "email");
    if (!emailEntry) {
      return null;
    }

    return emailEntry[3];
  }
}

export default MailService;
