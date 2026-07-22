/**
 * Flattening for the media strips on unscheduled media groups: recent camera
 * trap photos and recent audio detection clips, pulled from the sightings of
 * the group's most recent surveys. Surveys arrive date-descending and
 * sightings keep API order, so the strips read newest-survey first.
 */
import type { Sighting, SightingAudioClip, Survey } from '../../services/api';

export const PHOTO_STRIP_CAP = 8;
export const CLIP_STRIP_CAP = 6;

export interface RecentPhoto {
  imageId: number;
  speciesName: string | null;
  date: string;
}

export interface RecentClip {
  clip: SightingAudioClip;
  speciesName: string | null;
  date: string;
}

export function collectRecentPhotos(
  surveys: Survey[],
  sightingsBySurvey: Map<number, Sighting[]>,
  cap: number = PHOTO_STRIP_CAP,
): RecentPhoto[] {
  const photos: RecentPhoto[] = [];
  for (const survey of surveys) {
    for (const sighting of sightingsBySurvey.get(survey.id) ?? []) {
      for (const imageId of sighting.image_ids ?? []) {
        photos.push({ imageId, speciesName: sighting.species_name ?? null, date: survey.date });
      }
    }
  }
  return photos.slice(0, cap);
}

export function collectRecentClips(
  surveys: Survey[],
  sightingsBySurvey: Map<number, Sighting[]>,
  cap: number = CLIP_STRIP_CAP,
): RecentClip[] {
  const clips: RecentClip[] = [];
  for (const survey of surveys) {
    for (const sighting of sightingsBySurvey.get(survey.id) ?? []) {
      for (const clip of sighting.audio_clips ?? []) {
        clips.push({ clip, speciesName: sighting.species_name ?? null, date: survey.date });
      }
    }
  }
  return clips.slice(0, cap);
}
