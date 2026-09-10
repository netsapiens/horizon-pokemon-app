/**
 * Pokemon — the app's single full-page route, mounted at /apps/pokemon.
 *
 * Shape: search over the whole dex index (fetched once), a card grid that
 * pages in with Load more, and a detail panel that opens above the grid when a
 * card is picked. Every visible element comes from `horizonContext.ui`, so the
 * page re-themes with the host's light/dark toggle.
 */
import { useEffect, useMemo, useState } from 'react';
import { useHorizonContext } from '@netsapiens/horizon-sdk';

import {
  dexNumber,
  fetchDetail,
  fetchIndex,
  type PokedexEntry,
  type PokemonDetail as Detail,
} from '../api/pokeApi';
import PokemonCard from '../components/PokemonCard';
import PokemonDetail from '../components/PokemonDetail';

const PAGE_SIZE = 60;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** An aborted fetch is a superseded one, not a failure worth showing. */
function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export default function PokemonPage() {
  const { ui } = useHorizonContext();
  const { PageTemplate } = ui?.templates ?? {};
  const { Paper, Stack, Typography, Box, SearchField, Button, Alert } = ui ?? {};

  const [entries, setEntries] = useState<PokedexEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // The index, once. Aborted on unmount so a route change mid-flight doesn't
  // set state on a gone component.
  useEffect(() => {
    const controller = new AbortController();

    fetchIndex(controller.signal)
      .then((rows) => {
        setEntries(rows);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!isAbort(cause)) {
          setError(message(cause));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, []);

  // Detail for the selected card. Memoized in the client, so re-opening a card
  // is instant and this effect is a no-op fetch.
  useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      setDetailError(null);

      return;
    }

    const controller = new AbortController();

    setDetailLoading(true);
    setDetailError(null);

    fetchDetail(selectedId, controller.signal)
      .then((record) => setDetail(record))
      .catch((cause: unknown) => {
        if (!isAbort(cause)) {
          setDetailError(message(cause));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setDetailLoading(false);
        }
      });

    return () => controller.abort();
  }, [selectedId]);

  // A new search starts at the top of its own result set.
  useEffect(() => setVisible(PAGE_SIZE), [query]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();

    if (!needle) {
      return entries;
    }

    return entries.filter(
      (entry) =>
        entry.name.includes(needle) ||
        entry.label.toLowerCase().includes(needle) ||
        String(entry.id) === needle ||
        dexNumber(entry.id).includes(needle),
    );
  }, [entries, query]);

  const shown = useMemo(
    () => filtered.slice(0, visible),
    [filtered, visible],
  );

  // The one sanctioned fallback: the host kit is unavailable, so there is
  // nothing theme-correct to render with.
  if (!PageTemplate || !Paper || !Stack || !Typography || !Box) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Pokemon</h1>
      </div>
    );
  }

  const status = loading
    ? 'Loading the Pokedex...'
    : `${filtered.length.toLocaleString()} of ${entries.length.toLocaleString()} Pokemon${
        shown.length < filtered.length ? ` — showing ${shown.length}` : ''
      }`;

  return (
    <PageTemplate
      title='Pokemon'
      subtitle='Search the Pokedex — artwork and entries from the public PokeAPI'
      breadcrumbs={[{ label: 'Apps', url: '/apps' }, { label: 'Pokemon' }]}
      // Descriptors, not JSX — the host renders these as themed buttons.
      actions={[
        {
          label: 'Reset',
          icon: 'mdi:refresh',
          variant: 'secondary',
          onClick: () => {
            setQuery('');
            setSelectedId(null);
            setVisible(PAGE_SIZE);
          },
        },
      ]}
    >
      <Stack spacing={3}>
        <Paper>
          <Stack spacing={2}>
            {SearchField ? (
              <SearchField
                value={query}
                onChange={setQuery}
                placeholder='Search by name or dex number'
                fullWidth
              />
            ) : null}
            <Typography variant='caption' color='text.secondary'>
              {status}
            </Typography>
          </Stack>
        </Paper>

        {error && Alert ? (
          <Alert severity='error'>
            Could not reach PokeAPI: {error}. If this portal enforces a
            Content-Security-Policy, see INSTALL.md for the same-origin proxy.
          </Alert>
        ) : null}

        {detailError && Alert ? (
          <Alert severity='warning'>
            Could not load that Pokemon: {detailError}
          </Alert>
        ) : null}

        {detailLoading && !detail ? (
          <Paper>
            <Typography variant='body2' color='text.secondary'>
              Loading...
            </Typography>
          </Paper>
        ) : null}

        {detail ? (
          <PokemonDetail detail={detail} onClose={() => setSelectedId(null)} />
        ) : null}

        {!loading && filtered.length === 0 ? (
          <Paper>
            <Typography variant='body2' color='text.secondary'>
              Nothing in the Pokedex matches "{query}".
            </Typography>
          </Paper>
        ) : null}

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: 'repeat(2, 1fr)',
              sm: 'repeat(3, 1fr)',
              md: 'repeat(4, 1fr)',
              lg: 'repeat(6, 1fr)',
            },
            gap: 2,
          }}
        >
          {shown.map((entry) => (
            <PokemonCard
              key={entry.id}
              entry={entry}
              selected={entry.id === selectedId}
              onSelect={setSelectedId}
            />
          ))}
        </Box>

        {shown.length < filtered.length && Button ? (
          <Stack direction='row' justifyContent='center'>
            <Button onClick={() => setVisible((count) => count + PAGE_SIZE)}>
              Load more
            </Button>
          </Stack>
        ) : null}
      </Stack>
    </PageTemplate>
  );
}
