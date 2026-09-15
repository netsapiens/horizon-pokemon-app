/**
 * The detail panel above the grid: official artwork, Pokedex description,
 * types, physical stats and base stats for the selected Pokemon — plus the one
 * action this app offers, adopting that artwork as the user's avatar.
 *
 * The vCon app puts its player in a strip above its grid for the same reason —
 * the reader keeps their place in the list while the detail opens.
 */
import { useState } from 'react';
import { useHorizonContext } from '@netsapiens/horizon-sdk';

import {
  avatarTargetFor,
  describeAvatarFailure,
  setUserAvatar,
} from '../api/avatarApi';
import { dexNumber, type PokemonDetail as Detail } from '../api/pokeApi';

interface PokemonDetailProps {
  detail: Detail;
  onClose: () => void;
}

/** The highest base stat the games produce, near enough for a meter. */
const STAT_CEILING = 255;

/**
 * The outcome of an avatar upload, tagged with the Pokemon it was for.
 *
 * The tag is the point: this panel stays mounted when the selection changes,
 * so an untagged "Avatar updated" would still be sitting there under the next
 * Pokemon's name, claiming something that never happened. Same reason the
 * artwork URL below is derived from props rather than initialised from them.
 */
interface AvatarResult {
  id: number;
  ok: boolean;
  message: string;
}

export default function PokemonDetail({
  detail,
  onClose,
}: PokemonDetailProps) {
  const { api, ui, user } = useHorizonContext();
  const { Paper, Stack, Typography, Chip, Box, Button, Divider, Alert } =
    ui ?? {};

  // Derived from props, NOT initialised from them: `useState(detail.artworkUrl)`
  // runs its initializer once, and this panel stays mounted when the selection
  // changes — so the previous Pokemon's artwork survived into the next one's
  // detail while every text field updated around it. What is worth remembering
  // across a render is only WHICH id's artwork 404'd, so the fallback applies
  // to that Pokemon and nothing else.
  const [artworkMissing, setArtworkMissing] = useState<number | null>(null);
  const source =
    artworkMissing === detail.id ? detail.spriteUrl : detail.artworkUrl;

  const [uploadingId, setUploadingId] = useState<number | null>(null);
  const [result, setResult] = useState<AvatarResult | null>(null);

  const target = avatarTargetFor(user);
  const uploading = uploadingId === detail.id;
  const shownResult = result?.id === detail.id ? result : null;

  const adoptAsAvatar = async () => {
    if (!api || !target) {
      return;
    }

    const id = detail.id;

    setUploadingId(id);
    setResult(null);

    try {
      // Uploads exactly what the panel is showing — artwork, or the sprite
      // fallback when a form has no artwork.
      await setUserAvatar(api, target, source, `${detail.name}.png`);
      setResult({
        id,
        ok: true,
        message: `${detail.label} is now your avatar. The top bar picks it up on the next page load.`,
      });
    } catch (error: unknown) {
      setResult({ id, ok: false, message: describeAvatarFailure(error) });
    } finally {
      setUploadingId((current) => (current === id ? null : current));
    }
  };

  if (!Paper || !Stack || !Typography || !Box) {
    return null;
  }

  const facts = [
    { label: 'Height', value: `${detail.heightM.toFixed(1)} m` },
    { label: 'Weight', value: `${detail.weightKg.toFixed(1)} kg` },
    { label: 'Abilities', value: detail.abilities.join(', ') || '—' },
  ];

  return (
    <Paper>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={3}
        alignItems={{ xs: 'stretch', md: 'flex-start' }}
      >
        <Box
          sx={{
            width: { xs: '100%', md: 220 },
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Box
            component='img'
            src={source}
            alt={detail.label}
            onError={() => setArtworkMissing(detail.id)}
            sx={{ maxWidth: 220, maxHeight: 220, objectFit: 'contain' }}
          />
        </Box>

        <Stack spacing={2} sx={{ flex: 1, minWidth: 0 }}>
          <Stack
            direction='row'
            spacing={2}
            alignItems='flex-start'
            justifyContent='space-between'
          >
            <Stack spacing={0.5}>
              <Typography variant='h5'>
                {detail.label}{' '}
                <Typography component='span' variant='h6' color='text.secondary'>
                  {dexNumber(detail.id)}
                </Typography>
              </Typography>
              {detail.genus ? (
                <Typography variant='body2' color='text.secondary'>
                  {detail.genus}
                </Typography>
              ) : null}
            </Stack>

            {Button ? (
              <Stack direction='row' spacing={1} flexShrink={0}>
                <Button
                  onClick={adoptAsAvatar}
                  disabled={uploading || !api || !target}
                >
                  {uploading ? 'Setting...' : 'Set as my avatar'}
                </Button>
                <Button variant='text' onClick={onClose}>
                  Close
                </Button>
              </Stack>
            ) : null}
          </Stack>

          {!target ? (
            <Typography variant='caption' color='text.secondary'>
              Setting an avatar needs a signed-in extension; this session does
              not have one.
            </Typography>
          ) : null}

          {shownResult && Alert ? (
            <Alert severity={shownResult.ok ? 'success' : 'error'}>
              {shownResult.message}
            </Alert>
          ) : null}

          {Chip ? (
            <Stack direction='row' spacing={1} flexWrap='wrap' useFlexGap>
              {detail.types.map((type) => (
                <Chip key={type} label={type} />
              ))}
            </Stack>
          ) : null}

          <Typography variant='body1'>
            {detail.description || 'No Pokedex entry available for this form.'}
          </Typography>

          {Divider ? <Divider /> : null}

          <Stack direction='row' spacing={4} flexWrap='wrap' useFlexGap>
            {facts.map((fact) => (
              <Stack key={fact.label} spacing={0.25}>
                <Typography variant='caption' color='text.secondary'>
                  {fact.label}
                </Typography>
                <Typography variant='body2'>{fact.value}</Typography>
              </Stack>
            ))}
          </Stack>

          <Stack spacing={1}>
            {detail.stats.map((stat) => (
              <Stack
                key={stat.name}
                direction='row'
                spacing={2}
                alignItems='center'
              >
                <Typography
                  variant='caption'
                  color='text.secondary'
                  sx={{ width: 130, flexShrink: 0 }}
                >
                  {stat.name}
                </Typography>
                <Typography variant='body2' sx={{ width: 40, flexShrink: 0 }}>
                  {stat.value}
                </Typography>
                {/* The kit has no meter component (see KIT-GAPS.md). `Box` is
                    the sanctioned bare primitive and both colours are palette
                    paths, so the bar still follows the light/dark toggle. */}
                <Box
                  sx={{
                    flex: 1,
                    minWidth: 60,
                    height: 6,
                    borderRadius: 1,
                    bgcolor: 'background.elevation1',
                    overflow: 'hidden',
                  }}
                >
                  <Box
                    sx={{
                      width: `${Math.min(100, (stat.value / STAT_CEILING) * 100)}%`,
                      height: '100%',
                      borderRadius: 1,
                      bgcolor: 'primary.main',
                    }}
                  />
                </Box>
              </Stack>
            ))}
          </Stack>
        </Stack>
      </Stack>
    </Paper>
  );
}
