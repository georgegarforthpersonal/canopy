import { useMemo } from 'react';
import type { Surveyor } from '../services/api';

/**
 * Returns a memoised resolver from surveyor ids to Surveyor objects, skipping
 * any ids with no matching surveyor.
 */
export function useSurveyorLookup(surveyors: Surveyor[]): (ids: number[]) => Surveyor[] {
  return useMemo(() => {
    const byId = new Map(surveyors.map((s) => [s.id, s]));
    return (ids: number[]) => ids.map((id) => byId.get(id)).filter((s): s is Surveyor => s != null);
  }, [surveyors]);
}
