/**
 * API Client Service
 *
 * Centralized API client for all backend communication.
 * Following DEVELOPMENT.md conventions:
 * - Built inline first (no premature abstraction)
 * - Simple fetch-based implementation
 * - Ready to be enhanced with React Query later
 */

// API base URL - uses environment variable if available, otherwise falls back to auto-detection
const getApiBaseUrl = () => {
  // First check if environment variable is set (for production deployments)
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }

  // If accessed via localhost or 127.0.0.1, use localhost for backend
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://localhost:8000/api';
  }
  // Otherwise (e.g., accessed via 192.168.x.x from mobile), use the same host
  return `http://${window.location.hostname}:8000/api`;
};

/**
 * Extract organisation slug from the current hostname.
 *
 * Patterns supported:
 *   - {org}.canopydata.app → {org} (new custom domains)
 *   - {org}data.up.railway.app → {org} (legacy Railway domains)
 *   - localhost → heal (default for development)
 *
 * Examples:
 *   - heal.canopydata.app → heal
 *   - cannwood.canopydata.app → cannwood
 *   - healdata.up.railway.app → heal
 *   - cannwooddata.up.railway.app → cannwood
 */
const getOrgSlug = (): string => {
  const hostname = window.location.hostname;

  // Local development defaults to 'heal'
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    // Allow override via URL param for local testing: ?org=cannwood
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('org') || 'heal';
  }

  // New custom domain pattern: {org}.canopydata.app
  const canopyMatch = hostname.match(/^([a-z]+)\.canopydata\.app$/);
  if (canopyMatch) {
    return canopyMatch[1];
  }

  // Legacy Railway pattern: {org}data.up.railway.app
  const railwayMatch = hostname.match(/^([a-z]+)data\.up\.railway\.app$/);
  if (railwayMatch) {
    return railwayMatch[1];
  }

  // Fallback: try to extract from any subdomain pattern {org}data.{domain}
  const fallbackMatch = hostname.match(/^([a-z]+)data\./);
  if (fallbackMatch) {
    return fallbackMatch[1];
  }

  // Default to 'heal' if no pattern matches
  return 'heal';
};

const API_BASE_URL = getApiBaseUrl();
const ORG_SLUG = getOrgSlug();

// Export org slug for use in theming and conditional UI
export { ORG_SLUG, getOrgSlug };

// Token storage key
const AUTH_TOKEN_KEY = 'admin_session_token';

/**
 * Get stored auth token from localStorage
 */
const getAuthToken = (): string | null => {
  return localStorage.getItem(AUTH_TOKEN_KEY);
};

/**
 * Store auth token in localStorage
 */
const setAuthToken = (token: string): void => {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
};

/**
 * Remove auth token from localStorage
 */
const clearAuthToken = (): void => {
  localStorage.removeItem(AUTH_TOKEN_KEY);
};

/**
 * Generic fetch wrapper with error handling
 */
async function fetchAPI<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;

  // Build headers with auth token if available
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Org-Slug': ORG_SLUG,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(url, {
      ...options,
      credentials: 'include',
      headers: {
        ...headers,
        ...options?.headers,
      },
    });

    if (!response.ok) {
      let errorMessage = `API error: ${response.status}`;
      try {
        const error = await response.json();
        // Handle error.detail which could be a string or an object (FastAPI validation errors)
        if (error.detail) {
          if (typeof error.detail === 'string') {
            errorMessage = error.detail;
          } else if (Array.isArray(error.detail)) {
            // FastAPI validation errors come as an array of objects with msg, loc, type
            errorMessage = error.detail.map((e: any) => e.msg || JSON.stringify(e)).join(', ');
          } else if (typeof error.detail === 'object') {
            errorMessage = error.detail.msg || error.detail.message || JSON.stringify(error.detail);
          }
        }
      } catch {
        // If response body isn't JSON, try to get it as text
        try {
          const text = await response.text();
          if (text) errorMessage = text;
        } catch {
          // Ignore if we can't read the response
        }
      }
      throw new Error(errorMessage);
    }

    // Handle 204 No Content responses
    if (response.status === 204) {
      return undefined as T;
    }

    // Get the response text first
    const responseText = await response.text();

    // If response is empty, return undefined
    if (!responseText || responseText.trim() === '') {
      return undefined as T;
    }

    // Try to parse as JSON
    try {
      return JSON.parse(responseText);
    } catch (parseError) {
      throw new Error(`Failed to parse response as JSON. Response: ${responseText.substring(0, 200)}`);
    }
  } catch (error) {
    console.error('API request failed:', {
      endpoint,
      method: options?.method || 'GET',
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

/**
 * Generic file upload helper for audio/image uploads
 * Handles FormData construction and authentication headers
 */
async function uploadMediaFiles<T>(endpoint: string, files: File[]): Promise<T> {
  const formData = new FormData();
  files.forEach(file => formData.append('files', file));

  const token = getAuthToken();
  const headers: Record<string, string> = {
    'X-Org-Slug': ORG_SLUG,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: formData,
  });

  if (!response.ok) {
    let errorMessage = `Upload failed: ${response.status}`;
    try {
      const error = await response.json();
      if (error.detail) {
        errorMessage = typeof error.detail === 'string' ? error.detail : JSON.stringify(error.detail);
      }
    } catch {
      // Ignore parse errors
    }
    throw new Error(errorMessage);
  }

  return response.json();
}

// ============================================================================
// Type Definitions
// ============================================================================

export interface Surveyor {
  id: number;
  first_name: string;
  last_name: string | null;
  is_active: boolean;
}

export interface Species {
  id: number;
  name: string | null;
  scientific_name: string | null;
  conservation_status: string | null;
  species_type_id: number;
  type: string;  // Derived from species_type.name, for display purposes
  species_code: string | null;
}

export interface Location {
  id: number;
  name: string;
}

/**
 * Location with optional boundary geometry for map display
 */
export interface LocationWithBoundary extends Location {
  boundary_geometry: [number, number][] | null; // Array of [lng, lat] coordinate pairs
  boundary_fill_color: string | null;
  boundary_stroke_color: string | null;
  boundary_fill_opacity: number | null;
}

/**
 * Species type count from API species_breakdown field
 * Used to display species-specific icons and counts in the UI
 */
export interface SpeciesTypeCount {
  type: string;  // "butterfly", "bird", or "fungi"
  count: number; // Number of sightings of this type
}

export interface Survey {
  id: number;
  date: string;
  start_time: string | null;
  end_time: string | null;
  sun_percentage: number | null;
  temperature_celsius: string | null;
  conditions_met: boolean | null;
  notes: string | null;
  location_id: number | null;
  device_id: number | null;
  surveyor_ids: number[];
  sightings_count: number; // Total count across all species
  species_breakdown: SpeciesTypeCount[]; // Breakdown by species type
  survey_type_id: number | null;
  survey_type_name: string | null;
  survey_type_icon: string | null;
  survey_type_color: string | null;
}

/**
 * Pagination metadata returned by paginated endpoints
 */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

/**
 * Query parameters for fetching surveys
 */
export interface SurveyQueryParams {
  page?: number;
  limit?: number;
  start_date?: string; // YYYY-MM-DD format
  end_date?: string; // YYYY-MM-DD format
  survey_type_id?: number; // Filter by survey type ID
}

export interface SurveyDetail extends Omit<Survey, 'sightings_count'> {
  surveyors?: Surveyor[];
}

export interface Sighting {
  id: number;
  survey_id: number;
  species_id: number;
  count: number;
  species_name?: string | null;
  species_scientific_name?: string | null;
  individuals?: IndividualLocation[]; // Individual locations with breeding status
  location_id?: number | null; // Location ID when location is at sighting level
  notes?: string | null; // Optional notes for this sighting
}

/**
 * BTO Breeding Status Codes (for bird sightings only)
 */
export type BreedingCategory = 'non_breeding' | 'possible_breeder' | 'probable_breeder' | 'confirmed_breeder';

export interface BreedingStatusCode {
  code: string;
  description: string;
  full_description: string | null;
  category: BreedingCategory;
}

/**
 * Individual location within a sighting with optional breeding status
 */
export interface IndividualLocation {
  id?: number;
  latitude: number;
  longitude: number;
  count: number;
  breeding_status_code?: string | null;
  notes?: string | null;
  camera_trap_image_id?: number | null;
}

/**
 * Sighting with individual location points
 */
export interface SightingWithIndividuals extends Sighting {
  individuals: IndividualLocation[];
}

/**
 * Request body for creating a sighting (with optional individual locations)
 */
export interface SightingCreateRequest {
  species_id: number;
  count: number;
  individuals?: Omit<IndividualLocation, 'id'>[];
  location_id?: number | null; // Location ID when location is at sighting level
  notes?: string | null; // Optional notes for this sighting
}

/**
 * Dashboard data types
 */
export interface CumulativeSpeciesDataPoint {
  date: string; // ISO date string "YYYY-MM-DD"
  type: string; // Species type: "bird", "butterfly", etc.
  cumulative_count: number;
  new_species: string[]; // Names of species first seen on this date
}

export interface CumulativeSpeciesResponse {
  data: CumulativeSpeciesDataPoint[];
  date_range: {
    start: string;
    end: string;
  };
}

export interface SpeciesOccurrenceDataPoint {
  survey_date: string; // ISO date string "YYYY-MM-DD"
  survey_id: number;
  occurrence_count: number;
}

export interface SpeciesOccurrenceResponse {
  data: SpeciesOccurrenceDataPoint[];
  date_range: {
    start: string;
    end: string;
  };
  species_name: string;
}

export interface SpeciesWithCount {
  id: number;
  name: string | null;
  scientific_name: string | null;
  type: string;
  total_count: number;
}

export interface SpeciesSightingLocation {
  id: number;
  survey_id: number;
  species_id: number;
  survey_date: string;
  latitude: number;
  longitude: number;
  species_name: string | null;
  species_scientific_name: string | null;
  breeding_status_code: string | null;
  breeding_status_description: string | null;
  survey_type_id: number | null;
  survey_type_name: string | null;
  survey_type_icon: string | null;
  survey_type_color: string | null;
}

// ============================================================================
// Survey Type Definitions
// ============================================================================

/**
 * Species type reference (e.g., bird, mammal, butterfly)
 */
export interface SpeciesTypeRef {
  id: number;
  name: string;
  display_name: string;
}

/**
 * Survey type configuration
 */
export interface SurveyType {
  id: number;
  name: string;
  description: string | null;
  location_at_sighting_level: boolean;
  allow_geolocation: boolean;
  allow_sighting_notes: boolean;
  allow_audio_upload: boolean;
  allow_image_upload: boolean;
  icon: string | null;
  color: string | null;
  is_active: boolean;
}

/**
 * Survey type with full details including locations and species types
 */
export interface SurveyTypeWithDetails extends SurveyType {
  locations: Location[];
  species_types: SpeciesTypeRef[];
}

/**
 * Request body for creating a survey type
 */
export interface SurveyTypeCreate {
  name: string;
  description?: string;
  location_at_sighting_level: boolean;
  allow_geolocation: boolean;
  allow_sighting_notes: boolean;
  allow_audio_upload: boolean;
  allow_image_upload: boolean;
  icon?: string;
  color?: string;
  location_ids: number[];
  species_type_ids: number[];
}

/**
 * Request body for updating a survey type
 */
export interface SurveyTypeUpdate {
  name?: string;
  description?: string;
  location_at_sighting_level?: boolean;
  allow_geolocation?: boolean;
  allow_sighting_notes?: boolean;
  allow_audio_upload?: boolean;
  allow_image_upload?: boolean;
  icon?: string;
  color?: string;
  is_active?: boolean;
  location_ids?: number[];
  species_type_ids?: number[];
}

// ============================================================================
// API Methods - Surveys
// ============================================================================

export const surveysAPI = {
  /**
   * Get surveys with pagination and optional filters
   */
  getAll: (params?: SurveyQueryParams): Promise<PaginatedResponse<Survey>> => {
    const queryParams = new URLSearchParams();

    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.start_date) queryParams.append('start_date', params.start_date);
    if (params?.end_date) queryParams.append('end_date', params.end_date);
    if (params?.survey_type_id) queryParams.append('survey_type_id', params.survey_type_id.toString());

    const queryString = queryParams.toString();
    const endpoint = queryString ? `/surveys?${queryString}` : '/surveys';

    return fetchAPI(endpoint);
  },

  /**
   * Get a specific survey by ID
   */
  getById: (id: number): Promise<SurveyDetail> => {
    return fetchAPI(`/surveys/${id}`);
  },

  /**
   * Create a new survey
   */
  create: (survey: Partial<Survey>): Promise<Survey> => {
    return fetchAPI('/surveys', {
      method: 'POST',
      body: JSON.stringify(survey),
    });
  },

  /**
   * Update an existing survey
   */
  update: (id: number, survey: Partial<Survey>): Promise<Survey> => {
    return fetchAPI(`/surveys/${id}`, {
      method: 'PUT',
      body: JSON.stringify(survey),
    });
  },

  /**
   * Delete a survey
   */
  delete: (id: number): Promise<void> => {
    return fetchAPI(`/surveys/${id}`, {
      method: 'DELETE',
    });
  },

  /**
   * Get sightings for a specific survey
   */
  getSightings: (surveyId: number): Promise<Sighting[]> => {
    return fetchAPI(`/surveys/${surveyId}/sightings`);
  },

  /**
   * Add a sighting to a survey (with optional individual locations)
   */
  addSighting: (surveyId: number, sighting: SightingCreateRequest): Promise<SightingWithIndividuals> => {
    return fetchAPI(`/surveys/${surveyId}/sightings`, {
      method: 'POST',
      body: JSON.stringify(sighting),
    });
  },

  /**
   * Update a sighting in a survey
   */
  updateSighting: (surveyId: number, sightingId: number, sighting: Partial<Sighting>): Promise<Sighting> => {
    return fetchAPI(`/surveys/${surveyId}/sightings/${sightingId}`, {
      method: 'PUT',
      body: JSON.stringify(sighting),
    });
  },

  /**
   * Delete a sighting from a survey
   */
  deleteSighting: (surveyId: number, sightingId: number): Promise<void> => {
    return fetchAPI(`/surveys/${surveyId}/sightings/${sightingId}`, {
      method: 'DELETE',
    });
  },

  /**
   * Get all BTO breeding status codes (for bird sightings)
   */
  getBreedingCodes: (): Promise<BreedingStatusCode[]> => {
    return fetchAPI('/surveys/breeding-codes');
  },

  /**
   * Add an individual location to an existing sighting
   */
  addIndividualLocation: (
    surveyId: number,
    sightingId: number,
    individual: Omit<IndividualLocation, 'id'>
  ): Promise<IndividualLocation> => {
    return fetchAPI(`/surveys/${surveyId}/sightings/${sightingId}/individuals`, {
      method: 'POST',
      body: JSON.stringify(individual),
    });
  },

  /**
   * Update an individual location
   */
  updateIndividualLocation: (
    surveyId: number,
    sightingId: number,
    individualId: number,
    individual: Omit<IndividualLocation, 'id'>
  ): Promise<IndividualLocation> => {
    return fetchAPI(`/surveys/${surveyId}/sightings/${sightingId}/individuals/${individualId}`, {
      method: 'PUT',
      body: JSON.stringify(individual),
    });
  },

  /**
   * Delete an individual location from a sighting
   */
  deleteIndividualLocation: (surveyId: number, sightingId: number, individualId: number): Promise<void> => {
    return fetchAPI(`/surveys/${surveyId}/sightings/${sightingId}/individuals/${individualId}`, {
      method: 'DELETE',
    });
  },
};

// ============================================================================
// API Methods - Surveyors
// ============================================================================

export const surveyorsAPI = {
  /**
   * Get all surveyors
   */
  getAll: (includeInactive: boolean = false): Promise<Surveyor[]> => {
    const query = includeInactive ? '?include_inactive=true' : '';
    return fetchAPI(`/surveyors${query}`);
  },

  /**
   * Get a specific surveyor by ID
   */
  getById: (id: number): Promise<Surveyor> => {
    return fetchAPI(`/surveyors/${id}`);
  },

  /**
   * Create a new surveyor
   */
  create: (surveyor: Partial<Surveyor>): Promise<Surveyor> => {
    return fetchAPI('/surveyors', {
      method: 'POST',
      body: JSON.stringify(surveyor),
    });
  },

  /**
   * Update an existing surveyor
   */
  update: (id: number, surveyor: Partial<Surveyor>): Promise<Surveyor> => {
    return fetchAPI(`/surveyors/${id}`, {
      method: 'PUT',
      body: JSON.stringify(surveyor),
    });
  },

  /**
   * Delete a surveyor (hard delete - use deactivate instead)
   */
  delete: (id: number): Promise<void> => {
    return fetchAPI(`/surveyors/${id}`, {
      method: 'DELETE',
    });
  },

  /**
   * Deactivate a surveyor (soft delete)
   */
  deactivate: (id: number): Promise<Surveyor> => {
    return fetchAPI(`/surveyors/${id}/deactivate`, {
      method: 'POST',
    });
  },

  /**
   * Reactivate a surveyor
   */
  reactivate: (id: number): Promise<Surveyor> => {
    return fetchAPI(`/surveyors/${id}/reactivate`, {
      method: 'POST',
    });
  },
};

// ============================================================================
// Device Types (Audio Recorder & Camera Trap Devices)
// ============================================================================

export type DeviceType = 'audio_recorder' | 'camera_trap';

export interface Device {
  id: number;
  device_id: string;
  name: string | null;
  device_type: DeviceType;
  latitude: number | null;
  longitude: number | null;
  location_id: number | null;
  location_name: string | null;
  is_active: boolean;
}

export interface DeviceCreate {
  device_id: string;
  name?: string;
  device_type?: DeviceType;
  latitude?: number;
  longitude?: number;
  location_id?: number;
}

export interface DeviceUpdate {
  device_id?: string;
  name?: string;
  device_type?: DeviceType;
  latitude?: number;
  longitude?: number;
  location_id?: number;
  is_active?: boolean;
}

// ============================================================================
// API Methods - Devices
// ============================================================================

export const devicesAPI = {
  /**
   * Get all devices
   */
  getAll: (includeInactive: boolean = false, deviceType?: string): Promise<Device[]> => {
    const params = new URLSearchParams();
    if (includeInactive) params.append('include_inactive', 'true');
    if (deviceType) params.append('device_type', deviceType);
    const query = params.toString();
    return fetchAPI(`/devices${query ? `?${query}` : ''}`);
  },

  /**
   * Get a specific device by ID
   */
  getById: (id: number): Promise<Device> => {
    return fetchAPI(`/devices/${id}`);
  },

  /**
   * Get a device by its serial number (device_id field)
   */
  getByDeviceId: (deviceId: string): Promise<Device> => {
    return fetchAPI(`/devices/by-device-id/${encodeURIComponent(deviceId)}`);
  },

  /**
   * Create a new device
   */
  create: (device: DeviceCreate): Promise<Device> => {
    return fetchAPI('/devices', {
      method: 'POST',
      body: JSON.stringify(device),
    });
  },

  /**
   * Update an existing device
   */
  update: (id: number, device: DeviceUpdate): Promise<Device> => {
    return fetchAPI(`/devices/${id}`, {
      method: 'PUT',
      body: JSON.stringify(device),
    });
  },

  /**
   * Delete a device (hard delete - use deactivate instead)
   */
  delete: (id: number): Promise<void> => {
    return fetchAPI(`/devices/${id}`, {
      method: 'DELETE',
    });
  },

  /**
   * Deactivate a device (soft delete)
   */
  deactivate: (id: number): Promise<Device> => {
    return fetchAPI(`/devices/${id}/deactivate`, {
      method: 'POST',
    });
  },

  /**
   * Reactivate a device
   */
  reactivate: (id: number): Promise<Device> => {
    return fetchAPI(`/devices/${id}/reactivate`, {
      method: 'POST',
    });
  },
};

// ============================================================================
// API Methods - Species
// ============================================================================

export const speciesAPI = {
  /**
   * Get all species
   */
  getAll: (surveyType?: string): Promise<Species[]> => {
    const query = surveyType ? `?survey_type=${surveyType}` : '';
    return fetchAPI(`/species${query}`);
  },

  /**
   * Get a specific species by ID
   */
  getById: (id: number): Promise<Species> => {
    return fetchAPI(`/species/${id}`);
  },

  /**
   * Create a new species
   */
  create: (species: Partial<Species>): Promise<Species> => {
    return fetchAPI('/species', {
      method: 'POST',
      body: JSON.stringify(species),
    });
  },

  /**
   * Update an existing species
   */
  update: (id: number, species: Partial<Species>): Promise<Species> => {
    return fetchAPI(`/species/${id}`, {
      method: 'PUT',
      body: JSON.stringify(species),
    });
  },

  /**
   * Delete a species
   */
  delete: (id: number): Promise<void> => {
    return fetchAPI(`/species/${id}`, {
      method: 'DELETE',
    });
  },

  /**
   * Get species available for a specific survey type
   */
  getBySurveyType: (surveyTypeId: number): Promise<Species[]> => {
    return fetchAPI(`/species/by-survey-type/${surveyTypeId}`);
  },
};

// ============================================================================
// API Methods - Locations
// ============================================================================

export const locationsAPI = {
  /**
   * Get all locations
   */
  getAll: (surveyType?: string): Promise<Location[]> => {
    const query = surveyType ? `?survey_type=${surveyType}` : '';
    return fetchAPI(`/locations${query}`);
  },

  /**
   * Get all locations that have boundary geometry defined
   * Used to display field boundaries on maps regardless of selected location
   */
  getAllWithBoundaries: (): Promise<LocationWithBoundary[]> => {
    return fetchAPI('/locations/with-boundaries');
  },

  /**
   * Get a specific location by ID
   */
  getById: (id: number): Promise<Location> => {
    return fetchAPI(`/locations/${id}`);
  },

  /**
   * Create a new location
   */
  create: (location: Partial<Location>): Promise<Location> => {
    return fetchAPI('/locations', {
      method: 'POST',
      body: JSON.stringify(location),
    });
  },

  /**
   * Update an existing location
   */
  update: (id: number, location: Partial<Location>): Promise<Location> => {
    return fetchAPI(`/locations/${id}`, {
      method: 'PUT',
      body: JSON.stringify(location),
    });
  },

  /**
   * Delete a location
   */
  delete: (id: number): Promise<void> => {
    return fetchAPI(`/locations/${id}`, {
      method: 'DELETE',
    });
  },

  /**
   * Get locations available for a specific survey type
   */
  getBySurveyType: (surveyTypeId: number): Promise<Location[]> => {
    return fetchAPI(`/locations/by-survey-type/${surveyTypeId}`);
  },
};

// ============================================================================
// API Methods - Survey Types
// ============================================================================

export const surveyTypesAPI = {
  /**
   * Get all survey types
   */
  getAll: (includeInactive: boolean = false): Promise<SurveyType[]> => {
    const query = includeInactive ? '?include_inactive=true' : '';
    return fetchAPI(`/survey-types${query}`);
  },

  /**
   * Get a specific survey type by ID with full details
   */
  getById: (id: number): Promise<SurveyTypeWithDetails> => {
    return fetchAPI(`/survey-types/${id}`);
  },

  /**
   * Create a new survey type
   */
  create: (surveyType: SurveyTypeCreate): Promise<SurveyType> => {
    return fetchAPI('/survey-types', {
      method: 'POST',
      body: JSON.stringify(surveyType),
    });
  },

  /**
   * Update an existing survey type
   */
  update: (id: number, surveyType: SurveyTypeUpdate): Promise<SurveyType> => {
    return fetchAPI(`/survey-types/${id}`, {
      method: 'PUT',
      body: JSON.stringify(surveyType),
    });
  },

  /**
   * Delete (deactivate) a survey type
   */
  delete: (id: number): Promise<void> => {
    return fetchAPI(`/survey-types/${id}`, {
      method: 'DELETE',
    });
  },

  /**
   * Reactivate a deactivated survey type
   */
  reactivate: (id: number): Promise<SurveyType> => {
    return fetchAPI(`/survey-types/${id}/reactivate`, {
      method: 'POST',
    });
  },

  /**
   * Get all species types (reference data)
   */
  getSpeciesTypes: (): Promise<SpeciesTypeRef[]> => {
    return fetchAPI('/survey-types/species-types');
  },
};

// ============================================================================
// API Methods - Dashboard
// ============================================================================

export const dashboardAPI = {
  /**
   * Get species types that have at least one sighting entry
   */
  getSpeciesTypesWithEntries: (): Promise<string[]> => {
    return fetchAPI('/dashboard/species-types-with-entries');
  },

  /**
   * Get cumulative species counts over time for dashboard chart
   */
  getCumulativeSpecies: (speciesTypes?: string[]): Promise<CumulativeSpeciesResponse> => {
    const params = new URLSearchParams();
    if (speciesTypes && speciesTypes.length > 0) {
      speciesTypes.forEach(type => params.append('species_types', type));
    }
    const query = params.toString();
    return fetchAPI(query ? `/dashboard/cumulative-species?${query}` : '/dashboard/cumulative-species');
  },

  /**
   * Get species ordered by occurrence count
   */
  getSpeciesByCount: (speciesType: string): Promise<SpeciesWithCount[]> => {
    return fetchAPI(`/dashboard/species-by-count?species_type=${speciesType}`);
  },

  /**
   * Get weekly occurrence counts for a specific species
   */
  getSpeciesOccurrences: (speciesId: number, startDate?: string, endDate?: string): Promise<SpeciesOccurrenceResponse> => {
    const params = new URLSearchParams();
    params.append('species_id', speciesId.toString());
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    return fetchAPI(`/dashboard/species-occurrences?${params.toString()}`);
  },

  /**
   * Get all sightings with location data for a specific species
   */
  getSpeciesSightings: (speciesId: number, startDate?: string, endDate?: string): Promise<SpeciesSightingLocation[]> => {
    const params = new URLSearchParams();
    params.append('species_id', speciesId.toString());
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    return fetchAPI(`/dashboard/species-sightings?${params.toString()}`);
  },
};

// ============================================================================
// Health Check
// ============================================================================

export const healthAPI = {
  /**
   * Check if API is healthy
   */
  check: (): Promise<{ status: string; version: string }> => {
    return fetchAPI('/health');
  },
};

// ============================================================================
// Organisation Types
// ============================================================================

export interface Organisation {
  id: number;
  name: string;
  slug: string;
}

export interface AuthStatus {
  authenticated: boolean;
  organisation: Organisation;
}

// ============================================================================
// API Methods - Auth
// ============================================================================

// ============================================================================
// API Methods - Export
// ============================================================================

export const exportAPI = {
  /**
   * Download organisation data as a SQLite database file.
   * Returns a Blob that can be saved as a .sqlite file.
   */
  downloadSqlite: async (): Promise<void> => {
    const token = getAuthToken();
    const headers: Record<string, string> = {
      'X-Org-Slug': ORG_SLUG,
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE_URL}/export/sqlite`, {
      credentials: 'include',
      headers,
    });

    if (!response.ok) {
      let errorMessage = `Export failed: ${response.status}`;
      try {
        const error = await response.json();
        if (error.detail) {
          errorMessage = typeof error.detail === 'string' ? error.detail : JSON.stringify(error.detail);
        }
      } catch {
        // Ignore parse errors
      }
      throw new Error(errorMessage);
    }

    // Extract filename from Content-Disposition header
    const disposition = response.headers.get('Content-Disposition');
    const filenameMatch = disposition?.match(/filename="(.+)"/);
    const filename = filenameMatch ? filenameMatch[1] : `export_${Date.now()}.sqlite`;

    // Download the blob
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};

export const authAPI = {
  login: async (password: string): Promise<{ authenticated: boolean }> => {
    const response = await fetchAPI<{ authenticated: boolean; token?: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    // Store the token for future requests
    if (response.token) {
      setAuthToken(response.token);
    }
    return { authenticated: response.authenticated };
  },

  logout: async (): Promise<{ authenticated: boolean }> => {
    // Clear local token
    clearAuthToken();
    // Also call backend to clear cookie (for same-origin setups)
    return fetchAPI('/auth/logout', {
      method: 'POST',
    });
  },

  status: (): Promise<AuthStatus> => {
    return fetchAPI('/auth/status');
  },
};

// ============================================================================
// Audio Recording Types
// ============================================================================

export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface AudioRecording {
  id: number;
  survey_id: number;
  filename: string;
  r2_key: string;
  file_size_bytes: number | null;
  duration_seconds: number | null;
  recording_timestamp: string | null;
  device_serial: string | null;
  processing_status: ProcessingStatus;
  processing_error: string | null;
  uploaded_at: string;
  detection_count: number;
  unmatched_species: string[] | null;
}

export interface BirdDetection {
  id: number;
  species_name: string;
  confidence: number;
  start_time: string;
  end_time: string;
  detection_timestamp: string;
  species_id: number | null;
  species_common_name: string | null;
}

export interface DetectionClip {
  confidence: number;
  audio_recording_id: number;
  start_time: string;
  end_time: string;
  // Device info for location attribution
  device_id: string | null;
  device_name: string | null;
  device_latitude: number | null;
  device_longitude: number | null;
  location_id: number | null;
  location_name: string | null;
}

export interface SpeciesDetectionSummary {
  species_id: number;
  species_name: string | null;
  species_scientific_name: string | null;
  detection_count: number;
  top_detections: DetectionClip[];
}

export interface SurveyDetectionsSummaryResponse {
  species_summaries: SpeciesDetectionSummary[];
}

// ============================================================================
// API Methods - Audio
// ============================================================================

export const audioAPI = {
  /**
   * Get all audio recordings for a survey
   */
  getRecordings: (surveyId: number): Promise<AudioRecording[]> => {
    return fetchAPI(`/surveys/${surveyId}/audio`);
  },

  /**
   * Upload audio files to a survey
   * Returns the created recording records
   */
  uploadFiles: (surveyId: number, files: File[]): Promise<AudioRecording[]> => {
    return uploadMediaFiles(`/surveys/${surveyId}/audio`, files);
  },

  /**
   * Get a specific audio recording
   */
  getRecording: (surveyId: number, recordingId: number): Promise<AudioRecording> => {
    return fetchAPI(`/surveys/${surveyId}/audio/${recordingId}`);
  },

  /**
   * Manually trigger processing for a recording
   */
  processRecording: (surveyId: number, recordingId: number): Promise<{ status: string; message: string }> => {
    return fetchAPI(`/surveys/${surveyId}/audio/${recordingId}/process`, {
      method: 'POST',
    });
  },

  /**
   * Get bird detections for an audio recording
   */
  getDetections: (surveyId: number, recordingId: number, minConfidence?: number): Promise<BirdDetection[]> => {
    const params = minConfidence ? `?min_confidence=${minConfidence}` : '';
    return fetchAPI(`/surveys/${surveyId}/audio/${recordingId}/detections${params}`);
  },

  /**
   * Get a presigned download URL for an audio file
   */
  getDownloadUrl: (recordingId: number): Promise<{ download_url: string; expires_in: number }> => {
    return fetchAPI(`/audio/${recordingId}/download`);
  },

  /**
   * Delete an audio recording
   */
  deleteRecording: (surveyId: number, recordingId: number): Promise<void> => {
    return fetchAPI(`/surveys/${surveyId}/audio/${recordingId}`, {
      method: 'DELETE',
    });
  },

  /**
   * Get aggregated detections summary for a survey, grouped by species
   */
  getDetectionsSummary: (surveyId: number): Promise<SurveyDetectionsSummaryResponse> => {
    return fetchAPI(`/surveys/${surveyId}/detections/summary`);
  },
};

// ============================================================================
// Camera Trap Image Types
// ============================================================================

export interface CameraTrapImage {
  id: number;
  survey_id: number;
  filename: string;
  r2_key: string;
  file_size_bytes: number | null;
  image_timestamp: string | null;
  device_serial: string | null;
  processing_status: ProcessingStatus;
  processing_error: string | null;
  flagged_for_review: boolean;
  review_reason: string | null;
  created_at: string;
  detection_count: number;
  unmatched_species: string[] | null;
}

export interface CameraTrapDetection {
  id: number;
  species_name: string;
  scientific_name: string;
  confidence: number;
  taxonomic_level: string | null;
  is_primary: boolean;
  species_id: number | null;
}

export interface ImageDetectionOption {
  species_id: number | null;
  species_name: string | null;
  scientific_name: string;
  confidence: number;
}

export interface ImageWithDetections {
  image_id: number;
  filename: string;
  device_id: string | null;
  device_name: string | null;
  device_latitude: number | null;
  device_longitude: number | null;
  location_id: number | null;
  location_name: string | null;
  detections: ImageDetectionOption[];
}

export interface SurveyImageDetectionsResponse {
  images: ImageWithDetections[];
}

// ============================================================================
// API Methods - Camera Trap Images
// ============================================================================

export const imagesAPI = {
  /**
   * Get all camera trap images for a survey
   */
  getImages: (surveyId: number): Promise<CameraTrapImage[]> => {
    return fetchAPI(`/surveys/${surveyId}/images`);
  },

  /**
   * Upload image files to a survey
   * Returns the created image records
   */
  uploadFiles: (surveyId: number, files: File[]): Promise<CameraTrapImage[]> => {
    return uploadMediaFiles(`/surveys/${surveyId}/images`, files);
  },

  /**
   * Upload image files with optional metadata and skip_processing flag.
   * Used by the camera trap wizard to upload only selected images without AI processing.
   */
  uploadFilesWithMetadata: (
    surveyId: number,
    files: File[],
    timestamps?: Record<string, string>,
    skipProcessing?: boolean
  ): Promise<CameraTrapImage[]> => {
    const params = new URLSearchParams();
    if (skipProcessing) params.append('skip_processing', 'true');
    const query = params.toString();
    const endpoint = `/surveys/${surveyId}/images${query ? `?${query}` : ''}`;

    const formData = new FormData();
    files.forEach(file => formData.append('files', file));
    if (timestamps) {
      formData.append('metadata', JSON.stringify(timestamps));
    }

    const token = getAuthToken();
    const headers: Record<string, string> = {
      'X-Org-Slug': ORG_SLUG,
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    return fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: formData,
    }).then(async (response) => {
      if (!response.ok) {
        let errorMessage = `Upload failed: ${response.status}`;
        try {
          const error = await response.json();
          if (error.detail) {
            errorMessage = typeof error.detail === 'string' ? error.detail : JSON.stringify(error.detail);
          }
        } catch { /* ignore parse error */ }
        throw new Error(errorMessage);
      }
      return response.json();
    });
  },

  /**
   * Get a specific camera trap image
   */
  getImage: (surveyId: number, imageId: number): Promise<CameraTrapImage> => {
    return fetchAPI(`/surveys/${surveyId}/images/${imageId}`);
  },

  /**
   * Manually trigger processing for an image
   */
  processImage: (surveyId: number, imageId: number): Promise<{ status: string; message: string }> => {
    return fetchAPI(`/surveys/${surveyId}/images/${imageId}/process`, {
      method: 'POST',
    });
  },

  /**
   * Get species detections for a camera trap image
   */
  getDetections: (surveyId: number, imageId: number, minConfidence?: number, primaryOnly?: boolean): Promise<CameraTrapDetection[]> => {
    const params = new URLSearchParams();
    if (minConfidence) params.append('min_confidence', minConfidence.toString());
    if (primaryOnly) params.append('primary_only', 'true');
    const query = params.toString();
    return fetchAPI(`/surveys/${surveyId}/images/${imageId}/detections${query ? `?${query}` : ''}`);
  },

  /**
   * Get a presigned download URL for an image file
   */
  getDownloadUrl: (imageId: number): Promise<{ download_url: string; expires_in: number }> => {
    return fetchAPI(`/images/${imageId}/download`);
  },

  /**
   * Get a presigned preview URL for an image file
   */
  getPreviewUrl: (imageId: number): Promise<{ preview_url: string; expires_in: number }> => {
    return fetchAPI(`/images/${imageId}/preview`);
  },

  /**
   * Delete a camera trap image
   */
  deleteImage: (surveyId: number, imageId: number): Promise<void> => {
    return fetchAPI(`/surveys/${surveyId}/images/${imageId}`, {
      method: 'DELETE',
    });
  },

  /**
   * Get image detections for a survey - one row per image with top 3 species
   */
  getDetectionsSummary: (surveyId: number): Promise<SurveyImageDetectionsResponse> => {
    return fetchAPI(`/surveys/${surveyId}/image-detections/summary`);
  },
};
