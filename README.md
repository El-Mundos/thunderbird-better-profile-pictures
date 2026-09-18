# Better Profile Pictures

A Thunderbird add-on that shows a picture for every sender — in the message
header, and optionally in the inbox list.

It is a fork of [Auto Profile Picture][upstream] 2.5.1 by Noam SCHMITT, rebuilt
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
git archive --format=zip -o better_profile_pictures.xpi HEAD
```

In Thunderbird, go to **Add-ons and Themes → the gear icon → Install Add-on
From File**, and pick `better_profile_pictures.xpi`.

The package is the committed tree minus the repository's own tooling, tests
and docs, which `.gitattributes` marks `export-ignore`. Every entry carries the
commit's timestamp, so building the same commit twice gives the same file.

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

The history carries upstream's own commits up to 2.5.0 (the merge of pull
request #25), recovered from a public fork after the original repository became
unreachable. 2.5.1 was published without its source, so the three commits that
follow were reconstructed from the package on addons.thunderbird.net; each says
so, and credits Noam SCHMITT as co-author. The fork's commits are replayed on
top with their original authors and dates, and where one had to be adapted to
2.5.1, its message ends with a replay note saying how.

The history was rebuilt this way by Clément Gayot, who also contributed the
security fixes listed in the [changelog](CHANGELOG.md).

Every commit message carries its reasoning.

## Licence

Mozilla Public License 2.0 — see [LICENSE](LICENSE).

Upstream work is Copyright (c) Noam SCHMITT, under the same licence. See
[NOTICE](NOTICE) for attribution, including two third-party components whose
headers were lost before this fork: `libs/ical.js` (a minified build of
[ICAL.js][icaljs], MPL-2.0) and the vendored [Pico CSS][pico] subset in the
settings stylesheet (MIT).

[icaljs]: https://github.com/kewisch/ical.js
[pico]: https://github.com/picocss/pico
