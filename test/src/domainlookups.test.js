import { expect } from "chai";
import DomainLookups from "../../src/DomainLookups.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("DomainLookups", () => {
  it("shares a lookup in flight", async () => {
    const lookups = new DomainLookups();
    let calls = 0;
    const lookup = async () => {
      calls++;
      await wait(10);
      return "picture";
    };
    const results = await Promise.all([
      lookups.run("bimi:x.org", lookup, 1000),
      lookups.run("bimi:x.org", lookup, 1000),
    ]);
    expect(calls).to.equal(1);
    expect(results).to.deep.equal(["picture", "picture"]);
  });

  it("remembers a miss for its lifetime", async () => {
    const lookups = new DomainLookups();
    let calls = 0;
    const lookup = async () => {
      calls++;
      return null;
    };
    await lookups.run("bimi:x.org", lookup, 1000);
    expect(await lookups.run("bimi:x.org", lookup, 1000)).to.equal(null);
    expect(calls).to.equal(1);
  });

  it("asks again once a miss has expired", async () => {
    const lookups = new DomainLookups();
    let calls = 0;
    const lookup = async () => {
      calls++;
      return null;
    };
    await lookups.run("bimi:x.org", lookup, 5);
    await wait(15);
    await lookups.run("bimi:x.org", lookup, 5);
    expect(calls).to.equal(2);
  });

  it("does not remember a picture, which the disk cache keeps", async () => {
    const lookups = new DomainLookups();
    let calls = 0;
    const lookup = async () => {
      calls++;
      return "picture";
    };
    await lookups.run("bimi:x.org", lookup, 1000);
    await lookups.run("bimi:x.org", lookup, 1000);
    expect(calls).to.equal(2);
  });

  it("does not remember a failure as a miss", async () => {
    const lookups = new DomainLookups();
    let calls = 0;
    const failing = async () => {
      calls++;
      throw new Error("offline");
    };
    await lookups.run("bimi:x.org", failing, 1000).catch(() => {});
    await lookups.run("bimi:x.org", failing, 1000).catch(() => {});
    expect(calls).to.equal(2);
  });

  it("keeps different providers and domains apart", async () => {
    const lookups = new DomainLookups();
    const seen = [];
    const lookup = (key) => async () => {
      seen.push(key);
      return null;
    };
    for (const key of ["bimi:x.org", "duckduckgo:x.org", "bimi:y.org"]) {
      await lookups.run(key, lookup(key), 1000);
    }
    expect(seen).to.have.length(3);
  });

  it("forgets everything when cleared", async () => {
    const lookups = new DomainLookups();
    let calls = 0;
    const lookup = async () => {
      calls++;
      return null;
    };
    await lookups.run("bimi:x.org", lookup, 1000);
    lookups.clear();
    await lookups.run("bimi:x.org", lookup, 1000);
    expect(calls).to.equal(2);
  });
});
