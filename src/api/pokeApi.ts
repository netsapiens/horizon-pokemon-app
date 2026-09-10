/**
 * PokeAPI client — the app's only data source.
 *
 * Unlike the vCon app, nothing here is proxied: PokeAPI is public, HTTPS and
 * unauthenticated, so the page calls it directly from the browser and the
 * portal host needs no Apache stanza. There is no bearer token to keep
 * server-side and no mixed content to avoid. See INSTALL.md if a portal's
 * Content-Security-Policy blocks the origin — that is the one case where the
 * same-origin proxy pattern from horizon-vcon-app has to come back.
 *
 * Two shapes are fetched:
 *   - the full name/id index, once (`/pokemon?limit=...`), which is what search
 *     filters over. ~1300 rows, ~120 KB, and effectively static.
 *   - one Pokemon's detail, on demand and memoized (`/pokemon/{id}` plus the
 *     species record it points at, which carries the Pokedex description).
 *
 * Artwork does not need an API call at all: the sprite repository is on a CDN
 * and addressable by dex number, so a card can paint from the index alone.
 */

const API_BASE = 'https://pokeapi.co/api/v2';
const SPRITE_BASE =
  'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';

/** One row of the dex index: everything a card needs before its detail loads. */
export interface PokedexEntry {
  id: number;
  /** API name, lower-kebab ('nidoran-f'). */
  name: string;
  /** Display form ('Nidoran F'). */
  label: string;
}

export interface PokemonStat {
  name: string;
  value: number;
}

export interface PokemonDetail {
  id: number;
  name: string;
  label: string;
  types: string[];
  abilities: string[];
  /** Decimetres in the API; metres here. */
  heightM: number;
  /** Hectograms in the API; kilograms here. */
  weightKg: number;
  stats: PokemonStat[];
  /** English Pokedex entry, control characters flattened. Empty if none. */
  description: string;
  /** 'Mouse Pokemon' — the species genus. Empty if none. */
  genus: string;
  artworkUrl: string;
  spriteUrl: string;
}

interface NamedResource {
  name: string;
  url: string;
}

interface PokemonListResponse {
  count: number;
  next: string | null;
  results: NamedResource[];
}

interface PokemonResponse {
  id: number;
  name: string;
  height: number;
  weight: number;
  types: { slot: number; type: NamedResource }[];
  abilities: { ability: NamedResource; is_hidden: boolean }[];
  stats: { base_stat: number; stat: NamedResource }[];
  species: NamedResource;
}

interface SpeciesResponse {
  flavor_text_entries?: {
    flavor_text: string;
    language: NamedResource;
  }[];
  genera?: { genus: string; language: NamedResource }[];
}

/** 'nidoran-f' -> 'Nidoran F'; 'special-attack' -> 'Special Attack'. */
export function toLabel(name: string): string {
  return name
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** '#0025' — the zero-padded dex number the Pokedex prints. */
export function dexNumber(id: number): string {
  return `#${String(id).padStart(4, '0')}`;
}

/** Official artwork, addressable by dex number with no API round trip. */
export function artworkUrl(id: number): string {
  return `${SPRITE_BASE}/other/official-artwork/${id}.png`;
}

/** The small front sprite — the fallback when a form has no official artwork. */
export function spriteUrl(id: number): string {
  return `${SPRITE_BASE}/${id}.png`;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }

  return (await response.json()) as T;
}

/** The trailing path segment of a resource URL is its id. */
function idFromUrl(url: string): number {
  const segments = url.split('/').filter(Boolean);

  return Number(segments[segments.length - 1]);
}

let indexPromise: Promise<PokedexEntry[]> | null = null;

/**
 * The whole dex index, fetched once per page load and shared by every caller.
 *
 * `limit` is deliberately absurd rather than a pinned count: the dex grows, and
 * a hardcoded 1025 would quietly stop returning new generations. If a future
 * PokeAPI caps the page size anyway, the `next` loop below picks up the rest —
 * one request today, still correct if that changes.
 */
async function fetchAllRows(signal?: AbortSignal): Promise<NamedResource[]> {
  let url: string | null = `${API_BASE}/pokemon?limit=100000&offset=0`;
  const rows: NamedResource[] = [];

  while (url) {
    const page: PokemonListResponse = await getJson<PokemonListResponse>(
      url,
      signal,
    );

    rows.push(...page.results);
    url = rows.length < page.count ? page.next : null;
  }

  return rows;
}

export function fetchIndex(signal?: AbortSignal): Promise<PokedexEntry[]> {
  if (!indexPromise) {
    indexPromise = fetchAllRows(signal)
      .then((rows) =>
        rows
          .map((result) => ({
            id: idFromUrl(result.url),
            name: result.name,
            label: toLabel(result.name),
          }))
          .filter((entry) => Number.isFinite(entry.id))
          .sort((a, b) => a.id - b.id),
      )
      .catch((error: unknown) => {
        // Don't cache a rejection — a retry after a dropped connection should
        // actually retry.
        indexPromise = null;
        throw error;
      });
  }

  return indexPromise;
}

const detailCache = new Map<number, PokemonDetail>();

/** English Pokedex text carries hard line breaks from the Game Boy era. */
function flattenFlavorText(text: string): string {
  return text.replace(/[\n\f\r\u00ad]/g, ' ').replace(/\s+/g, ' ').trim();
}

function pickEnglish(species: SpeciesResponse): {
  description: string;
  genus: string;
} {
  const entry = species.flavor_text_entries?.find(
    (candidate) => candidate.language?.name === 'en',
  );
  const genus = species.genera?.find(
    (candidate) => candidate.language?.name === 'en',
  );

  return {
    description: entry ? flattenFlavorText(entry.flavor_text) : '',
    genus: genus?.genus ?? '',
  };
}

/**
 * One Pokemon's full record: the `/pokemon` row plus the species record it
 * points at, which is where the description and genus live.
 *
 * Memoized by id — reopening a card the user already looked at costs nothing.
 * The species URL comes from the detail response rather than being assembled
 * from the id, because alternate forms have their own id and a different
 * species.
 */
export async function fetchDetail(
  id: number,
  signal?: AbortSignal,
): Promise<PokemonDetail> {
  const cached = detailCache.get(id);

  if (cached) {
    return cached;
  }

  const pokemon = await getJson<PokemonResponse>(
    `${API_BASE}/pokemon/${id}`,
    signal,
  );

  // A missing or unreachable species record costs the description, not the
  // page: everything else on the detail panel comes from the row above.
  const species = await getJson<SpeciesResponse>(
    pokemon.species.url,
    signal,
  ).catch(() => ({}) as SpeciesResponse);

  const { description, genus } = pickEnglish(species);

  const detail: PokemonDetail = {
    id: pokemon.id,
    name: pokemon.name,
    label: toLabel(pokemon.name),
    types: pokemon.types
      .slice()
      .sort((a, b) => a.slot - b.slot)
      .map((entry) => toLabel(entry.type.name)),
    abilities: pokemon.abilities.map(
      (entry) =>
        `${toLabel(entry.ability.name)}${entry.is_hidden ? ' (hidden)' : ''}`,
    ),
    heightM: pokemon.height / 10,
    weightKg: pokemon.weight / 10,
    stats: pokemon.stats.map((entry) => ({
      name: toLabel(entry.stat.name),
      value: entry.base_stat,
    })),
    description,
    genus,
    artworkUrl: artworkUrl(pokemon.id),
    spriteUrl: spriteUrl(pokemon.id),
  };

  detailCache.set(id, detail);

  return detail;
}
