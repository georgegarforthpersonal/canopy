/**
 * Per-species-type count chips for a recorded survey row — the same
 * breakdown the main Surveys list shows (a survey type can collect several
 * species types, e.g. bird surveys also log mammals), restyled for group
 * cards. Falls back to a single zero chip with the group's primary species
 * icon when the survey has no sightings.
 */
import { Box, Tooltip } from '@mui/material';
import type { Survey } from '../../services/api';
import { getSpeciesIcon, formatSpeciesCount } from '../../config/speciesTypes';

const chipSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 0.5,
  px: 1,
  py: 0.4,
  borderRadius: '6px',
  bgcolor: '#EBECED',
  color: '#454648',
  fontSize: 12.5,
  fontWeight: 600,
} as const;

interface SpeciesCountChipsProps {
  survey: Survey;
  /** Icon for the zero chip when the survey has no sightings. */
  fallbackSpeciesType: string;
}

export default function SpeciesCountChips({ survey, fallbackSpeciesType }: SpeciesCountChipsProps) {
  if (survey.species_breakdown.length === 0) {
    const Icon = getSpeciesIcon(fallbackSpeciesType);
    return (
      <Box sx={chipSx}>
        <Icon sx={{ fontSize: 15 }} />
        0
      </Box>
    );
  }
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 0.75 }}>
      {survey.species_breakdown.map((sighting) => {
        const Icon = getSpeciesIcon(sighting.type);
        return (
          <Tooltip key={sighting.type} title={formatSpeciesCount(sighting.type, sighting.count)} arrow>
            <Box sx={chipSx}>
              <Icon sx={{ fontSize: 15 }} />
              {sighting.count}
            </Box>
          </Tooltip>
        );
      })}
    </Box>
  );
}
