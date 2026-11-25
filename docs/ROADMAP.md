# Samwise roadmap

What's planned after the original implementation plan
(`docs/superpowers/plans/2026-08-19-samwise.md`, all tasks done). Rough order; nothing
here is scheduled.

## Plant lookup from the web

Search the catalog for a plant you don't have yet (e.g. "šanta walker's low") and get a
draft plant to review and save, instead of typing everything in.

1. **Identify and pre-fill** (done, see the README's "Plant lookup"): a `plant-lookup` Edge Function finds the plant in
   Wikidata / Wikipedia (Czech and English, no API key), returns Czech, English and Latin
   names and a short description with a credit link (CC BY-SA), and pre-fills the
   "Add a custom plant" form. Nothing is saved without the user reviewing it. Results
   are cached. Cultivars missing from the sources fall back to their species, and the
   form says so.
2. **Care data** (to decide): sun, watering, flowering and pruning from a plant API.
   Candidate: Perenual (free plan: 100 requests/day, species IDs 1-3000 only, English;
   needs an API key, kept server-side only; check its terms first). Alternative:
   AI extraction of the facts from page text (costs or data-use terms to weigh).
3. **Nursery sites** (only with permission): e.g. Loukykvět has rich plant pages, but its
   copyright terms protect descriptions and photos, and systematically extracting its
   catalog could infringe its database right. Only with their written agreement, and
   only the facts, with a link back to the product page. **For now (agreed):** a plant
   just stores a link to such a page for the user to read (see "Richer plant data");
   Samwise doesn't read the page.

## Seasonal care rules for perennials

Done (migration 0012): yearly rules, "every year in July" / "každý rok v červenci". Each
gives a task due during the whole month (`tasks.due_until`), created 12 months ahead and
topped up nightly; it's overdue only after its month, shows as "This month" / "July 2027"
in the app and as a month-long, non-blocking event in Google Calendar. New task types for
perennials: divide, mulch, winter protection, cut back. A yearly rule can also name half
of its month (migration 0013): "every year in early May" (1st-15th) / "late May" (16th-last).

Possible follow-ups:
- "Every N years" (e.g. divide every 3 years), counted from the planting year.
- Seasonal rules for the built-in plants (they're vegetables and an annual flower today).
- A period other than a calendar month or its half ("early spring", "after the first bloom").

## Flowering calendar

A year overview showing when each plant flowers (and when it's harvested), month by
month. It relies on the seasons every plant can have:

- Done: `plants_catalog.flowering_months` and `harvest_months` (migration 0016), each a
  set of months 1-12, so a plant can flower or be harvested twice (catmint 'Walker's Low'
  again in September after cutting back; spinach in spring and autumn), also over the new
  year. Filled in for the built-in plants; edited on the plant page by clicking months.
- Done: the plant page shows both seasons as 12-month strips; the catalog shows one per
  plant, the harvest of vegetables, fruit and herbs, otherwise flowering.
- Later: harvest months of perennials (rhubarb, strawberries) could create a yearly
  harvest task.
- Plant lookup: sources often give only a season ("Spring"), so the months are the
  user's input or an approximate mapping, to confirm in the form.

## Richer plant data

Discuss and extend the plant attributes: e.g. height, spacing, soil, hardiness, flower
colour, perennial / annual, attracts pollinators. Decide what the app uses (filters,
tasks, the garden view) before adding columns.

- Done: **source link** (`source_url`), a link to a page describing the plant, e.g. its
  product page on a nursery site; edited and shown on the plant page.
- Done: editing your own plants (name, Latin name, sun, watering, flowering months, notes,
  source link), deleting their care rules, and deleting plants. A plant in a bed can't be
  deleted (the app says which bed); one planted only in the past goes together with those
  plantings and their completed tasks, also from the calendar (migration 0017).
- Done: **plant types** (migration 0015): life cycle (one of annual, biennial, perennial,
  bulb), growth form (one of herbaceous, subshrub, shrub, tree, climber) and uses (any of
  vegetable, fruit, herb, ornamental), as chips on the plant page and in the catalog, with
  catalog filters. Shrubs and trees have no life cycle. The catalog rows also show the sun,
  watering and flowering or harvest months at a glance.
- Possible next: suggest care from the type (e.g. offer seasonal rules for perennials), fill
  the types in from a lookup (Wikidata doesn't say how a plant is grown, so probably by hand).
- Done: changing a care rule updates the plant's upcoming tasks right away (migration
  0020); completed tasks stay.

## Plant photos

Done (migration 0014): several photos per plant, one main; uploads (shrunk, private
storage), links, and Wikimedia Commons pictures with their credit, also on built-in plants
(each user's own). Plants added from the lookup get the article's picture.

Possible follow-ups:
- Done: the main photo as a thumbnail in the plant catalog and in the garden grid's cells.
- A photo per planting (how it's doing this year), not just per plant.

## Going live

Frontend hosting, the hosted Supabase project (README sections 4 and 5), the Google
redirect URIs and authorized domains, and a plan for the free tier's pause after
inactivity (which stops the nightly task top-up).
