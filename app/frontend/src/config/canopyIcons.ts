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
import adHoc from '../assets/canopy/ad-hoc.png';
import audio from '../assets/canopy/audio.png';
import botanical from '../assets/canopy/botanical.png';
import butterfly from '../assets/canopy/butterfly.png';
import cameraTrap from '../assets/canopy/camera-trap.png';
import dragonfly from '../assets/canopy/dragonfly.png';
import genericBird from '../assets/canopy/generic-bird.png';
import marshFritillary from '../assets/canopy/marsh-fritillary.png';
import reptileSnake from '../assets/canopy/reptile-snake.png';
import turtleDove from '../assets/canopy/turtle-dove.png';
import wren from '../assets/canopy/wren.png';

const CANOPY_ICONS: Record<string, string> = {
  'ad-hoc': adHoc,
  audio,
  botanical,
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

/** Registered slugs — for the (future) admin icon picker. The backend seed
 * script keeps its own name→slug list; keep the two in step when adding
 * badges (scripts/set_survey_type_icons.py). */
export const canopyIconSlugs = Object.keys(CANOPY_ICONS);
