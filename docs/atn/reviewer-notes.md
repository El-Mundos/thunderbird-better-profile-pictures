# Notes for the ATN reviewer

Paste into "Notes to Reviewer" on upload.

---

Hello, and thanks for reviewing.

**What it is.** Better Profile Pictures shows a picture for each sender in the
message header and in the message list (table and cards views). It is a fork
of Auto Profile Picture by Noam SCHMITT (MPL-2.0), with its own name and ID
(`better-profile-pictures@kalostech.es`). The code differs substantially: a
viewport-only rendering pipeline for large folders, a configurable provider
chain with privacy modes, per-sender rules, a new settings page, and security
hardening (below). The original author was informed before this submission;
the original add-on remains listed and maintained separately.

**Why an Experiment API.** `api/headerApi.js` exists because no WebExtension
API can draw into the message list rows or add an image to the message header
pane. It is limited to that:

- `getVisibleRowMessages`, `paintRowAvatars`, `installEventListeners`,
  `setAvatarStyle`: read the rows currently rendered in `threadTree`, paint an
  avatar element into them, and listen for scroll/view changes so newly
  rendered rows get painted. Only the rows on screen are touched.
- `pictureHeaders`, `pictureHeadersConversation`: the same for the message
  header and the Thunderbird Conversations view.

Those six functions are the whole Experiment; the older whole-folder rendering
path it replaced has been removed rather than left unused.

What reaches the chrome document is only ever a raster image as a `data:` URL,
or initials text plus a colour. SVG pictures are rasterized to PNG in the
background page before being sent (`src/ImageConverter.js`), and
`headerApi.js` refuses any SVG that reaches it, so no sender-controlled markup
or styles enter a privileged document. Downloads must be `image/*` and at most
1 MB. BIMI logo URLs must be HTTPS on a public host name, with no port,
credentials or IP address.

**Permissions.**

- `messagesRead`: the sender and recipients of listed messages; for alias and
  forwarding services (DuckDuckGo, SimpleLogin/Proton Pass, Addy.io, Google
  Drive shares), one header of that message to find the real sender.
- `addressBooks`: use contact photos; optionally save a found picture to a
  newly created contact (a setting, described in the privacy policy).
- `accountsRead`: required for the `mailTabs` API (`onDisplayedFolderChanged`
  starts painting when a folder is opened). The accounts API itself is not
  called.
- `storage`: settings and the picture cache.
- `<all_urls>`: BIMI logos are hosted wherever each organisation chooses.

**Network requests.** Listed in full in the privacy policy. By default:
Cloudflare DNS-over-HTTPS (sender's domain, for BIMI), the BIMI logo host,
Gravatar (SHA-256 of the address), DuckDuckGo icons (sender's domain). Every
source can be disabled, and the Strict privacy mode disables all network
requests. There is no telemetry and no server of our own.

**Source and build.** Nothing is minified or transpiled. `libs/ical.js` is the
official unminified ICAL.js 2.2.1 build, unmodified. The package is the
repository's tracked files minus development-only paths (see
`.gitattributes`), built with:

    git clone https://github.com/El-Mundos/thunderbird-better-profile-pictures
    cd thunderbird-better-profile-pictures
    git checkout v2.6.0
    git archive --format=zip -o better_profile_pictures-2.6.0.xpi v2.6.0

**Testing.** Install, open any folder with a few hundred messages: pictures
appear in the list and in the header. Settings are under the add-on's Options.
Mail from a bank or large company usually shows its BIMI logo. Switching the
privacy mode to Strict stops all network requests.

Contact: sergio.hernandez@kalostech.es
