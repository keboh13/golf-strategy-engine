# Suppress AI-fabricated green data instead of always showing it

`GreenView` currently always renders a green shape by merging real OSM polygon data (when available) with `h.green` — a pin position, slope, and tier count the recommendation model invents fresh on every plan generation, since no real pin-sheet data source exists. This made every hole-by-hole view look "complete" even when most of what was shown (pin, slope, tiers) was fabricated and would change on the next regeneration.

Decided (2026-07-23): stop displaying green pin/slope/tier information for a hole unless it comes from a real source (`hzDesign` or `osmDesign`-derived measurement). No AI-invented fallback shape. An empty/partial green view is preferred over a confident-looking fabricated one, because the recommendation engine's value depends on the user trusting the data is real.

Implementation is scoped as a separate pass from the PDF-pipeline fix (see `hzDesign` extraction work) — this ADR records the decision, not the rollout.
