/**
 * Interaction tests for the botanical frequency score entry.
 *
 * The one that matters: typing a percent also derives the band, and both must
 * arrive as ONE change. The inline sightings grid rebuilds its rows from a
 * prop, so two separate calls in the same event would leave only the second —
 * silently discarding the percent the surveyor just typed.
 */

import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import FrequencyScoreFields from './FrequencyScoreFields';
import type { FrequencyScore } from '../../config/frequencyScore';

/**
 * Harness that applies each change the way SightingsEditor does — mapping over
 * a value captured in this render, NOT a functional setState — so a component
 * that emitted two changes per event would fail these tests.
 */
function Harness({ initial = {} }: { initial?: FrequencyScore }) {
  const [score, setScore] = useState<FrequencyScore>(initial);
  return (
    <>
      <FrequencyScoreFields
        value={score}
        onChange={(patch) => setScore({ ...score, ...patch })}
      />
      <output data-testid="state">{JSON.stringify(score)}</output>
    </>
  );
}

const state = () => JSON.parse(screen.getByTestId('state').textContent || '{}');
const percentBox = () => screen.getByLabelText('Percent of quadrats');

describe('FrequencyScoreFields', () => {
  it('keeps the percent when typing also derives the band', () => {
    render(<Harness />);
    fireEvent.change(percentBox(), { target: { value: '41.66' } });
    expect(state()).toEqual({ percent_frequency: '41.66', frequency_band: '3' });
  });

  it('accepts a percent digit by digit, deriving the band as it goes', () => {
    render(<Harness />);
    fireEvent.change(percentBox(), { target: { value: '4' } });
    expect(state().percent_frequency).toBe('4');
    fireEvent.change(percentBox(), { target: { value: '45' } });
    expect(state()).toEqual({ percent_frequency: '45', frequency_band: '3' });
  });

  it('clears the percent without touching the band', () => {
    render(<Harness initial={{ percent_frequency: '20', frequency_band: '2' }} />);
    fireEvent.change(percentBox(), { target: { value: '' } });
    expect(state()).toEqual({ percent_frequency: null, frequency_band: '2' });
  });

  it('records a walkabout as the "+" band alone', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Band +' }));
    expect(state()).toEqual({ frequency_band: '+' });
  });

  it('rejects a third decimal place rather than storing it', () => {
    render(<Harness />);
    fireEvent.change(percentBox(), { target: { value: '41.666' } });
    expect(state()).toEqual({});
  });
});
