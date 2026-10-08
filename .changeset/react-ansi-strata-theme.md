---
"@stratum-hq/react": minor
---

Add the ANSI Strata theme, the look of stratum-hq.org, as an opt-in stylesheet: `@stratum-hq/react/styles/theme-ansi-strata.css`, with its fonts in `@stratum-hq/react/styles/fonts-ansi-strata.css`. It draws double-rule frames, bracketed menu keys, state as a bracketed word, and one rock band per tenant depth. It keeps the same contract as the other stylesheets: every rule is in the `stratum` cascade layer, every token starts with `--stratum-`, and only the fonts file makes a request. `base.css` and the Bedrock theme are unchanged.
