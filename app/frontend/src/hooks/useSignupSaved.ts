import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { surveyorsAPI, type Survey, type Surveyor } from '../services/api';

/**
 * Shared handler for a completed sign-up/withdraw (self-serve or otherwise):
 * writes the survey's new surveyor ids into page state, highlights newly
 * added surveyors green for the session, and — because a first-time self
 * sign-up can create a brand-new surveyor — refreshes the surveyor lookup
 * when an id doesn't resolve, so the new name gets an avatar and the
 * signed-up state detects it.
 */
export function useSignupSaved(
  surveys: Survey[],
  setSurveys: Dispatch<SetStateAction<Survey[]>>,
  setGreenIds: Dispatch<SetStateAction<Set<number>>>,
  surveyors: Surveyor[],
  setSurveyors: Dispatch<SetStateAction<Surveyor[]>>,
) {
  return useCallback(
    (surveyId: number, surveyorIds: number[]) => {
      const previous = surveys.find((s) => s.id === surveyId)?.surveyor_ids ?? [];
      setSurveys((prev) =>
        prev.map((s) => (s.id === surveyId ? { ...s, surveyor_ids: surveyorIds } : s)),
      );
      const added = surveyorIds.filter((id) => !previous.includes(id));
      if (added.length > 0) {
        setGreenIds((prev) => {
          const next = new Set(prev);
          added.forEach((id) => next.add(id));
          return next;
        });
      }
      if (surveyorIds.some((id) => !surveyors.some((s) => s.id === id))) {
        surveyorsAPI.getAll().then(setSurveyors).catch(() => {});
      }
    },
    [surveys, surveyors, setSurveys, setGreenIds, setSurveyors],
  );
}
