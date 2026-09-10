# Installing the Pokemon app on a Horizon instance

The bundle is instance-independent — `publicPath: 'auto'`, no hostnames baked
in — and it is published once, to GitHub Pages, for every instance. Installing
it on a portal is therefore two API calls and no files: **register**, then
**deploy** (which is what verifies it).

## Prerequisites

- Horizon v46+ with SDK support (`NsApi.horizon_extensions` table exists).
- `*.github.io` in `approved_cdn_origins` (`NsApi.horizon_extension_settings`).
  It is what `horizon-sdk-demo` loads through, so on most instances this is
  already true. Failure here is silent in the UI — look for
  `[HorizonAppsLoader]` in the browser console.
- Browsers reaching the portal can reach `pokeapi.co` and
  `raw.githubusercontent.com`. This is the browser's network, not the server's.
- A token with write scope. `reseller: *` (platform-global) requires a super
  user; a reseller-scoped token can only create within its own reseller.

## 1. Publish the bundle

Pushing to `main` does this — see the README. Confirm what the platform will
fetch:

```bash
curl -sI https://netsapiens.github.io/horizon-pokemon-app/remoteEntry.js \
  | grep -iE 'http/|content-type|access-control-allow-origin'
# -> 200, application/javascript, access-control-allow-origin: *
```

## 2. Register the app

Portal **Platform -> UI SDK Management -> Registered Apps -> Add App** is the
short path — it registers and gives you the **Deploy** button step 3 needs.

The API equivalent (note the `/registry` segment — `POST /ui-extensions` is a
runtime read surface and returns 405):

```bash
curl -X POST "https://<PORTAL_FQDN>/ns-api/v2/ui-extensions/registry" \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{
    "name": "Pokemon",
    "description": "Pokedex browser with artwork and Pokedex entries (PokeAPI)",
    "version": "1.0.1",
    "remote_entry_url": "https://netsapiens.github.io/horizon-pokemon-app/remoteEntry.js",
    "webpack_module": "horizonPokemon",
    "enabled": "yes"
  }'
```

Required fields are `name`, `remote_entry_url` and `webpack_module`; everything
else has a default. **Do not send `id`** — the server derives it as the
kebab-case of `webpack_module` (`horizonPokemon` -> `horizon-pokemon`), and a
client-sent id is ignored. `webpack_module` is unique platform-wide (409 on a
duplicate) and immutable once registered. `integrity_hash` is ignored if sent:
only the verification pipeline writes it, from bytes the API fetched itself.

To move an existing registration to a different URL, `PUT` it — the
`webpack_module` does not change, because the bundle has not:

```bash
curl -X PUT "https://<PORTAL_FQDN>/ns-api/v2/ui-extensions/registry/horizon-pokemon" \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{ "remote_entry_url": "https://netsapiens.github.io/horizon-pokemon-app/remoteEntry.js" }'
```

## 3. Deploy the bundle (required — this is what verifies it)

A registered app sits at `verification_status: none`, is filtered out of
`/ui-extensions?purpose=runtime` before the browser sees it, and renders
nowhere. One call fetches, verifies, hashes and promotes:

```bash
curl -X POST "https://<PORTAL_FQDN>/ns-api/v2/ui-extensions/registry/horizon-pokemon/deploy?synchronous=yes" \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{ "remote_entry_url": "https://netsapiens.github.io/horizon-pokemon-app/remoteEntry.js" }'
```

or press **Deploy** on the app's row in Registered Apps, which does the same
thing and picks the next free version itself.

Reading the response:

- `status` — `approved` and `flagged` both load; only `rejected` blocks.
  A `size-delta` flag on a first submission is expected and needs no action.
- `promoted: true` is the bit that matters; `synchronous=yes` adds `landed`,
  and `landed: false` means "not observed within the poll budget", not failed.
- `unchanged: true` means the fetched bytes hash to the current pin — a
  success, and why a CI pipeline can call this on every deploy.
- `version` is API-owned: omit it and the patch component advances; send one
  and it must be semver GREATER than the current value (the first deploy may
  claim the version the registration was created with).
- `429` is the per-extension submission rate limit. Wait a minute.

Verification history, with the findings behind each verdict:

```bash
curl -s "https://<PORTAL_FQDN>/ns-api/v2/ui-extensions/registry/horizon-pokemon/versions" \
  -H "Authorization: Bearer <TOKEN>"
```

If a deploy is refused before any fetch happens, the origin is not approved:

```bash
curl -s "https://<PORTAL_FQDN>/ns-api/v2/ui-extensions/settings" \
  -H "Authorization: Bearer <TOKEN>"        # read is open to any authenticated scope
```

## 4. Verify in the portal

Hard-refresh: **Pokemon** appears in the **Apps** menu next to **Example CRM**
(deep link: `https://<PORTAL_FQDN>/apps/pokemon`).

## Updating

Bump `version` in `package.json`, push to `main`, wait for the Pages deploy to
finish, then deploy again (step 3) — the registration row itself does not
change. Between the publish and the deploy the platform still pins the previous
hash while the CDN serves new bytes, so anyone starting a fresh session in that
window will not see the app. Keep the gap short.

## Appendix A: self-hosting on a portal host

Where a portal should not depend on an external CDN, serve the files from the
portal itself. `deploy.sh` does the whole cycle — it pushes source, builds on
the target (`npm install && npm run build && npm run verify`), and swaps
`dist/` into the web root:

```bash
TARGET=ubuntu@<portal-host> ./deploy.sh
# SSH_KEY=~/.ssh/<key>  SSH_OPTS='-o ProxyJump=…'  WEB_DIR=/var/www/html/horizon-pokemon
```

Ship `dist/*.map` with the JS — the verifier reads your original source through
the maps and rejects a bundle it cannot attribute findings to.

Then add the cache stanza, without which browsers never see an update:

```apache
# remoteEntry.js is NOT content-hashed (its chunks are) — exempt it from the
# global 1-year JS expiry.
<Directory /var/www/html/horizon-pokemon>
    ExpiresActive Off
    <Files "remoteEntry.js">
        Header set Cache-Control "no-cache"
    </Files>
</Directory>
```

```bash
sudo apachectl configtest && sudo systemctl reload apache2
```

Register with that host's own URL
(`https://<PORTAL_FQDN>/horizon-pokemon/remoteEntry.js`) and make sure the
portal origin is in `approved_cdn_origins`. Do not run both hosting models
against one instance — two copies of the same bundle drift.

## Appendix B: if a portal CSP blocks pokeapi.co

The page calls PokeAPI directly, which a strict `connect-src` / `img-src`
policy can block (symptom: the page loads, the grid stays empty, the console
shows CSP violations). Put the calls back on the portal origin:

```apache
<Location "/pokeapi/">
    ProxyPass "https://pokeapi.co/api/v2/" timeout=30
    ProxyPassReverse "https://pokeapi.co/api/v2/"
</Location>

<Location "/pokesprites/">
    ProxyPass "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/" timeout=30
    ProxyPassReverse "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/"
</Location>
```

then change the two constants at the top of `src/api/pokeApi.ts` to `/pokeapi`
and `/pokesprites` and rebuild. Needs `proxy_http` and proxy SSL support; a
caching layer in front is polite to PokeAPI, whose fair-use policy asks that
responses be cached rather than re-fetched.
