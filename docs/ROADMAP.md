# Samwise roadmap

What's planned after the original implementation plan
(`docs/superpowers/plans/2026-08-19-samwise.md`, all tasks done). Rough order; nothing
here is scheduled.

## Plant lookup from the web

Search the catalog for a plant you don't have yet (e.g. "šanta walker's low") and get a
draft plant to review and save, instead of typing everything in.

1. **Identify and pre-fill** (agreed): a `plant-lookup` Edge Function finds the plant in
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
   only the facts, with a link back to the product page. Without one, a plant can still
   store a link to such a page for the user to read.

## Seasonal care rules for perennials

Care rules currently count days from planting ("harvest 75 days after planting"), which
suits annual vegetables. Perennials need yearly, month-based care ("cut back after the
first bloom in July", "divide in early spring"), so a looked-up catmint gets facts but
almost no tasks today. Needs a seasonal rule type, task generation that repeats every
year (and the nightly top-up), and the rule form, the plant detail and the calendar
sync to handle it.

## Richer plant data

Discuss and extend the plant attributes: e.g. height, spacing, soil, hardiness, flower
colour and months, perennial / annual, attracts pollinators. Decide what the app uses
(filters, tasks, the garden view) before adding columns.

## Going live

Frontend hosting, the hosted Supabase project (README sections 4 and 5), the Google
redirect URIs and authorized domains, and a plan for the free tier's pause after
inactivity (which stops the nightly task top-up).
