import { expect } from "chai";
import MailService from "../../src/MailService.js";

describe("MailService.getCorrespondent - addy.io aliases", () => {
  const mailService = new MailService({
    getAvatar: async () => null,
  });

  // getCorrespondent memoizes by message id, and the tests here reuse the
  // same id for different messages.
  beforeEach(() => {
    mailService.correspondentCache.clear();
  });

  it("should use x-anonaddy-original-sender header when present", async () => {
    const addyEmail = "nztka5rx+no-reply=amazon.com@anonaddy.me";
    const headerEmail = "original@sender.com";

    const msg = { author: addyEmail, id: 1, folder: {}, recipients: [] };
    globalThis.browser = {
      messages: {
        getFull: async () => ({
          headers: { "x-anonaddy-original-sender": [headerEmail] },
        }),
      },
    };
    const result = await mailService.getCorrespondent(msg);

    expect(result.getEmail()).to.equal(headerEmail);
  });

  it("should fallback to parsing when header is missing", async () => {
    const addyEmail = "nztka5rx+no-reply=amazon.com@anonaddy.me";
    const expectedEmail = "no-reply@amazon.com";

    const msg = { author: addyEmail, id: 1, folder: {}, recipients: [] };
    globalThis.browser = {
      messages: { getFull: async () => ({ headers: {} }) },
    };
    const result = await mailService.getCorrespondent(msg);

    expect(result.getEmail()).to.equal(expectedEmail);
  });

  it("should handle addy.io domain aliases", async () => {
    const addyEmail = "alias+support=example.org@addy.io";
    const expectedEmail = "support@example.org";

    const msg = { author: addyEmail, id: 1, folder: {}, recipients: [] };
    globalThis.browser = {
      messages: { getFull: async () => ({ headers: {} }) },
    };
    const result = await mailService.getCorrespondent(msg);

    expect(result.getEmail()).to.equal(expectedEmail);
  });

  it("should handle prefixed addy.io aliases", async () => {
    const addyEmail = "alias+no-reply=amazon.com@noam1234.anonaddy.me";
    const expectedEmail = "no-reply@amazon.com";

    const msg = { author: addyEmail, id: 1, folder: {}, recipients: [] };
    globalThis.browser = {
      messages: { getFull: async () => ({ headers: {} }) },
    };
    const result = await mailService.getCorrespondent(msg);

    expect(result.getEmail()).to.equal(expectedEmail);
  });

  it("should fallback to original for invalid addy.io pattern", async () => {
    const invalidAddyEmail = "nztka5rx@anonaddy.me";

    const msg = { author: invalidAddyEmail, id: 1, folder: {}, recipients: [] };
    globalThis.browser = {
      messages: { getFull: async () => ({ headers: {} }) },
    };
    const result = await mailService.getCorrespondent(msg);

    expect(result.getEmail()).to.equal(invalidAddyEmail);
  });
});
