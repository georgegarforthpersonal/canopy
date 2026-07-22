/**
 * A survey type's group identity mark: the Canopy badge illustration when the
 * type has a registered icon slug, otherwise the tinted species-glyph tile
 * (the pre-badge treatment — also the graceful path for types whose badge
 * hasn't been drawn yet, e.g. Heal's dragonfly).
 */
import { canopyIconUrl } from '../../config/canopyIcons';
import type { SurveyTypeWithDetails } from '../../services/api';
import { accentColors, primarySpeciesType } from '../../pages/groups/groupMeta';
import SpeciesIconTile from './SpeciesIconTile';

interface SurveyTypeBadgeProps {
  surveyType: SurveyTypeWithDetails;
  size: number;
  /** Corner radius for the fallback tile (the badge itself is circular). */
  radius: number;
}

export default function SurveyTypeBadge({ surveyType, size, radius }: SurveyTypeBadgeProps) {
  const url = canopyIconUrl(surveyType.icon);
  if (url) {
    return (
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        style={{ display: 'block', flexShrink: 0 }}
      />
    );
  }
  const accent = accentColors(surveyType);
  return (
    <SpeciesIconTile
      speciesType={primarySpeciesType(surveyType)}
      size={size}
      radius={radius}
      bg={accent.bg}
      fg={accent.fg}
    />
  );
}
