# Samwise design rules

Rules for anyone changing the UI, people or coding agents, so every page looks and works
the same. When a rule here and the code disagree, follow the existing code and fix this
file. When a new pattern is needed, add it here in the same change.

## Building blocks

- **Bootstrap 5.3, CSS only.** Never load Bootstrap's JavaScript. Dropdowns, collapses and
  dialogs are driven by signals in the component. `src/styles.scss` imports only the Sass
  modules in use: add a module there before using its classes.
- **Theme:** garden greens from `src/styles.scss` (`$primary` #3b6e22, links #2f5a1b,
  nav background #f4f7ec, page #fbfcf8). Use Bootstrap's classes and variables, never new
  hex colours in components. Colours with a meaning (the plant-type chips, sun, water,
  flowering) are defined once in `styles.scss` and reused by class.
- **Icons:** `<app-icon name="…" />`, Bootstrap Icons as inline SVG. Add an icon to
  `scripts/generate-icons.mjs` and run `npm run icons`. No icon fonts, no emoji, no images
  for icons. An icon next to text is decorative; an icon-only button needs `aria-label`
  and `title`.
- **Shared components:** before writing markup, look for one that exists:
  `app-modal` (dialogs), `ConfirmDialogService` (confirmations), `app-loading` and
  `app-spinner` (waiting), `app-plant-chips`,
  `app-month-strip` (a season's months, shown or picked), `app-plant-traits-fields`,
  `app-plant-photos`.

## Page layout

- Each page is `<main class="container pb-5">`.
- Title row: `d-flex flex-wrap justify-content-between align-items-center gap-2 mb-4`, the
  `<h1 class="mb-0">` on the left and the page's main action on the right as
  `btn btn-primary` with a `plus-lg` icon ("+ Přidat rostlinu").
- Content in cards (`section.card`). A card's own action sits right of its title as
  `btn btn-sm btn-outline-primary` with an icon: "Upravit" (`pencil`), "+ Přidat"
  (`plus-lg`).
- Lists are `list-group`. Rows wrap (`flex-wrap`) and keep fixed-width slots for
  facts and buttons, so columns line up from row to row.
- Every page works at 390 px wide: things wrap or stack, nothing scrolls sideways.
  Check 1280 px and 390 px.

## Dialogs

- Forms that add things open in a dialog, never inline on the page:
  `<app-modal [open]="…" [title]="…" (closed)="close…()">`.
- Inside: `@if (dialogOpen()) { <form novalidate (submit)="…"> }` with a `.modal-body`
  and a `.modal-footer justify-content-between`. The `@if` makes the fields start fresh
  each time the dialog opens.
- Footer buttons: on the left `btn btn-outline-secondary close-dialog` "Zavřít"
  (`common.close`), on the right the submit `btn btn-primary` "Uložit …" ("Uložit
  rostlinu", "Uložit pravidlo"), text only, no icon.
- ✕ and Escape close without saving; a click outside does nothing. Closing drops what was
  typed.
- A long body scrolls; the title and the buttons stay in view. An error appears as the
  last thing in `.modal-body` and is scrolled into view. Both are built into `app-modal`
  and `styles.scss`: keep the form > `.modal-body` + `.modal-footer` structure and they
  just work.
- Close the dialog before navigating away after saving.
- Confirmations (deleting, disconnecting) go through `ConfirmDialogService.ask()`, never
  `window.confirm`. Destructive ones pass `danger: true`; Cancel has the focus first.

## Forms

- `novalidate` on every form; validation is a pure function returning a `Message` (or
  `null`) that's unit tested, and the message is shown in
  `.alert.alert-danger[role=alert]`.
- Every field has a visible `<label class="form-label">`; `form-control`, `form-select`,
  `form-check`. Groups of checkboxes are a `fieldset` with a `legend`.
- An optional select starts with an empty option "—" (`plant.notSet`).
- Fields that depend on each other say why when disabled (`form-text`), e.g. shrubs have
  no life cycle.
- Mirror database checks in the form, so people get a translated message, not a database
  error.

## Actions and buttons

- Real `<button type="button">` for actions, `<a>` only for navigation.
- Primary action `btn-primary`; secondary `btn-outline-primary` or
  `btn-outline-secondary`; cancel/close `btn-outline-secondary`.
- Deleting: a `trash` icon button (`btn-outline-danger`) on detail pages, an `x-circle`
  icon (`btn-link text-danger`) in list rows; always confirmed. Built-in items can't be
  deleted, so they show no delete button.
- Toggle buttons use `aria-pressed`; buttons opening a panel use `aria-expanded` and
  `aria-controls`.
- Disable a button while its action runs (`[disabled]="saving()"`).

## Chips, badges and status

- Plant types: `.plant-chip` plus `.chip-<life cycle>` (filled, own colour),
  `.chip-form` (grey), `.chip-use` (outlined). Use `app-plant-chips`, don't rebuild them.
- Filters: `.filter-pill` buttons with `aria-pressed`; active filters as removable chips.
- Every chip and icon with a meaning also has text (visible, `title`, or
  `visually-hidden`): colour is never the only cue.
- Status messages: `alert-success`/`alert-info` with `role="status"`, problems
  `alert-danger`/`alert-warning` with `role="alert"`.
- Empty states say what to do next and offer the button or link for it.

## Waiting

Never leave people guessing whether something is happening.

- **A wait of unknown length** (a page loading its data, a web search, connecting the
  calendar): `<app-loading [text]="…" />`, a spinner with a line such as "Načítání
  rostlin…" (`role="status"`, so screen readers hear it).
- **A button whose action runs** (saving, deleting, searching, connecting): disable it,
  set `[attr.aria-busy]`, and show `<app-spinner class="me-1" />` in place of its icon
  (or before the text of a text-only button). Only the clicked button spins; the others
  that would conflict are disabled. A form's submit button is disabled while it saves, so
  nothing is saved twice.
- **A wait whose progress is known** (uploading several photos): a Bootstrap
  `.progress` bar with the count in text ("Nahrávání 2 z 3…").
- The data that's already there stays visible while more loads; don't blank the page.
- Extras that fail (thumbnails, photos) fall back to a placeholder and are only logged;
  the page still works.

## Texts and languages

- Every UI text lives in `src/i18n/en.json` and `src/i18n/cs.json` with the same keys;
  never hard-code text in a template. English is the fallback language.
- Plurals use ICU messages; Czech always spells out `one`, `few` and `other` (a test
  checks it). Placeholders match between the two files.
- Czech labels in sentence case. Verbs: "Přidat …", "Uložit …", "Upravit", "Zavřít",
  "Zrušit", "Smazat …".
- What people type (plant names, notes) is shown as typed, not translated. Built-in plants
  have Czech texts in `name_cs`/`notes_cs`.
- Prefer forms that read the same in every language over abbreviations (the month
  strip numbers its months 1.–12.).
- Months: a season is a set of months, shown and picked with `app-month-strip`; in text,
  runs of months read "květen až září, listopad" (`describeMonths`).

## Accessibility

- Text contrast at least 4.5:1, icons and chips 3:1.
- Keyboard: everything reachable with Tab, visible focus, Escape closes dialogs, focus
  goes into a dialog on opening and back on closing.
- Touch targets about 40 px high at least.
- Images have `alt` text (or `alt=""` when the text next to them says the same).

## Checking a change

- Unit tests for each component and pure function (`npm run test:app`, Karma/Jasmine);
  test behaviour through the DOM the way a person uses it.
- Look at it in the browser at 1280 px and 390 px, in Czech and English, with long texts
  and with errors showing.
- **Never reset the local database.** It holds the owner's real data. Apply migrations
  with `npx supabase migration up`; run SQL tests one file at a time with
  `npm run db:psql -- -f supabase/tests/sql/<file>`. `npm run test:sql` resets the
  database first, so it refuses while there are accounts.
