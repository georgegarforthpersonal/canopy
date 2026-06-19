/**
 * Drawing surface for a single typed location shape (area / route / point),
 * built on react-leaflet + leaflet-geoman. Emits GeoJSON ([lng, lat]) on
 * draw/edit. Drawing a new shape replaces any previous one; the geoman
 * controller is remounted via `key` on type/clear changes to guarantee clean
 * Leaflet teardown (see utils/stopMapAnimation).
 */

import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import { Box, Paper, Stack, IconButton, Tooltip, Chip, Button } from '@mui/material';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import LayersIcon from '@mui/icons-material/Layers';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@geoman-io/leaflet-geoman-free';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';

import { stopMapAnimation } from '../../utils/stopMapAnimation';
import { useMapFullscreen, MapResizeHandler } from '../../hooks';
import { DEFAULT_MAP_CENTER } from '../../config';
import {
  geometryAreaSqm,
  geometryLengthM,
  formatArea,
  formatLength,
  type GeoJsonGeometry,
  type Position,
} from '../../utils/geometry';
import type { LocationType, LocationWithBoundary } from '../../services/api';
import FieldBoundaryOverlay from '../surveys/FieldBoundaryOverlay';

// Ensure markers render (the default icon URLs need wiring up under bundlers).
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
L.Marker.prototype.options.icon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

/** Drawable location types (everything except 'none'). */
export type DrawableLocationType = Exclude<LocationType, 'none'>;

const PM_SHAPE: Record<DrawableLocationType, 'Polygon' | 'Line' | 'Marker'> = {
  area: 'Polygon',
  route: 'Line',
  point: 'Marker',
};

// Minimal shape of the geoman "create" event we rely on.
interface PmCreateEvent {
  layer: L.Layer;
}

const toLatLng = ([lng, lat]: Position): [number, number] => [lat, lng];

/** Build an editable Leaflet layer from a stored GeoJSON geometry. */
function geometryToLayer(geometry: GeoJsonGeometry): L.Layer {
  if (geometry.type === 'Polygon') {
    const rings = (geometry.coordinates as Position[][]).map((r) => r.map(toLatLng));
    return L.polygon(rings);
  }
  if (geometry.type === 'LineString') {
    return L.polyline((geometry.coordinates as Position[]).map(toLatLng));
  }
  // Point
  return L.marker(toLatLng(geometry.coordinates as Position));
}

interface GeomanControllerProps {
  locationType: DrawableLocationType;
  /** Initial geometry to load when the controller mounts (null → start drawing). */
  value: GeoJsonGeometry | null;
  onChange: (geometry: GeoJsonGeometry | null) => void;
}

/**
 * Imperative geoman bridge. Mounted with a `key` that changes whenever the
 * location type changes or Clear is pressed, so each lifecycle starts clean.
 */
function GeomanController({ locationType, value, onChange }: GeomanControllerProps) {
  const map = useMap();
  const layerRef = useRef<L.Layer | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const emit = useCallback(() => {
    const layer = layerRef.current;
    if (!layer) {
      onChangeRef.current(null);
      return;
    }
    const feature = (layer as L.Polygon).toGeoJSON();
    const geometry = (feature as GeoJSON.Feature).geometry as unknown as GeoJsonGeometry;
    onChangeRef.current(geometry);
  }, []);

  const watch = useCallback(
    (layer: L.Layer) => {
      // Geoman fires these as the user drags vertices / the marker.
      layer.on('pm:edit', emit);
      layer.on('pm:update', emit);
      layer.on('pm:dragend', emit);
      layer.on('pm:markerdragend', emit);
    },
    [emit],
  );

  useEffect(() => {
    map.pm.setGlobalOptions({ snappable: true, snapDistance: 20, allowSelfIntersection: false });

    const handleCreate = (event: PmCreateEvent) => {
      // Single-shape model: discard any previous geometry.
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
      }
      layerRef.current = event.layer;
      const pm = (event.layer as L.Layer & { pm?: { enable: (o?: object) => void } }).pm;
      if (pm) pm.enable({ allowSelfIntersection: false });
      watch(event.layer);
      emit();
      map.pm.disableDraw();
    };

    map.on('pm:create', handleCreate as L.LeafletEventHandlerFn);

    if (value) {
      const layer = geometryToLayer(value);
      layer.addTo(map);
      layerRef.current = layer;
      const pm = (layer as L.Layer & { pm?: { enable: (o?: object) => void } }).pm;
      if (pm) pm.enable({ allowSelfIntersection: false });
      watch(layer);
      // Frame the loaded shape.
      const bounded = layer as L.Layer & { getBounds?: () => L.LatLngBounds };
      if (bounded.getBounds) {
        const bounds = bounded.getBounds();
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30] });
      } else if (value.type === 'Point') {
        map.setView(toLatLng(value.coordinates as Position), 16);
      }
    } else {
      map.pm.enableDraw(PM_SHAPE[locationType], { snappable: true, snapDistance: 20 });
    }

    return () => {
      map.off('pm:create', handleCreate as L.LeafletEventHandlerFn);
      try {
        map.pm.disableDraw();
      } catch {
        /* map already torn down */
      }
      if (layerRef.current) {
        layerRef.current.off();
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
      stopMapAnimation(map);
    };
    // Remounted via `key` on type/clear changes; value is read once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  return null;
}

interface LocationDrawMapProps {
  locationType: DrawableLocationType;
  value: GeoJsonGeometry | null;
  onChange: (geometry: GeoJsonGeometry | null) => void;
  /** Other locations shown faintly for context and snapping. */
  referenceLocations?: LocationWithBoundary[];
}

export default function LocationDrawMap({
  locationType,
  value,
  onChange,
  referenceLocations,
}: LocationDrawMapProps) {
  const [mapType, setMapType] = useState<'street' | 'satellite'>('satellite');
  const [nonce, setNonce] = useState(0);
  const { isFullscreen, toggleFullscreen, fullscreenContainerSx, fullscreenMapSx } = useMapFullscreen();

  // Remount the geoman controller whenever the type changes or the user clears.
  const drawKey = `${locationType}-${nonce}`;

  const handleClear = () => {
    onChange(null);
    setNonce((n) => n + 1);
  };

  const measurement = useMemo(() => {
    if (!value) return '';
    if (locationType === 'area') return formatArea(geometryAreaSqm(value));
    if (locationType === 'route') return formatLength(geometryLengthM(value));
    return '';
  }, [value, locationType]);

  const initialCenter = useMemo<[number, number]>(() => {
    if (value) {
      if (value.type === 'Point') return toLatLng(value.coordinates as Position);
      if (value.type === 'LineString') return toLatLng((value.coordinates as Position[])[0]);
      if (value.type === 'Polygon') return toLatLng((value.coordinates as Position[][])[0][0]);
    }
    return [DEFAULT_MAP_CENTER[0], DEFAULT_MAP_CENTER[1]];
  }, [value]);

  const instruction =
    locationType === 'area'
      ? 'Click to add points; click the first point to finish the area.'
      : locationType === 'route'
        ? 'Click to add points along the route; double-click to finish.'
        : 'Click on the map to place the point.';

  return (
    <Paper
      elevation={2}
      className="fullscreen-map-container"
      sx={{ mb: 1, overflow: 'hidden', position: 'relative', ...fullscreenContainerSx }}
    >
      {/* Top-right controls */}
      <Stack
        direction="row"
        spacing={0.5}
        sx={{ position: 'absolute', top: 10, right: 10, zIndex: 1000 }}
      >
        <Tooltip title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>
          <IconButton
            size="small"
            onClick={toggleFullscreen}
            sx={{ bgcolor: 'white', boxShadow: 2, '&:hover': { bgcolor: 'grey.100' } }}
          >
            {isFullscreen ? <FullscreenExitIcon fontSize="small" /> : <FullscreenIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
        <Tooltip title={mapType === 'satellite' ? 'Switch to Street Map' : 'Switch to Satellite'}>
          <IconButton
            size="small"
            onClick={() => setMapType(mapType === 'satellite' ? 'street' : 'satellite')}
            sx={{ bgcolor: 'white', boxShadow: 2, '&:hover': { bgcolor: 'grey.100' } }}
          >
            <LayersIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      {/* Top-left: instruction / measurement + clear */}
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{ position: 'absolute', top: 10, left: 10, zIndex: 1000 }}
      >
        <Chip
          size="small"
          label={value ? measurement || 'Shape drawn' : instruction}
          sx={{ bgcolor: 'white', boxShadow: 2, maxWidth: 320 }}
        />
        {value && (
          <Button
            size="small"
            variant="contained"
            color="inherit"
            startIcon={<DeleteOutlineIcon fontSize="small" />}
            onClick={handleClear}
            sx={{ bgcolor: 'white', boxShadow: 2, '&:hover': { bgcolor: 'grey.100' } }}
          >
            Clear
          </Button>
        )}
      </Stack>

      <Box sx={{ height: { xs: '320px', sm: '440px' }, width: '100%', ...fullscreenMapSx }}>
        <MapContainer center={initialCenter} zoom={13} style={{ height: '100%', width: '100%' }}>
          {mapType === 'satellite' ? (
            <TileLayer
              key="satellite"
              attribution='Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            />
          ) : (
            <TileLayer
              key="street"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
          )}
          <MapResizeHandler isFullscreen={isFullscreen} />
          {referenceLocations && referenceLocations.length > 0 && (
            <FieldBoundaryOverlay locations={referenceLocations} />
          )}
          <GeomanController key={drawKey} locationType={locationType} value={value} onChange={onChange} />
        </MapContainer>
      </Box>
    </Paper>
  );
}
