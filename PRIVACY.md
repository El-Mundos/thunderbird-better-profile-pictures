# Privacy Policy — Better Profile Pictures

Better Profile Pictures shows a picture next to each message in Thunderbird:
the sender's photo, their organisation's logo, or their initials. This policy
describes every piece of data the add-on reads, stores and sends to find those
pictures.

## Summary

- The add-on has no server of its own, no analytics and no telemetry. Nothing
  is sent to the developers.
- To find pictures, it can contact the picture services listed below. What
  each one receives is either the sender's **domain** (the part after `@`) or
  a **SHA-256 hash** of their email address. Message contents, subjects and
  your own address are never sent.
- Every online source can be switched off individually, and a single privacy
  setting turns them all off.

## What the add-on reads

- **Message headers**: the sender and recipients of the messages listed in the
  folder you are viewing, to decide whose picture to show. For a few
  forwarding and alias services (Google Drive shares, DuckDuckGo Email
  Protection, Addy.io, SimpleLogin and Proton Pass) it reads extra headers of
  that message to find the original sender. In sent-mail folders it shows the
  recipient instead. All of this happens inside Thunderbird.
- **Address books**: photos stored in your contacts are used first, locally.

## What the add-on writes

When you create a new contact, the add-on looks up a picture for that address
through the same sources and, if it finds one, saves it as the contact's photo
in your address book. This can be turned off with the contacts integration
setting.

## What the add-on sends, and to whom

Only the sources enabled in the settings are contacted, in the order shown
there. Enabled by default:

| Source | Receives | Why |
|---|---|---|
| BIMI, via Cloudflare DNS-over-HTTPS (`cloudflare-dns.com`) | The sender's domain | Reads the brand logo the sender's organisation publishes in DNS |
| The server hosting that BIMI logo | A request for the logo | Downloads the logo the organisation chose; this server belongs to, or is chosen by, the sender |
| Gravatar (`gravatar.com`) | SHA-256 hash of the sender's email address | Finds the sender's personal photo |
| DuckDuckGo (`icons.duckduckgo.com`) | The sender's domain | Finds the organisation's icon |

Disabled by default, available in the settings: Libravatar (SHA-256 hash of
the address), Google favicons, Icon Horse and Splitbee (the domain), and a
favicon lookup that fetches the sender's own website.

Addresses at public mail providers (Gmail, Outlook and similar) are only
looked up by address hash, never by domain.

All requests use HTTPS. Like any web request, each one also reveals your IP
address to the service receiving it.

## What the add-on stores

Found pictures, and a record of lookups that found nothing, are cached in the
add-on's local storage inside your Thunderbird profile, so that each sender is
looked up once rather than every time. Entries expire after the period set in
the settings, and **Clear cache** in the settings deletes them all. Nothing is
stored anywhere else.

## Your choices

In the add-on's settings you can:

- switch each picture source on or off, and change their order;
- choose a **privacy mode**: *Off* (every enabled source), *Balanced* (only
  BIMI, so no picture service learns who you correspond with), or *Strict*
  (no network requests at all: address book photos and initials only);
- pin or hide the picture for specific senders or domains;
- clear the cache.

Removing the add-on deletes its settings and cache.

## Contact

Sergio Hernández (Kalos Tech) — sergio.hernandez@kalostech.es
Source code: https://github.com/El-Mundos/thunderbird-better-profile-pictures
