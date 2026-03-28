import { Box, Typography, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Chip, Stack, Button, Avatar, AvatarGroup, Tooltip, CircularProgress, Alert, Snackbar, Pagination, FormControl, Select, MenuItem } from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import { CalendarToday, Person, Visibility, Category, FilterList, PhotoCamera } from '@mui/icons-material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getSpeciesIcon, formatSpeciesCount } from '../config';
import { SurveyTypeChip } from '../components/SurveyTypeColors';
import { notionColors, tableSizing } from '../theme';
import { useState, useEffect, useRef } from 'react';
import { surveysAPI, surveyorsAPI, surveyTypesAPI } from '../services/api';
import type { Survey, Surveyor, PaginationMeta, SurveyType } from '../services/api';
import { getSurveyorName, getInitials, formatDate } from '../utils/formatters';

/**
 * SurveysPage displays a table of wildlife surveys with:
 * - Date, surveyors (avatar stack), species breakdown (chips with icons), and type
 * - Notion-style design with clean, minimal aesthetics
 * - Clickable rows that navigate to survey detail pages
 *
 * Species Breakdown Feature:
 * - Each survey shows species_breakdown from the API (e.g., [{type: "bird", count: 20}])
 * - Icons automatically displayed based on species type:
 *   - butterfly → ButterflyIcon (🦋)
 *   - bird → BirdIcon (🐦)
 *   - moth → MothIcon
 *   - insect → BugIcon (🐞)
 *   - gall → LeafIcon (🍃)
 *   - spider → SpiderIcon (🕷️)
 *   - bat → BatIcon (🦇)
 *   - mammal → MammalIcon (🦌)
 *   - reptile → ReptileIcon (🐍)
 *   - amphibian → AmphibianIcon (🐸)
 *   - fungi → MushroomIcon (🍄)
 * - Supports multiple species per survey (e.g., "🦋45 🐦23 🐍3")
 *
 * Following DEVELOPMENT.md conventions:
 * - Built inline first (no premature component extraction)
 * - Uses MUI components with theme integration
 * - Connected to real API (src/services/api.ts)
 */
export function SurveysPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { requireAuth } = useAuth();

  // ============================================================================
  // State Management
  // ============================================================================

  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [surveyors, setSurveyors] = useState<Surveyor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showToast, setShowToast] = useState(false);
  const [toastAction, setToastAction] = useState<'created' | 'edited' | 'deleted' | null>(null);
  const [highlightedSurveyId, setHighlightedSurveyId] = useState<number | null>(null);
  const highlightedRowRef = useRef<HTMLTableRowElement>(null);
  const hasProcessedAction = useRef(false);

  // Pagination state
  const [page, setPage] = useState(1);
  const [limit] = useState(25); // Fixed limit, could make this configurable
  const [paginationMeta, setPaginationMeta] = useState<PaginationMeta>({
    page: 1,
    limit: 25,
    total: 0,
    total_pages: 0
  });

  // Filter state
  const [surveyTypes, setSurveyTypes] = useState<SurveyType[]>([]);
  const [selectedSurveyTypeId, setSelectedSurveyTypeId] = useState<number | ''>('');

  // ============================================================================
  // Data Fetching
  // ============================================================================

  // Fetch survey types once on mount
  useEffect(() => {
    const fetchSurveyTypes = async () => {
      try {
        const types = await surveyTypesAPI.getAll();
        setSurveyTypes(types);
      } catch (err) {
        console.error('Error fetching survey types:', err);
      }
    };
    fetchSurveyTypes();
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Build query parameters
        const queryParams: { page: number; limit: number; survey_type_id?: number } = {
          page,
          limit
        };

        // Add survey type filter if selected
        if (selectedSurveyTypeId !== '') {
          queryParams.survey_type_id = selectedSurveyTypeId;
        }

        // Fetch surveys (paginated) and surveyors in parallel
        const [surveysResponse, surveyorsData] = await Promise.all([
          surveysAPI.getAll(queryParams),
          surveyorsAPI.getAll(),
        ]);

        setSurveys(surveysResponse.data);
        setPaginationMeta({
          page: surveysResponse.page,
          limit: surveysResponse.limit,
          total: surveysResponse.total,
          total_pages: surveysResponse.total_pages
        });
        setSurveyors(surveyorsData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load surveys');
        console.error('Error fetching data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [page, limit, selectedSurveyTypeId]); // Re-fetch when pagination or filter changes

  // ============================================================================
  // Handle created/edited/deleted survey toast and highlighting
  // ============================================================================

  useEffect(() => {
    const createdParam = searchParams.get('created');
    const editedParam = searchParams.get('edited');
    const deletedParam = searchParams.get('deleted');

    // For created/edited, wait until surveys are loaded before processing
    // For deleted, we can process immediately (no highlighting needed)
    const needsSurveys = createdParam || editedParam;
    const surveysReady = !needsSurveys || surveys.length > 0;

    if ((createdParam || editedParam || deletedParam) && !hasProcessedAction.current && surveysReady) {
      const surveyId = parseInt(createdParam || editedParam || deletedParam || '0');
      const action = createdParam ? 'created' : editedParam ? 'edited' : 'deleted';

      // Mark as processed to prevent re-running
      hasProcessedAction.current = true;

      // Set state for toast
      setToastAction(action);
      setShowToast(true);

      // For created/edited, highlight the row
      if (action === 'created' || action === 'edited') {
        setHighlightedSurveyId(surveyId);

        // Scroll to the highlighted row
        setTimeout(() => {
          highlightedRowRef.current?.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          });
        }, 100);

        // Clear highlighting after 3 seconds
        setTimeout(() => {
          setHighlightedSurveyId(null);
        }, 3000);
      }

      // Clear URL parameter immediately to prevent re-trigger on refresh
      setSearchParams({}, { replace: true });

      // Reset processed flag after action completes
      setTimeout(() => {
        hasProcessedAction.current = false;
      }, 3000);
    }
  }, [searchParams, surveys, setSearchParams]);

  // ============================================================================
  // Event Handlers
  // ============================================================================

  const handleRowClick = (surveyId: number) => {
    navigate(`/surveys/${surveyId}`);
  };

  const handleCreateClick = () => {
    requireAuth(() => navigate('/surveys/new'));
  };

  const handlePageChange = (_event: React.ChangeEvent<unknown>, value: number) => {
    setPage(value);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSurveyTypeFilterChange = (event: SelectChangeEvent<number | ''>) => {
    const value = event.target.value;
    setSelectedSurveyTypeId(value === '' ? '' : Number(value));
    setPage(1); // Reset to first page when filter changes
  };

  // ============================================================================
  // Render
  // ============================================================================

  // Show loading state
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <CircularProgress />
      </Box>
    );
  }

  // Show error state
  if (error) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
        <Button variant="contained" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 2, sm: 3, md: 4 } }}>
      {/* Filters and Action Button */}
      <Stack direction="row" spacing={2} sx={{ mb: 2 }} alignItems="center" justifyContent="space-between">
        <Stack direction="row" spacing={2} alignItems="center">
          <FilterList sx={{ color: 'text.secondary', fontSize: 20 }} />
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <Select
              value={selectedSurveyTypeId}
              onChange={handleSurveyTypeFilterChange}
              displayEmpty
              sx={{
                fontSize: '0.875rem',
                '& .MuiSelect-select': {
                  py: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1
                }
              }}
            >
              <MenuItem value="">
                <em>All Survey Types</em>
              </MenuItem>
              {surveyTypes.map((type) => (
                <MenuItem key={type.id} value={type.id}>
                  <SurveyTypeChip name={type.name} color={type.color} size="small" />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            size="medium"
            startIcon={<PhotoCamera />}
            onClick={() => requireAuth(() => navigate('/surveys/new/camera-trap'))}
            sx={{
              textTransform: 'none',
              fontWeight: 600,
              boxShadow: 'none',
              '&:hover': { boxShadow: 'none' }
            }}
          >
            Camera Trap
          </Button>
          <Button
            variant="contained"
            size="medium"
            onClick={handleCreateClick}
            sx={{
              textTransform: 'none',
              fontWeight: 600,
              boxShadow: 'none',
              '&:hover': { boxShadow: 'none' }
            }}
          >
            New
          </Button>
        </Stack>
      </Stack>

      {/* Surveys Table */}
      <TableContainer
        component={Paper}
        sx={{
          boxShadow: 'none',
          border: '1px solid',
          borderColor: 'divider'
        }}
      >
        <Table sx={{ minWidth: { xs: 300, sm: 500, md: 650 } }}>
          {/* Table Header */}
          <TableHead>
            <TableRow sx={{ bgcolor: 'grey.50' }}>
              <TableCell
                sx={{
                  fontWeight: 500,
                  fontSize: tableSizing.header.fontSize,
                  color: 'text.secondary',
                  textTransform: 'uppercase',
                  letterSpacing: '0.3px',
                  py: tableSizing.header.py,
                  px: tableSizing.header.px,
                }}
              >
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <CalendarToday sx={{ fontSize: tableSizing.header.iconSize }} />
                  <span>Date</span>
                </Stack>
              </TableCell>
              <TableCell
                sx={{
                  fontWeight: 500,
                  fontSize: tableSizing.header.fontSize,
                  color: 'text.secondary',
                  textTransform: 'uppercase',
                  letterSpacing: '0.3px',
                  py: tableSizing.header.py,
                  px: tableSizing.header.px,
                }}
              >
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <Category sx={{ fontSize: tableSizing.header.iconSize }} />
                  <span>Survey Type</span>
                </Stack>
              </TableCell>
              <TableCell
                sx={{
                  fontWeight: 500,
                  fontSize: tableSizing.header.fontSize,
                  color: 'text.secondary',
                  textTransform: 'uppercase',
                  letterSpacing: '0.3px',
                  py: tableSizing.header.py,
                  px: tableSizing.header.px,
                  display: { xs: 'none', sm: 'table-cell' }, // 3rd to hide
                }}
              >
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <Visibility sx={{ fontSize: tableSizing.header.iconSize }} />
                  <span>Species</span>
                </Stack>
              </TableCell>
              <TableCell
                sx={{
                  fontWeight: 500,
                  fontSize: tableSizing.header.fontSize,
                  color: 'text.secondary',
                  textTransform: 'uppercase',
                  letterSpacing: '0.3px',
                  py: tableSizing.header.py,
                  px: tableSizing.header.px,
                  display: { xs: 'none', md: 'table-cell' }, // 2nd to hide
                }}
              >
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <Person sx={{ fontSize: tableSizing.header.iconSize }} />
                  <span>Surveyors</span>
                </Stack>
              </TableCell>
            </TableRow>
          </TableHead>

          {/* Table Body - Survey Rows */}
          <TableBody>
            {surveys.map((survey) => {
              const surveyorNames = survey.surveyor_ids.map(id => getSurveyorName(id, surveyors));
              const isHighlighted = survey.id === highlightedSurveyId;

              return (
                <TableRow
                  key={survey.id}
                  ref={isHighlighted ? highlightedRowRef : null}
                  onClick={() => handleRowClick(survey.id)}
                  sx={{
                    bgcolor: isHighlighted ? 'rgba(219, 237, 219, 0.7)' : 'transparent',
                    transition: 'background-color 0.5s ease-out',
                    '&:hover': { bgcolor: isHighlighted ? 'rgba(219, 237, 219, 0.85)' : 'grey.50' },
                    cursor: 'pointer',
                    borderBottom: '1px solid',
                    borderColor: 'divider'
                  }}
                >
                  {/* Date Column - always visible */}
                  <TableCell sx={{ py: tableSizing.row.py, px: tableSizing.row.px, fontSize: tableSizing.row.fontSize }}>
                    {formatDate(survey.date)}
                  </TableCell>

                  {/* Survey Type Column - always visible */}
                  <TableCell sx={{ py: tableSizing.row.py, px: tableSizing.row.px, fontSize: tableSizing.row.fontSize, color: 'text.secondary' }}>
                    {survey.survey_type_name ? (
                      <SurveyTypeChip name={survey.survey_type_name} color={survey.survey_type_color} size="small" />
                    ) : (
                      '—'
                    )}
                  </TableCell>

                  {/* Species Column - 3rd to hide (sm+) */}
                  <TableCell sx={{ py: tableSizing.row.py, px: tableSizing.row.px, display: { xs: 'none', sm: 'table-cell' } }}>
                    <Stack direction="row" flexWrap="wrap" gap={1}>
                      {survey.species_breakdown.map((sighting, idx) => {
                        const Icon = getSpeciesIcon(sighting.type);
                        const speciesLabel = formatSpeciesCount(sighting.type, sighting.count);

                        return (
                          <Tooltip key={idx} title={speciesLabel} arrow>
                            <Chip
                              icon={<Icon sx={{ fontSize: '16px !important', ml: '6px !important' }} />}
                              label={sighting.count}
                              size="small"
                              sx={{
                                bgcolor: notionColors.gray.background,
                                color: notionColors.gray.text,
                                fontWeight: 500,
                                fontSize: tableSizing.chip.fontSize,
                                height: tableSizing.chip.height,
                                borderRadius: '4px',
                                '& .MuiChip-label': {
                                  px: 1,
                                  py: 0
                                }
                              }}
                            />
                          </Tooltip>
                        );
                      })}
                      {survey.species_breakdown.length === 0 && (
                        <Chip
                          label="0 sightings"
                          size="small"
                          sx={{
                            bgcolor: notionColors.gray.background,
                            color: notionColors.gray.text,
                            fontWeight: 500,
                            fontSize: tableSizing.chip.fontSize,
                            height: tableSizing.chip.height,
                            borderRadius: '4px',
                            '& .MuiChip-label': {
                              px: 1,
                              py: 0
                            }
                          }}
                        />
                      )}
                    </Stack>
                  </TableCell>

                  {/* Surveyors Column - 2nd to hide (md+) */}
                  <TableCell sx={{ py: tableSizing.row.py, px: tableSizing.row.px, display: { xs: 'none', md: 'table-cell' } }}>
                    <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
                      <AvatarGroup
                        max={4}
                        sx={{
                          '& .MuiAvatar-root': {
                            width: tableSizing.avatar.size,
                            height: tableSizing.avatar.size,
                            fontSize: tableSizing.avatar.fontSize,
                            bgcolor: 'text.secondary',
                            border: '2px solid white',
                          }
                        }}
                      >
                        {surveyorNames.map((name, idx) => (
                          <Tooltip key={idx} title={name} arrow>
                            <Avatar alt={name}>
                              {getInitials(name)}
                            </Avatar>
                          </Tooltip>
                        ))}
                      </AvatarGroup>
                    </Box>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Pagination Controls */}
      {paginationMeta.total_pages > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 3, flexDirection: { xs: 'column', sm: 'row' }, gap: 2 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: { xs: '0.75rem', sm: '0.875rem' } }}>
            {/* More concise text on mobile */}
            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
              Showing {surveys.length === 0 ? 0 : ((page - 1) * limit) + 1} to {Math.min(page * limit, paginationMeta.total)} of {paginationMeta.total} surveys
            </Box>
            <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>
              {surveys.length === 0 ? 0 : ((page - 1) * limit) + 1}-{Math.min(page * limit, paginationMeta.total)} of {paginationMeta.total}
            </Box>
          </Typography>
          <Pagination
            count={paginationMeta.total_pages}
            page={page}
            onChange={handlePageChange}
            color="primary"
            shape="rounded"
            showFirstButton
            showLastButton
            size="large"
            sx={{
              '& .MuiPaginationItem-root': {
                fontSize: '0.95rem',
                minWidth: { xs: '36px', sm: '40px' },
                height: { xs: '36px', sm: '40px' }
              }
            }}
          />
        </Box>
      )}

      {/* Toast Notification */}
      <Snackbar
        open={showToast}
        autoHideDuration={4000}
        onClose={() => setShowToast(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setShowToast(false)}
          severity={toastAction === 'deleted' ? 'error' : 'success'}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {toastAction === 'created' && 'Survey created successfully'}
          {toastAction === 'edited' && 'Survey updated successfully'}
          {toastAction === 'deleted' && 'Survey deleted successfully'}
        </Alert>
      </Snackbar>
    </Box>
  );
}
