import { expect } from "chai";
import MailService from "../../src/MailService.js";

const OWN_EMAIL = "me@example.com";
const OTHER_EMAIL = "friend@example.org";

describe("MailService.getCorrespondent - outgoing messages", () => {
  const mailService = new MailService({
    getAvatar: async () => null,
  });

  // Later suites read the browser stub an earlier one left behind.
  let previousBrowser;
  before(() => {
    previousBrowser = globalThis.browser;
  });
  after(() => {
    globalThis.browser = previousBrowser;
  });

  beforeEach(() => {
    mailService.invalidateOwnAddresses();
    globalThis.browser = {
      identities: { list: async () => [{ email: "Me@Example.com" }] },
    };
  });

  it("shows the recipient of a message the user sent", async () => {
    const msg = {
      id: 1,
      author: `Me <${OWN_EMAIL}>`,
      recipients: [`Friend <${OTHER_EMAIL}>`],
      folder: { type: "sent" },
    };
    const result = await mailService.getCorrespondent(msg);
    expect(result.getEmail()).to.equal(OTHER_EMAIL);
  });

  it("shows the sender of a received message in a folder that is also Sent", async () => {
    // An Archive folder used as the Sent folder reports type "sent".
    const msg = {
      id: 2,
      author: `Friend <${OTHER_EMAIL}>`,
      recipients: [`Me <${OWN_EMAIL}>`],
      folder: { type: "sent" },
    };
    const result = await mailService.getCorrespondent(msg);
    expect(result.getEmail()).to.equal(OTHER_EMAIL);
  });

  it("shows the recipient of a sent message outside the Sent folder", async () => {
    const msg = {
      id: 3,
      author: `Me <${OWN_EMAIL}>`,
      recipients: [OTHER_EMAIL],
      folder: { type: "inbox" },
    };
    const result = await mailService.getCorrespondent(msg);
    expect(result.getEmail()).to.equal(OTHER_EMAIL);
  });

  it("ignores +tags and case, like Thunderbird", async () => {
    const msg = {
      id: 4,
      author: "me+lists@EXAMPLE.com",
      recipients: [OTHER_EMAIL],
      folder: {},
    };
    const result = await mailService.getCorrespondent(msg);
    expect(result.getEmail()).to.equal(OTHER_EMAIL);
  });

  it("keeps the author in the message header", async () => {
    const msg = {
      id: 5,
      author: OWN_EMAIL,
      recipients: [OTHER_EMAIL],
      folder: { type: "sent" },
    };
    const result = await mailService.getCorrespondent(msg, "messageHeader");
    expect(result.getEmail()).to.equal(OWN_EMAIL);
  });

  it("falls back to the author when identities cannot be read", async () => {
    globalThis.browser = {};
    const msg = {
      id: 6,
      author: OWN_EMAIL,
      recipients: [OTHER_EMAIL],
      folder: { type: "sent" },
    };
    const result = await mailService.getCorrespondent(msg);
    expect(result.getEmail()).to.equal(OWN_EMAIL);
  });
});
