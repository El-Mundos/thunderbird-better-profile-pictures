import Provider, { Scope } from "../../providers/Provider.js";
import Author from "../Author.js";
import { domainLookups } from "../DomainLookups.js";
import ProfilePictureFetcher from "../ProfilePictureFetcher.js";
import { AvatarStrategy } from "./AvatarStrategy.js";

export class OnlineStrategy extends AvatarStrategy {
  /**
   * Creates an instance of OnlineStrategy.
   *
   * @param {ProfilePictureFetcher} fetcher - The fetcher object responsible for downloading images.
   * @param {Provider} provider - The provider object that supplies the URL and scope.
   * @param {Author} author - The author object containing email information.
   * @param {boolean} [shared=true] - Share the lookup with other correspondents
   *   at the same domain (see DomainLookups). Off for a URL that is not the
   *   provider's own answer for the domain, such as a pinned image.
   */
  constructor(fetcher, provider, author, shared = true) {
    super(fetcher);
    this.strategyName = provider.name;
    this.provider = provider;
    this.author = author;
    this.domain =
      provider.scope === Scope.DOMAIN ? author.getDomain() : author.getEmail();
    this.shared = shared && provider.scope === Scope.DOMAIN;
  }

  /**
   * Looks the picture up. Throws on failure, so a network error is not
   * remembered as a miss.
   * @returns {Promise<Blob|null>}
   */
  async lookup() {
    this.urlPromise = this.provider.getUrl(this.author);
    const url = await this.urlPromise;
    if (!url) {
      return null;
    }
    return await this.fetcher.downloadImage(
      url,
      this.domain,
      this.strategyName,
    );
  }

  async fetchAvatar() {
    try {
      if (!this.shared) {
        return await this.lookup();
      }
      return await domainLookups.run(
        `${this.strategyName}:${this.domain}`,
        () => this.lookup(),
        this.fetcher.refreshNotFoundMs,
      );
    } catch (error) {
      console.warn(
        `Error while downloading ${this.strategyName}`,
        error,
        this.urlPromise,
      );
    }
    return null;
  }
}
