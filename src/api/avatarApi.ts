/**
 * Adopting a Pokemon's artwork as the signed-in user's avatar.
 *
 * This is the app's only WRITE against the platform, and the only place it
 * touches NetSapiens data at all. It goes through `horizonContext.api` — the
 * host-brokered, audited proxy — so the app never sees the user's token and
 * the call is attributed to this app on the Registered Apps page.
 *
 * The upload is `multipart/form-data`, not JSON: the avatar endpoint reads a
 * PHP file upload (`$_FILES['file']`), so the field MUST be named `file`. The
 * host's api client passes a `FormData` body straight through to `fetch` and
 * deliberately sets no `Content-Type` for it, letting the browser write the
 * multipart boundary — so handing it a FormData is all that is needed.
 *
 * Two server-side rules worth knowing before changing the image source:
 *   - the image must be SQUARE (1:1) or the API answers 400. PokeAPI's
 *     official artwork is 475x475 and the front sprites are 96x96, so both
 *     pass; a cropped or letterboxed source would not.
 *   - JPEG, PNG, WebP and GIF only, 20 MB max. Everything is stored as WebP.
 */
import type { HorizonApiClient, HorizonUser } from '@netsapiens/horizon-sdk';

export interface AvatarTarget {
  domain: string;
  extension: string;
}

/**
 * The avatar path needs a domain AND an extension, and `extension` is optional
 * on `HorizonUser` — a session without one (a platform admin who is not a
 * subscriber) has no avatar to set. Resolving it in one place lets the page
 * disable the control rather than discovering this in a 404.
 */
export function avatarTargetFor(
  user: HorizonUser | undefined,
): AvatarTarget | null {
  if (!user?.domain || !user?.extension) {
    return null;
  }

  return { domain: user.domain, extension: user.extension };
}

/**
 * Fetch an image by URL and upload it as this user's avatar.
 *
 * `imageUrl` is whatever the page is actually displaying, so what the user
 * sees is what they get — including the sprite fallback when a form has no
 * official artwork.
 */
export async function setUserAvatar(
  api: HorizonApiClient,
  target: AvatarTarget,
  imageUrl: string,
  filename: string,
  signal?: AbortSignal,
): Promise<void> {
  // The sprite CDN sends `Access-Control-Allow-Origin: *`, so the portal can
  // read the bytes. No credentials: this is a public image, and sending any
  // would be both pointless and a bundle-verification finding.
  const response = await fetch(imageUrl, { signal });

  if (!response.ok) {
    throw new Error(
      `Could not download the image (${response.status} ${response.statusText})`,
    );
  }

  const image = await response.blob();

  const body = new FormData();
  body.append('file', image, filename);

  await api.post(`/domains/${target.domain}/users/${target.extension}/avatar`, body);
}

/**
 * Turn a failure into something a reader can act on.
 *
 * The two that actually happen are worth naming: the platform's API-write
 * master capability being switched off (the proxy answers 403 before the call
 * leaves the browser), and a non-square image (400 from the avatar endpoint).
 */
export function describeAvatarFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (/\b403\b|forbidden|permission/i.test(message)) {
    return `${message} — API write access may be disabled for SDK apps on this platform (Platform -> UI SDK Management).`;
  }

  if (/\bsquare\b|\b400\b/i.test(message)) {
    return `${message} — the avatar endpoint only accepts square images.`;
  }

  return message;
}
