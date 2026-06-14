import {
  Typography,
  Paper,
  Stack,
  Alert,
  Autocomplete,
  TextField,
} from '@mui/material';
import { WizardNavigation } from './WizardNavigation';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import type { Dayjs } from 'dayjs';
import type { SurveyType, Device, Surveyor } from '../../services/api';

export interface SetupStepWizard {
  surveyTypes: SurveyType[];
  selectedSurveyType: SurveyType | null;
  setSelectedSurveyType: (v: SurveyType | null) => void;
  devices: Device[];
  selectedDevice: Device | null;
  setSelectedDevice: (v: Device | null) => void;
  date: Dayjs | null;
  setDate: (v: Dayjs | null) => void;
  surveyors: Surveyor[];
  selectedSurveyors: Surveyor[];
  setSelectedSurveyors: (v: Surveyor[]) => void;
  canProceed: (step: number) => boolean;
  setActiveStep: (step: number) => void;
}

interface SetupStepProps {
  wizard: SetupStepWizard;
  noDevicesText?: string;
}

export function SetupStep({ wizard, noDevicesText = 'No devices found. Add one in Admin > Devices.' }: SetupStepProps) {
  const {
    surveyTypes, selectedSurveyType, setSelectedSurveyType,
    devices, selectedDevice, setSelectedDevice,
    date, setDate,
    surveyors, selectedSurveyors, setSelectedSurveyors,
    canProceed, setActiveStep,
  } = wizard;

  return (
    <>
      <Paper sx={{ p: 3, mb: 3, boxShadow: 'none', border: '1px solid', borderColor: 'divider' }}>
        <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
          Survey Type
        </Typography>
        <Autocomplete
          options={surveyTypes}
          getOptionLabel={(option) => option.name}
          value={selectedSurveyType}
          onChange={(_, value) => setSelectedSurveyType(value)}
          renderInput={(params) => (
            <TextField {...params} label="Survey Type" required />
          )}
        />
      </Paper>

      {selectedSurveyType && (
        <Paper sx={{ p: 3, boxShadow: 'none', border: '1px solid', borderColor: 'divider' }}>
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
            Survey Details
          </Typography>
          <Stack spacing={3}>
            <Autocomplete
              options={devices}
              getOptionLabel={(option) =>
                option.name ? `${option.name} (${option.device_id})` : option.device_id
              }
              value={selectedDevice}
              onChange={(_, value) => setSelectedDevice(value)}
              renderInput={(params) => (
                <TextField {...params} label="Device" required />
              )}
              noOptionsText={noDevicesText}
            />
            {selectedDevice && !selectedDevice.latitude && (
              <Alert severity="warning">
                This device has no GPS coordinates set. Sightings will not have location data.
              </Alert>
            )}
            <DatePicker
              label="Date"
              value={date}
              onChange={setDate}
              slotProps={{ textField: { required: true, fullWidth: true } }}
            />
            <Autocomplete
              multiple
              options={surveyors}
              getOptionLabel={(option) => option.last_name ? `${option.first_name} ${option.last_name}` : option.first_name}
              value={selectedSurveyors}
              onChange={(_, value) => setSelectedSurveyors(value)}
              disableCloseOnSelect
              renderInput={(params) => (
                <TextField {...params} label="Surveyors" required />
              )}
            />
          </Stack>
          <WizardNavigation
            nextLabel="Next: Upload"
            onNext={() => setActiveStep(1)}
            nextDisabled={!canProceed(0)}
          />
        </Paper>
      )}
    </>
  );
}
