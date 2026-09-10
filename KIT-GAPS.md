# Kit gaps — `horizonContext.ui`

Components this app reached for and did not find, what it used instead, and
what that cost. Recorded while building, when the reasoning was still live.

**Please share this file** with the Horizon SDK team — it is the input that
decides what gets added to the host UI kit.

## An image

- **Reached for:** `ui.Image` (a themed `<img>` with object-fit, a loading
  state and an `onError` fallback)
- **Used instead:** `<Box component='img' … onError={…} sx={{ objectFit:
  'contain' }} />` in `src/components/PokemonCard.tsx` and
  `src/components/PokemonDetail.tsx`
- **Cost:** each call site owns its own fallback chain (official artwork ->
  front sprite -> `mdi:pokeball` glyph) as component state — about 15 lines
  duplicated across two files. No behaviour lost; `Box` is the sanctioned bare
  primitive and an image carries no theme colours, so nothing drifts on the
  dark/light toggle.
- **Would have been solved by:** `<Image src fallbackSrc alt fit='contain' />`,
  or an `Avatar` that accepts `variant='square'` with a sizing prop and its own
  fallback slot.

## A meter / progress bar

- **Reached for:** `ui.LinearProgress` (or a `Meter`) for the base-stat bars
- **Used instead:** two nested `Box`es — a track at
  `bgcolor='background.elevation1'` and a fill at `bgcolor='primary.main'` with
  a percentage width — in `src/components/PokemonDetail.tsx`
- **Cost:** ~15 lines, and the app now owns the one decision a kit component
  would have made for it (the 255 stat ceiling is fine; the bar's height,
  radius and colour are choices that will drift from the platform's own
  progress indicators when those are restyled). Both colours are palette paths,
  so it does follow the toggle.
- **Would have been solved by:** `<Meter value={n} max={255} tone='primary' />`
  — the same `tone` vocabulary the dashboard figures already use.

## A loading placeholder

- **Reached for:** `ui.Skeleton`
- **Used instead:** a `Typography` line ("Loading the Pokedex...") in
  `src/pages/PokemonPage.tsx`
- **Cost:** the grid pops in rather than resolving from a wireframe, so the
  page jumps on first paint. `DatagridTemplate` has a `loading` prop and the
  widget catalogue draws category wireframes, so the host clearly owns this
  pattern — it is just not reachable from a page that isn't a grid.
- **Would have been solved by:** `<Skeleton variant='rect' />`, or exposing the
  wireframe the widget frame already draws.

## Client-side pagination outside a grid

- **Reached for:** the `DatagridTemplate` footer, for a card grid
- **Used instead:** a `Load more` `Button` that raises a visible-count state,
  60 at a time (`src/pages/PokemonPage.tsx`)
- **Cost:** small — arguably the better interaction for a card wall. Noted
  because pagination is otherwise only available by adopting the whole grid
  template.
- **Would have been solved by:** a standalone `Pagination` / `usePagination`
  the templates and a hand-laid-out page could share.
