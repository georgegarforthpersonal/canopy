/**
 * Canopy survey-type icon registry.
 *
 * Each asset in src/assets/canopy/ is a self-contained 256×256 badge (tinted
 * circle + artwork in the Canopy green ramp) drawn by the designer — they are
 * illustrations, not tintable glyphs, so they render via <img> at any size.
 *
 * A survey type opts in by storing one of these slugs in its `icon` column;
 * types without a registered slug fall back to the species-type glyph tile
 * (SpeciesIconTile), so a missing or unknown value degrades gracefully.
 */
import adHoc from '../assets/canopy/ad-hoc.svg';
import audio from '../assets/canopy/audio.svg';
import butterfly from '../assets/canopy/butterfly.svg';
import cameraTrap from '../assets/canopy/camera-trap.svg';
import dragonfly from '../assets/canopy/dragonfly.svg';
import genericBird from '../assets/canopy/generic-bird.svg';
import marshFritillary from '../assets/canopy/marsh-fritillary.svg';
import reptileSnake from '../assets/canopy/reptile-snake.svg';
import turtleDove from '../assets/canopy/turtle-dove.svg';
import wren from '../assets/canopy/wren.svg';

const CANOPY_ICONS: Record<string, string> = {
  'ad-hoc': adHoc,
  audio,
  butterfly,
  'camera-trap': cameraTrap,
  dragonfly,
  'generic-bird': genericBird,
  'marsh-fritillary': marshFritillary,
  'reptile-snake': reptileSnake,
  'turtle-dove': turtleDove,
  wren,
};

/** Asset URL for a survey type's icon slug, or null when not registered. */
export function canopyIconUrl(iconSlug: string | null | undefined): string | null {
  return (iconSlug && CANOPY_ICONS[iconSlug]) || null;
}

/** Registered slugs, for admin pickers and the icon seed script. */
export const canopyIconSlugs = Object.keys(CANOPY_ICONS);
