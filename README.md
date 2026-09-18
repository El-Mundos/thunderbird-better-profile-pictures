# Better Profile Pictures

A Thunderbird add-on that shows a picture for every sender — in the message
header, and optionally in the inbox list.

It is a fork of [Auto Profile Picture][upstream] 2.5.0 by Noam SCHMITT, rebuilt
around two things the original struggled with: **speed on large folders**, and
**control over what gets sent to third parties** when a picture is looked up
online.

[upstream]: https://astucesweb.fr/projets/auto-profile-picture/

## Why this fork exists

The original add-on is a good idea with a performance problem: it re-scanned
the whole inbox list on every message open, walked rows without a ceiling, and
re-resolved the same correspondent repeatedly. On a folder with a few thousand
messages that turns into a visibly unresponsive Thunderbird.

Noam's repository went offline while his GitHub account was suspended, so the
fixes had nowhere to go upstream. He was asked first and was happy for the work
to be forked and would like it merged back when he is able to.

## What changed

**Performance**

- The inbox list is no longer re-scanned on every message open.
- Avatars render from the viewport only, instead of the entire row set.
- Hard ceilings on rows walked per pass, so a large folder cannot stall the UI.
- Correspondent resolution is memoized per message.
- Recycled rows repaint from a main-process cache rather than refetching.
- Fixed a runaway folder scan triggered when `firstDisplayedMessageId` was NaN.

**Privacy**

- Online lookups are configurable: choose the sources, or restrict them with a
  privacy mode. BIMI, Gravatar and DuckDuckGo are on by default.
- Libravatar and the favicon-webpage fallback were dropped from the default
  chains. The latter downloaded a sender's whole homepage just to hunt for a
  `<link rel="icon">` tag — a lot of traffic, and an odd thing to do given an
  icon reads as a trust signal.

**Features**

- A configurable provider chain, so you choose which sources are tried and in
  what order.
- Per-sender rules to pin a specific picture or hide one entirely.
- Cache lifetimes you set yourself, for both hits and misses.
- Picture shape and initials colour.
- A rebuilt settings page.

## Install

No signed release is published yet. Build the `.xpi` yourself:

```bash
git clone https://github.com/El-Mundos/thunderbird-better-profile-pictures
cd thunderbird-better-profile-pictures
./build.sh
```

That writes `dist/better_profile_pictures-<version>.xpi`. In Thunderbird, go to
**Add-ons and Themes → the gear icon → Install Add-on From File**, and pick it.

The build is reproducible: it packages from `git ls-files`, sorted, with fixed
timestamps and `zip -X`, so two builds of the same tree are byte-identical.

Settings and cache do not carry over from the original — this is a separate
add-on with its own ID, so it installs alongside rather than upgrading.

Running it next to the original Auto Profile Picture no longer breaks anything:
every class, dataset key and element id is namespaced, so neither add-on
matches or removes the other's elements. You will still get two avatars in the
same place, because both insert into Thunderbird's own `.recipient-avatar`
container, so removing the original is still the sensible thing to do.

Requires Thunderbird 128 or later, and is capped at 157 because experiment APIs
track Thunderbird's internals and break on its release cycle. 157 is the newest
version upstream 2.5.1 was published for; 128 is the first ESR whose engine
supports the CSS `:has()` the cards-view layout relies on.

## Provenance

`auto_profile_picture-2.5.0-tb.xpi` and `auto_profile_picture-2.5.1-fast.xpi`
are kept in the repository on purpose. The first is the pristine upstream
release this fork started from; the second is the build the early performance
work reproduced byte-for-byte, which is what makes the history auditable rather
than merely plausible.

The commit history is intact from that 2.5.0 import onward, and every commit
message carries its reasoning.

## Licence

Mozilla Public License 2.0 — see [LICENSE](LICENSE).

Upstream work is Copyright (c) Noam SCHMITT, under the same licence. See
[NOTICE](NOTICE) for attribution, including two third-party components whose
headers were lost before this fork: `libs/ical.js` (a minified build of
[ICAL.js][icaljs], MPL-2.0) and the vendored [Pico CSS][pico] subset in the
settings stylesheet (MIT).

[icaljs]: https://github.com/kewisch/ical.js
[pico]: https://github.com/picocss/pico
