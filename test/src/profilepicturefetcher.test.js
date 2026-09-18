import { expect } from "chai";
import { Scope } from "../../providers/Provider.js";
import Author from "../../src/Author.js";
import { domainLookups } from "../../src/DomainLookups.js";
import ProfilePictureFetcher from "../../src/ProfilePictureFetcher.js";

const HOUR = 3600 * 1000;
const CHAIN = [
  { id: "bimi", enabled: true },
  { id: "gravatar", enabled: true },
  { id: "duckduckgo", enabled: true },
];

/**
 * An in-memory storage.local, a fetch that serves `pictures` by URL (404
 * otherwise), and providers answering with predictable URLs. `requests`
 * records every URL fetched and every BIMI record asked for.
 */
function setup(pictures = {}) {
  const store = {};
  const requests = [];
  globalThis.browser = {
    storage: {
      local: {
        get: async (key) => (key in store ? { [key]: store[key] } : {}),
        set: async (items) => Object.assign(store, items),
        remove: async (key) => delete store[key],
      },
    },
  };
  globalThis.messenger = { contacts: { quickSearch: async () => [] } };
  const wdow = {
    fetch: async (url) => {
      requests.push(url);
      return url in pictures
        ? new Response(pictures[url], {
            headers: { "content-type": "image/png" },
          })
        : new Response("", { status: 404 });
    },
  };
  const providers = {
    bimi: {
      name: "bimi",
      scope: Scope.DOMAIN,
      getUrl: async (author) => {
        requests.push(`bimi-record:${author.getDomain()}`);
        return false;
      },
    },
    gravatar: {
      name: "gravatar",
      scope: Scope.EMAIL,
      getUrl: async (author) => `https://gravatar/${author.getEmail()}`,
    },
    duckduckgo: {
      name: "duckduckgo",
      scope: Scope.DOMAIN,
      getUrl: async (author) => `https://ddg/${author.getDomain()}`,
    },
  };
  const fetcherFor = async (address) => {
    const fetcher = new ProfilePictureFetcher(
      wdow,
      await Author.fromAuthor(address),
      "duckduckgo",
      false,
      {
        providers: CHAIN,
        refreshFoundMs: HOUR,
        refreshNotFoundMs: HOUR,
      },
    );
    for (const [id, provider] of Object.entries(providers)) {
      fetcher.providerInstances.set(id, provider);
    }
    return fetcher;
  };
  const cachePicture = async (key, source, bytes) => {
    store[`FILE_ICON_${key}.ico`] = new TextEncoder().encode(bytes).buffer;
    store[`ICON_${key}`] = JSON.stringify({
      path: `ICON_${key}.ico`,
      type: "image/png",
      ts: Date.now(),
      source,
    });
  };
  const cacheMiss = (key) => {
    store[`ICON_${key}`] = JSON.stringify({ type: "notFound", ts: Date.now() });
  };
  return { store, requests, fetcherFor, cachePicture, cacheMiss };
}

const text = async (blob) => (blob && blob !== "notFound" ? blob.text() : blob);
/** Lets the cache writes, which are not awaited, land. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("ProfilePictureFetcher.getDomainAvatar", () => {
  beforeEach(() => domainLookups.clear());

  it("looks up Gravatar even when the domain has no logo", async () => {
    const { requests, fetcherFor, cacheMiss } = setup({
      "https://gravatar/bob@x.org": "bob",
    });
    cacheMiss("x.org");

    const result = await (await fetcherFor("bob@x.org")).getDomainAvatar();

    expect(await text(result)).to.equal("bob");
    expect(requests).to.deep.equal(["https://gravatar/bob@x.org"]);
  });

  it("puts Gravatar first when it comes before the source of the domain's logo", async () => {
    const { requests, fetcherFor, cachePicture } = setup({
      "https://gravatar/bob@x.org": "bob",
    });
    await cachePicture("x.org", "duckduckgo", "logo");

    const result = await (await fetcherFor("bob@x.org")).getDomainAvatar();

    expect(await text(result)).to.equal("bob");
    // BIMI comes before the favicon in the chain, so it had already missed.
    expect(requests).to.deep.equal(["https://gravatar/bob@x.org"]);
  });

  it("falls back to the domain's logo and remembers the person's miss", async () => {
    const { store, requests, fetcherFor, cachePicture } = setup();
    await cachePicture("x.org", "duckduckgo", "logo");

    const first = await (await fetcherFor("bob@x.org")).getDomainAvatar();
    await flush();
    const second = await (await fetcherFor("bob@x.org")).getDomainAvatar();

    expect(await text(first)).to.equal("logo");
    expect(await text(second)).to.equal("logo");
    expect(JSON.parse(store["ICON_bob@x.org"]).type).to.equal("notFound");
    // Only the first lookup asked Gravatar.
    expect(requests).to.deep.equal(["https://gravatar/bob@x.org"]);
  });

  it("takes a BIMI logo before Gravatar, as the chain says", async () => {
    const { requests, fetcherFor, cachePicture } = setup({
      "https://gravatar/bob@x.org": "bob",
    });
    await cachePicture("x.org", "bimi", "bimi-logo");

    const result = await (await fetcherFor("bob@x.org")).getDomainAvatar();

    expect(await text(result)).to.equal("bimi-logo");
    expect(requests).to.deep.equal([]);
  });

  it("returns a person's own cached picture without a request", async () => {
    const { requests, fetcherFor, cachePicture } = setup();
    await cachePicture("bob@x.org", "gravatar", "bob");

    const result = await (await fetcherFor("bob@x.org")).getDomainAvatar();

    expect(await text(result)).to.equal("bob");
    expect(requests).to.deep.equal([]);
  });

  it("records the person's and the domain's miss, not the parent's", async () => {
    const { store, fetcherFor } = setup();

    const result = await (await fetcherFor("bob@mail.x.org")).getDomainAvatar();
    await flush();

    expect(result).to.equal("notFound");
    expect(JSON.parse(store["ICON_bob@mail.x.org"]).type).to.equal("notFound");
    expect(JSON.parse(store["ICON_mail.x.org"]).type).to.equal("notFound");
    // A sibling subdomain may have a logo of its own.
    expect(store).to.not.have.property("ICON_x.org");
  });

  it("does not record the domain's miss when a later domain provider was not asked", async () => {
    const { store, fetcherFor } = setup({
      "https://gravatar/bob@x.org": "bob",
    });

    await (await fetcherFor("bob@x.org")).getDomainAvatar();
    await flush();

    // BIMI missed, Gravatar answered, the favicon was never asked.
    expect(store).to.not.have.property("ICON_x.org");
  });

  it("asks once for a domain shared by people looked up together", async () => {
    const { requests, fetcherFor } = setup({ "https://ddg/x.org": "logo" });

    const [alice, bob] = await Promise.all([
      (await fetcherFor("alice@x.org")).getDomainAvatar(),
      (await fetcherFor("bob@x.org")).getDomainAvatar(),
    ]);

    expect(await text(alice)).to.equal("logo");
    expect(await text(bob)).to.equal("logo");
    expect(requests.filter((r) => r === "bimi-record:x.org")).to.have.length(1);
    expect(requests.filter((r) => r === "https://ddg/x.org")).to.have.length(1);
  });

  it("asks once for a parent domain shared by sibling subdomains", async () => {
    const { requests, fetcherFor } = setup();

    await (await fetcherFor("a@impots.gouv.fr")).getDomainAvatar();
    await (await fetcherFor("b@ants.gouv.fr")).getDomainAvatar();

    expect(requests.filter((r) => r === "bimi-record:gouv.fr")).to.have.length(
      1,
    );
    expect(requests.filter((r) => r === "https://ddg/gouv.fr")).to.have.length(
      1,
    );
    // Each subdomain is still asked for itself.
    expect(requests).to.include("bimi-record:ants.gouv.fr");
  });
});
