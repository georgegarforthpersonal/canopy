import { useState } from 'react';
import { Stack, TextField, Autocomplete, Chip, Box } from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { TimePicker } from '@mui/x-date-pickers/TimePicker';
import { Dayjs } from 'dayjs';
import type { Location, Surveyor } from '../../services/api';

interface SurveyFormFieldsProps {
  // Form values
  date: Dayjs | null;
  locationId: number | null;
  selectedSurveyors: Surveyor[];
  notes: string;

  // Condition field values
  startTime?: Dayjs | null;
  endTime?: Dayjs | null;
  sunPercentage?: string;
  temperatureCelsius?: string;

  // Options
  locations: Location[];
  surveyors: Surveyor[];

  // Change handlers
  onDateChange: (newDate: Dayjs | null) => void;
  onLocationChange: (locationId: number | null) => void;
  onSurveyorsChange: (surveyors: Surveyor[]) => void;
  onNotesChange: (notes: string) => void;

  // Condition field change handlers
  onStartTimeChange?: (time: Dayjs | null) => void;
  onEndTimeChange?: (time: Dayjs | null) => void;
  onSunPercentageChange?: (value: string) => void;
  onTemperatureCelsiusChange?: (value: string) => void;

  // Validation errors
  validationErrors?: {
    date?: string;
    location?: string;
    surveyors?: string;
    endTime?: string;
  };

  // Visibility toggles
  hideLocation?: boolean;
  showStartEndTime?: boolean;
  showSunPercentage?: boolean;
  showTemperature?: boolean;
}

/**
 * SurveyFormFields - Reusable form fields for survey creation and editing
 *
 * Contains:
 * - Date picker
 * - Location dropdown
 * - Surveyors multi-select
 * - Start/end time pickers (conditional)
 * - Temperature and sun percentage inputs (conditional)
 * - Notes text area
 */
export function SurveyFormFields({
  date,
  locationId,
  selectedSurveyors,
  notes,
  startTime,
  endTime,
  sunPercentage,
  temperatureCelsius,
  locations,
  surveyors,
  onDateChange,
  onLocationChange,
  onSurveyorsChange,
  onNotesChange,
  onStartTimeChange,
  onEndTimeChange,
  onSunPercentageChange,
  onTemperatureCelsiusChange,
  validationErrors = {},
  hideLocation = false,
  showStartEndTime = false,
  showSunPercentage = false,
  showTemperature = false,
}: SurveyFormFieldsProps) {
  const [surveyorsOpen, setSurveyorsOpen] = useState(false);

  // Time validation: end time must be after start time
  const timeError = (() => {
    if (startTime && endTime && startTime.isValid() && endTime.isValid()) {
      if (endTime.isBefore(startTime) || endTime.isSame(startTime)) {
        return 'End time must be after start time';
      }
    }
    return validationErrors.endTime || undefined;
  })();

  return (
    <Stack spacing={{ xs: 2, md: 3 }}>
      {/* Date Picker */}
      <DatePicker
        label="Date *"
        value={date}
        onChange={onDateChange}
        slotProps={{
          textField: {
            fullWidth: true,
            error: !!validationErrors.date,
            helperText: validationErrors.date,
            sx: {
              '& .MuiInputBase-input': {
                fontSize: { xs: '16px', sm: '1rem' },
              }
            }
          },
        }}
      />

      {/* Location Dropdown - hidden when location is at sighting level */}
      {!hideLocation && (
        <Autocomplete
          options={locations}
          getOptionLabel={(option) => option.name}
          value={locations.find((l) => l.id === locationId) || null}
          onChange={(_, newValue) => onLocationChange(newValue?.id || null)}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Location *"
              error={!!validationErrors.location}
              helperText={validationErrors.location}
              sx={{
                '& .MuiInputBase-input': {
                  fontSize: { xs: '16px', sm: '1rem' },
                }
              }}
            />
          )}
        />
      )}

      {/* Surveyors Multi-Select */}
      <Autocomplete
        multiple
        options={surveyors}
        getOptionLabel={(option) => option.last_name ? `${option.first_name} ${option.last_name}` : option.first_name}
        value={selectedSurveyors}
        open={surveyorsOpen}
        onOpen={() => setSurveyorsOpen(true)}
        onClose={(_event, reason) => {
          // Only close when clicking outside or pressing escape, not when selecting
          if (reason !== 'selectOption') {
            setSurveyorsOpen(false);
          }
        }}
        onChange={(_, newValue) => onSurveyorsChange(newValue)}
        disableCloseOnSelect
        renderInput={(params) => (
          <TextField
            {...params}
            label="Surveyors *"
            error={!!validationErrors.surveyors}
            helperText={validationErrors.surveyors}
            sx={{
              '& .MuiInputBase-input': {
                fontSize: { xs: '16px', sm: '1rem' },
              }
            }}
          />
        )}
        renderTags={(value, getTagProps) =>
          value.map((option, index) => (
            <Chip
              label={option.last_name ? `${option.first_name} ${option.last_name}` : option.first_name}
              {...getTagProps({ index })}
              size="small"
              key={option.id}
            />
          ))
        }
      />

      {/* Start/End Time Pickers */}
      {showStartEndTime && (
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: { xs: 2, md: 3 } }}>
          <TimePicker
            label="Start Time"
            value={startTime ?? null}
            onChange={(val) => onStartTimeChange?.(val)}
            slotProps={{
              textField: {
                fullWidth: true,
                sx: {
                  '& .MuiInputBase-input': {
                    fontSize: { xs: '16px', sm: '1rem' },
                  }
                }
              },
            }}
          />
          <TimePicker
            label="End Time"
            value={endTime ?? null}
            onChange={(val) => onEndTimeChange?.(val)}
            slotProps={{
              textField: {
                fullWidth: true,
                error: !!timeError,
                helperText: timeError,
                sx: {
                  '& .MuiInputBase-input': {
                    fontSize: { xs: '16px', sm: '1rem' },
                  }
                }
              },
            }}
          />
        </Box>
      )}

      {/* Temperature and Sun Percentage */}
      {(showTemperature || showSunPercentage) && (
        <Box sx={{ display: 'grid', gridTemplateColumns: showTemperature && showSunPercentage ? '1fr 1fr' : '1fr', gap: { xs: 2, md: 3 } }}>
          {showTemperature && (
            <TextField
              label="Temperature (\u00B0C)"
              type="number"
              value={temperatureCelsius ?? ''}
              onChange={(e) => onTemperatureCelsiusChange?.(e.target.value)}
              fullWidth
              inputProps={{ step: 0.5 }}
              sx={{
                '& .MuiInputBase-input': {
                  fontSize: { xs: '16px', sm: '1rem' },
                }
              }}
            />
          )}
          {showSunPercentage && (
            <TextField
              label="Sun %"
              type="number"
              value={sunPercentage ?? ''}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '' || (Number(val) >= 0 && Number(val) <= 100)) {
                  onSunPercentageChange?.(val);
                }
              }}
              fullWidth
              inputProps={{ min: 0, max: 100, step: 5 }}
              sx={{
                '& .MuiInputBase-input': {
                  fontSize: { xs: '16px', sm: '1rem' },
                }
              }}
            />
          )}
        </Box>
      )}

      {/* Notes */}
      <TextField
        label="Notes (Optional)"
        multiline
        rows={3}
        value={notes}
        onChange={(e) => onNotesChange(e.target.value)}
        placeholder="Add any additional notes about this survey..."
        fullWidth
        sx={{
          '& .MuiInputBase-input': {
            fontSize: { xs: '16px', sm: '1rem' },
          }
        }}
      />
    </Stack>
  );
}

/**
 * Check if the time fields have a validation error (end time not after start time).
 * Exported for use in parent components to block form submission.
 */
export function hasTimeValidationError(startTime: Dayjs | null, endTime: Dayjs | null): boolean {
  if (startTime && endTime && startTime.isValid() && endTime.isValid()) {
    return endTime.isBefore(startTime) || endTime.isSame(startTime);
  }
  return false;
}
