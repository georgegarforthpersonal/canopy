import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { surveyorsAPI, type ScheduledSurvey, type Surveyor } from '../services/api';

/**
 * Shared handler for a completed sign-up/withdraw (self-serve or otherwise):
 * writes the slot's new surveyor ids into page state, highlights newly
 * added surveyors green for the session, and — because a first-time self
 * sign-up can create a brand-new surveyor — refreshes the surveyor lookup
 * when an id doesn't resolve, so the new name gets an avatar and the
 * signed-up state detects it.
 */
export function useSignupSaved(
  slots: ScheduledSurvey[],
  setSlots: Dispatch<SetStateAction<ScheduledSurvey[]>>,
  setGreenIds: Dispatch<SetStateAction<Set<number>>>,
  surveyors: Surveyor[],
  setSurveyors: Dispatch<SetStateAction<Surveyor[]>>,
) {
  return useCallback(
    (slotId: number, surveyorIds: number[]) => {
      const previous = slots.find((s) => s.id === slotId)?.surveyor_ids ?? [];
      setSlots((prev) =>
        prev.map((s) => (s.id === slotId ? { ...s, surveyor_ids: surveyorIds } : s)),
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
    [slots, surveyors, setSlots, setGreenIds, setSurveyors],
  );
}
