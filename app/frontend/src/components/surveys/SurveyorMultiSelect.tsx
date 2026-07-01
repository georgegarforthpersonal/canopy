/**
 * Shared surveyor multi-select: type-to-search Autocomplete with deletable
 * chips for the chosen surveyors. Extracted from the inline Autocompletes in
 * SurveyFormFields / SetupStep / ScheduleSurveyDialog so every surface picks
 * surveyors the same way.
 */
import { Autocomplete, TextField, Chip } from '@mui/material';
import type { Surveyor } from '../../services/api';

const surveyorLabel = (s: Surveyor) =>
  s.last_name ? `${s.first_name} ${s.last_name}` : s.first_name;

interface SurveyorMultiSelectProps {
  options: Surveyor[];
  value: Surveyor[];
  onChange: (surveyors: Surveyor[]) => void;
  label?: string;
  required?: boolean;
  disabled?: boolean;
  error?: boolean;
  helperText?: string;
  autoFocus?: boolean;
}

export default function SurveyorMultiSelect({
  options,
  value,
  onChange,
  label = 'Surveyors',
  required = false,
  disabled = false,
  error = false,
  helperText,
  autoFocus = false,
}: SurveyorMultiSelectProps) {
  return (
    <Autocomplete
      multiple
      options={options}
      value={value}
      onChange={(_, next) => onChange(next)}
      disabled={disabled}
      getOptionLabel={surveyorLabel}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      disableCloseOnSelect
      renderInput={(params) => (
        <TextField
          {...params}
          label={required ? `${label} *` : label}
          error={error}
          helperText={helperText}
          autoFocus={autoFocus}
          sx={{ '& .MuiInputBase-input': { fontSize: { xs: '16px', sm: '1rem' } } }}
        />
      )}
      renderTags={(tags, getTagProps) =>
        tags.map((option, index) => (
          <Chip label={surveyorLabel(option)} size="small" {...getTagProps({ index })} key={option.id} />
        ))
      }
    />
  );
}
