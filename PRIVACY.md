# Samwise privacy policy

Samwise is a personal, non-commercial garden organizer. This page explains what
it does with your data.

## What Samwise stores

- **Your Google account's email address and basic profile** (name, picture),
  used only to sign you in.
- **Your garden data**: beds, plantings, custom plants, care rules and tasks
  that you create in the app.
- **If you connect Google Calendar**: an OAuth refresh token, and the id of the
  "Samwise" calendar that the app creates in your Google account.

The data is stored in a Supabase (PostgreSQL) database. Row-level security
makes each user's data accessible only to that user. The Google refresh token
is readable only by the app's server-side functions, never by the browser.

## What Samwise does with Google data

Samwise asks for the `calendar.app.created` permission. With it, Samwise can
only create its own "Samwise" calendar and manage the events on that calendar.
It can't see or change any of your other calendars or events.

Samwise uses this access only to put your garden tasks on the Samwise calendar.
It doesn't sell your data, share it with third parties, use it for
advertising, or use it to train AI models. Samwise's use of information received
from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements.

## Disconnecting and deleting

- **Disconnect Google Calendar** in Settings. This deletes the Samwise calendar
  from your Google account, revokes the token, and removes it from the database.
  You can also revoke access at any time at
  <https://myaccount.google.com/permissions>.
- **Delete your account and data:** open an issue at
  <https://github.com/Kajcin/Samwise/issues> and everything stored for you will
  be deleted.

## Changes

Changes to this policy are tracked in this repository's history.
