import { expect } from "chai";
import Author from "../../src/Author.js";
import MessagesService from "../../src/MessagesService.js";

/**
 * Builds a MessagesService whose headerApi serves `passes` in turn: each
 * entry is the visible rows for one pass and what installEventListeners
 * answers after it. The last pass's listener never resolves, which ends the
 * loop the way a real, quiet inbox list would.
 */
function setup(
  passes,
  getAvatar = async (author) => `data:${author.getEmail()}`,
) {
  const calls = { paint: [], listen: [], visibleAt: [], order: [] };
  let pass = 0;
  globalThis.browser = {
    tabs: { query: async () => [{ id: 7 }] },
    headerApi: {
      setAvatarStyle: async () => ({ status: "success" }),
      getVisibleRowMessages: async () => {
        calls.visibleAt.push(Date.now());
        return passes[pass].rows;
      },
      paintRowAvatars: async (_tabId, json) => {
        calls.paint.push(JSON.parse(json));
        calls.order.push("paint");
        return { status: "success" };
      },
      installEventListeners: (_tabId, keysJSON) => {
        calls.listen.push(keysJSON);
        calls.order.push("listen");
        const answer = passes[pass].listener;
        pass++;
        return answer ? Promise.resolve(answer) : new Promise(() => {});
      },
    },
  };
  const mailService = {
    getCorrespondent: async (message) => Author.fromAuthor(message.author),
  };
  const avatarService = {
    getAppearance: async () => ({ shape: "circle" }),
    getAvatar,
    buildInitials: async () => ({ value: "XX" }),
  };
  return { service: new MessagesService(mailService, avatarService), calls };
}

const row = (index, key, author) => ({ index, key, message: { author } });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Lets a pass's lookups, paint batching and awaits run to the listener. */
const settle = () => wait(150);

describe("MessagesService.displayInboxList", () => {
  it("keys painted avatars by message, not by row index", async () => {
    const { service, calls } = setup([
      { rows: [row(3, "f:10", "a@x.org"), row(4, "f:11", "b@y.org")] },
    ]);
    service.displayInboxList(null);
    await settle();

    expect(calls.paint).to.have.length(1);
    expect(Object.keys(calls.paint[0])).to.have.members(["f:10", "f:11"]);
    expect(calls.paint[0]["f:10"].value).to.equal("data:a@x.org");
  });

  it("hands the resolved messages to the listener", async () => {
    const { service, calls } = setup([
      { rows: [row(0, "f:1", "a@x.org"), row(1, "f:2", "b@y.org")] },
    ]);
    service.displayInboxList(null);
    await settle();

    expect(JSON.parse(calls.listen[0])).to.have.members(["f:1", "f:2"]);
  });

  it("starts the next pass at once when rows went stale", async () => {
    const { service, calls } = setup([
      { rows: [row(0, "f:1", "a@x.org")], listener: "stale" },
      { rows: [row(40, "f:41", "c@z.org")] },
    ]);
    service.displayInboxList(null);
    await settle();

    expect(calls.visibleAt).to.have.length(2);
    // Well under WAIT_TIME_MS: the throttle is not waited out.
    expect(calls.visibleAt[1] - calls.visibleAt[0]).to.be.below(
      service.WAIT_TIME_MS,
    );
    expect(Object.keys(calls.paint[1])).to.deep.equal(["f:41"]);
  });

  it("still throttles passes started by an ordinary event", async () => {
    const { service, calls } = setup([
      { rows: [row(0, "f:1", "a@x.org")], listener: "click" },
      { rows: [row(0, "f:1", "a@x.org")] },
    ]);
    service.displayInboxList(null);
    await settle();

    expect(calls.visibleAt).to.have.length(1);
    // It runs once the throttle has passed. Waited for here so it does not
    // run during the next test, against that test's mocks.
    await wait(service.WAIT_TIME_MS);
    expect(calls.visibleAt).to.have.length(2);
  });

  it("paints a row as soon as it resolves, not after the slowest", async () => {
    const { service, calls } = setup(
      [{ rows: [row(0, "f:1", "fast@x.org"), row(1, "f:2", "slow@y.org")] }],
      async (author) => {
        if (author.getEmail() === "slow@y.org") {
          await wait(80);
        }
        return `data:${author.getEmail()}`;
      },
    );
    service.displayInboxList(null);
    await settle();

    // Each row is painted once, with its final value.
    expect(calls.paint.map((payload) => Object.keys(payload))).to.deep.equal([
      ["f:1"],
      ["f:2"],
    ]);
  });

  it("paints rows that settle together in one call", async () => {
    const { service, calls } = setup([
      {
        rows: [
          row(0, "f:1", "a@x.org"),
          row(1, "f:2", "b@y.org"),
          row(2, "f:3", "c@z.org"),
        ],
      },
    ]);
    service.displayInboxList(null);
    await settle();

    expect(calls.paint).to.have.length(1);
  });

  it("re-arms the listener without waiting for a slow lookup", async () => {
    let release;
    const { service, calls } = setup(
      [{ rows: [row(0, "f:1", "fast@x.org"), row(1, "f:2", "slow@y.org")] }],
      (author) =>
        author.getEmail() === "slow@y.org"
          ? new Promise((resolve) => {
              release = resolve;
            })
          : Promise.resolve(null),
    );
    service.displayInboxList(null);
    await settle();

    // Listening while the slow row is still pending, so a scroll is heard.
    expect(calls.listen).to.have.length(1);
    expect(calls.paint.map((payload) => Object.keys(payload))).to.deep.equal([
      ["f:1"],
    ]);

    release(null);
    await settle();
    // No picture found: initials, still painted once per row.
    expect(calls.paint[1]["f:2"].value).to.equal("XX");
  });

  it("still paints a lookup that settles after the next pass began", async () => {
    let release;
    const { service, calls } = setup(
      [
        { rows: [row(0, "f:1", "slow@y.org")], listener: "stale" },
        { rows: [row(40, "f:41", "c@z.org")] },
      ],
      (author) =>
        author.getEmail() === "slow@y.org"
          ? new Promise((resolve) => {
              release = resolve;
            })
          : Promise.resolve(`data:${author.getEmail()}`),
    );
    service.displayInboxList(null);
    await settle();
    expect(calls.visibleAt).to.have.length(2);

    release("data:slow@y.org");
    await settle();
    const painted = Object.assign({}, ...calls.paint);
    expect(painted["f:1"].value).to.equal("data:slow@y.org");
    expect(painted["f:41"].value).to.equal("data:c@z.org");
  });
});
