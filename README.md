# Horizon Pokemon App

A Horizon federated app (Webpack Module Federation remote, built with
[`@netsapiens/horizon-sdk`](https://www.npmjs.com/package/@netsapiens/horizon-sdk))
that adds a **Pokemon** page to the Horizon portal's **Apps** menu, alongside
**Example CRM** from [`horizon-sdk-demo`](https://github.com/netsapiens/horizon-sdk-demo).

Its data source is public, so it is about the smallest end-to-end demonstration
there is that a third party can ship a page into Horizon: static files on a
CDN, one registration row, no server-side component anywhere.

- Search the whole Pokedex by name or dex number. The index (~1,300 rows) is
  fetched once from PokeAPI and filtered client-side, so typing costs nothing.
- A responsive card grid pages in 60 at a time. Card artwork is addressed
  directly on the sprite CDN by dex number, so a full grid costs **zero** API
  calls.
- Clicking a card opens a detail panel above the grid: official artwork, the
  English Pokedex entry, genus, types, height/weight, abilities and base stats.
- **Set as my avatar** on the detail panel uploads that artwork as the
  signed-in user's avatar, through the host's audited API proxy.
- Every visible element comes from `horizonContext.ui`, so the page re-themes
  live with the portal's dark/light toggle.

## Architecture

```
Browser (https://<portal>/apps/pokemon)
  └─ Horizon host loads the remote from the CDN
       https://netsapiens.github.io/horizon-pokemon-app/remoteEntry.js
       └─ page fetches https://pokeapi.co/api/v2/...   (public HTTPS, no auth)
       └─ images from https://raw.githubusercontent.com/PokeAPI/sprites/...
```

Reads need nothing from the platform: PokeAPI is public HTTPS, so the browser
calls it directly and a portal host needs no configuration at all. The one
exception is the avatar button — see below — which is the app's only write, and
goes through `horizonContext.api` rather than any URL of its own. The
one thing that changes that is a portal Content-Security-Policy restricting
`connect-src` / `img-src` — INSTALL.md has the same-origin proxy stanza to fall
back to, which is the pattern an app talking to a private backend would use
from the start.

## Hosting

The bundle is served from **GitHub Pages**, the same way `horizon-sdk-demo` is:

```
https://netsapiens.github.io/horizon-pokemon-app/remoteEntry.js
        └──── Pages origin ────┘└──── repo path ────┘
```

Opening that URL in a browser shows a blank page — this is a **headless
remote**. It renders nothing on its own; it only mounts inside the Horizon host.

One URL serves every instance, so an update is one publish rather than a copy
per portal, and GitHub Pages sends `Access-Control-Allow-Origin: *`, which
satisfies the CORS probe the platform runs at submission.

Two settings make a remote work from a Pages subpath, both already in place:
`output.publicPath: 'auto'` in production, so the bundle resolves its own chunk
URLs from wherever `remoteEntry.js` was loaded; and `.nojekyll`, added by the
workflow, without which GitHub's Jekyll layer strips `_`-prefixed webpack
output.

Self-hosting on a portal host instead is supported — see `deploy.sh` and the
appendix in INSTALL.md — but then each instance needs its own copy, and the
Apache cache stanza that keeps `remoteEntry.js` out of the global JS expiry.

### Publishing

`.github/workflows/deploy-pages.yml` runs on every push to `main`: `npm ci` ->
version guard -> `npm run typecheck` -> `npm run build` -> `npm run verify` ->
`.nojekyll` -> upload -> `actions/deploy-pages`. The repo needs **Settings ->
Pages -> Source: GitHub Actions**.

The version guard fails the build when `src/`, `webpack.config.js`,
`package.json` or the lockfile changed while `version` did not. The remote
entry URL is stable, so `version` is the only thing that tells the platform to
re-verify: new bytes under an unchanged version leave it enforcing the OLD hash
at the same URL, every host fails its integrity check, and the app silently
stops appearing with no verdict to explain it.

`checks.yml` runs the typecheck on pull requests too. It earns its place —
`babel-loader` strips types without checking them, so the bundle builds no
matter how wrong they are, and nothing else in the deploy path would notice.

## Registration

Registered in `NsApi.horizon_extensions` (the `/ns-api/v2/ui-extensions`
backing table) on each portal:

| field            | value                                                            |
| ---------------- | ---------------------------------------------------------------- |
| id               | `horizon-pokemon` (derived server-side, not sent)                |
| webpack_module   | `horizonPokemon` (must equal the MF name in webpack.config.js)   |
| remote_entry_url | `https://netsapiens.github.io/horizon-pokemon-app/remoteEntry.js` |
| reseller         | `*`                                                              |
| enabled          | `yes`                                                            |

The origin must be in the platform's `approved_cdn_origins`; `*.github.io`
covers this one, and is what `horizon-sdk-demo` loads through.

Registering is not enough on its own: a newly registered app sits at
verification status `none` and renders nowhere until the bundle is deployed and
verified — the **Deploy** button on the Registered Apps row, or
`POST /ns-api/v2/ui-extensions/registry/horizon-pokemon/deploy`. INSTALL.md
sections 2-3 have both, with what the verdict means.

## Setting an avatar

The detail panel's **Set as my avatar** button uploads the artwork you are
looking at to `POST /domains/{domain}/users/{extension}/avatar` through
`horizonContext.api`, so the app never sees the user's token and the call is
attributed to it on the Registered Apps page. `src/api/avatarApi.ts` has the
contract; three things govern whether it works:

- **The platform's API-write master capability must be enabled** for SDK apps
  (Platform -> UI SDK Management). With it off, the host's proxy answers 403
  before the request leaves the browser, and the panel says so.
- **The image must be square.** The endpoint rejects anything else with a 400
  rather than letterboxing it. PokeAPI artwork is 475x475 and the sprites are
  96x96, so both pass — a cropped source would not.
- **The session needs an extension.** `HorizonUser.extension` is optional; a
  platform admin who is not a subscriber has no avatar to set, and the button
  is disabled with a note rather than failing at the API.

The upload is `multipart/form-data` with the field named `file`, because the
endpoint reads a PHP file upload. The host's api client passes a `FormData`
body through to `fetch` untouched and sets no `Content-Type`, letting the
browser write the multipart boundary.

The host's top bar reads the avatar once per page load, so the new picture
appears on the next load rather than instantly.

## Releasing an update

```bash
# 1. change code, and bump `version` in package.json — CI fails without it
# 2. commit and push to main
# 3. gh run watch          # Pages must finish BEFORE the next step
# 4. Registered Apps -> Deploy on the horizon-pokemon row
# 5. read the verdict: approved | flagged -> loads; rejected -> fix and repeat
```

Step 3 before step 4 is the discipline. Deploy fetches and hashes whatever is
live at that moment, so pressing it early verifies and pins the *old* bundle,
and the new one then fails SRI in every browser. Between the Pages publish and
the Deploy press the app is briefly unloadable for anyone starting a fresh
session — keep the gap short.

## Develop

```bash
npm install
npm run dev        # remoteEntry.js on http://localhost:5008/remoteEntry.js
npm run typecheck
npm run build
npm run verify     # the same bundle checks the platform runs
```

Register a dev build by pointing `remote_entry_url` at
`http://localhost:5008/remoteEntry.js` — `localhost` is seeded in the approved
origins so local development works.

## Route

| field      | value                                          |
| ---------- | ---------------------------------------------- |
| route id   | `pokemon-pokedex`                              |
| parentPath | `/apps` (the Apps menu — Example CRM's menu)   |
| path       | `pokemon` -> `/apps/pokemon`                   |
| placement  | `{ last: true }`                               |

The route deliberately declares no `requiredScopes`, matching Example CRM:
`/apps` carries no section floor and this page reads nothing but public data,
so any signed-in user can open it. **A page that reads customer data must
declare a tier instead** — the host no longer treats a hidden menu entry as a
gate.

## Credits

Data and artwork from [PokeAPI](https://pokeapi.co/) and the
[PokeAPI/sprites](https://github.com/PokeAPI/sprites) repository. Pokemon and
Pokemon character names are trademarks of Nintendo; this app is an unofficial
demo and is not affiliated with or endorsed by Nintendo, Game Freak or The
Pokemon Company. Treat it as a demo of the SDK rather than something to ship to
customers.
