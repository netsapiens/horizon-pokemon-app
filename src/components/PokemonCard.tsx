/**
 * One card in the dex grid: artwork, dex number, name.
 *
 * Painted entirely from the index row — the artwork is addressable by dex
 * number on the sprite CDN, so a grid of 60 cards costs zero API calls. Detail
 * is fetched only when a card is clicked.
 */
import { useState } from 'react';
import { useHorizonContext } from '@netsapiens/horizon-sdk';

import {
  artworkUrl,
  dexNumber,
  spriteUrl,
  type PokedexEntry,
} from '../api/pokeApi';

interface PokemonCardProps {
  entry: PokedexEntry;
  selected: boolean;
  onSelect: (id: number) => void;
}

export default function PokemonCard({
  entry,
  selected,
  onSelect,
}: PokemonCardProps) {
  const { ui } = useHorizonContext();
  const { Card, CardContent, Stack, Typography, Box, Icon } = ui ?? {};

  // Alternate forms (id > 10000) often have no official artwork; fall back to
  // the small front sprite, then to a glyph, rather than showing a broken image.
  //
  // Both pieces of state record WHICH id failed rather than what to show, and
  // the URL is derived from props on every render. A card is keyed by entry id
  // today so it would not be reused across two Pokemon — but state initialised
  // from props is the bug this app already hit once in the detail panel, and it
  // is silent when it comes back.
  const [artworkMissing, setArtworkMissing] = useState<number | null>(null);
  const [spriteMissing, setSpriteMissing] = useState<number | null>(null);

  const exhausted = spriteMissing === entry.id;
  const source =
    artworkMissing === entry.id ? spriteUrl(entry.id) : artworkUrl(entry.id);

  if (!Card || !CardContent || !Stack || !Typography || !Box) {
    return null;
  }

  const handleImageError = () => {
    if (artworkMissing === entry.id) {
      setSpriteMissing(entry.id);
    } else {
      setArtworkMissing(entry.id);
    }
  };

  return (
    <Card
      onClick={() => onSelect(entry.id)}
      // The only departure from the theme's card: a selected card borrows the
      // palette's primary edge. A path, not a hex, so it follows the toggle.
      sx={{
        height: '100%',
        ...(selected
          ? { borderColor: 'primary.main', borderWidth: 2, borderStyle: 'solid' }
          : null),
      }}
    >
      <CardContent>
        <Stack spacing={0.5} alignItems='center'>
          <Box
            sx={{
              height: 88,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {exhausted || !source ? (
              Icon ? (
                <Icon
                  icon='mdi:pokeball'
                  sx={{ fontSize: 40, color: 'text.disabled' }}
                />
              ) : null
            ) : (
              <Box
                component='img'
                src={source}
                alt={entry.label}
                loading='lazy'
                onError={handleImageError}
                sx={{ maxHeight: 88, maxWidth: '100%', objectFit: 'contain' }}
              />
            )}
          </Box>
          <Typography variant='caption' color='text.secondary'>
            {dexNumber(entry.id)}
          </Typography>
          <Typography variant='subtitle2' noWrap sx={{ maxWidth: '100%' }}>
            {entry.label}
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}
