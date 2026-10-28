'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useTheme } from 'next-themes';
import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, Marker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { resolveValueToCoordinates, type Coordinates } from './map-utils';

// Tabler map-pin icon paths (24x24 viewBox, stroke-based)
const MAP_PIN_ICON = `
  <path d="M12 11m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"/>
  <path d="M17.657 16.657l-4.243 4.243a2 2 0 0 1 -2.827 0l-4.244 -4.243a8 8 0 1 1 11.314 0z"/>
`;

// Marker circolare stile nodo "location" — cerchio colorato con icona map-pin bianca inside
function createCircleMarker(color = '#22c55e'): L.DivIcon | null {
  if (typeof window === 'undefined') return null;

  const html = `<svg xmlns="http://www.w3.workspace/2000/svg" width="36" height="36" viewBox="0 0 36 36" overflow="visible">
    <!-- White ring border -->
    <circle cx="18" cy="18" r="17" fill="white"/>
    <!-- Colored fill -->
    <circle cx="18" cy="18" r="14" fill="${color}"/>
    <!-- Icon: 24x24 centered in 36x36 (offset 6,6) -->
    <g transform="translate(6, 6)"
       stroke="white" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none">
      ${MAP_PIN_ICON}
    </g>
  </svg>`;

  return L.divIcon({
    html,
    className: 'custom-map-marker',
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -22]
  });
}

// Componente per gestire i controlli dinamici della mappa
function MapController({ isActive }: { isActive: boolean }) {
  const map = useMap();
  const zoomControlRef = useRef<L.Control.Zoom | null>(null);

  useEffect(() => {
    if (isActive) {
      map.dragging.enable();
      map.scrollWheelZoom.enable();
      map.touchZoom.enable();
      map.doubleClickZoom.disable();
      map.boxZoom.enable();
      map.keyboard.enable();

      if (!zoomControlRef.current) {
        zoomControlRef.current = L.control.zoom({ position: 'bottomright' });
        zoomControlRef.current.addTo(map);
      }
    } else {
      map.dragging.disable();
      map.scrollWheelZoom.disable();
      map.touchZoom.disable();
      map.doubleClickZoom.disable();
      map.boxZoom.disable();
      map.keyboard.disable();

      if (zoomControlRef.current) {
        map.removeControl(zoomControlRef.current);
        zoomControlRef.current = null;
      }
    }
  }, [isActive, map]);

  return null;
}

interface MapContentProps {
  /** Input: coordinate, indirizzo o IP */
  value: string;
  /** Titolo opzionale per il popup */
  title?: string;
  /** Callback per double click */
  onDoubleClick?: () => void;
}

export function MapContent({ value, onDoubleClick }: MapContentProps) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [markerIcon, setMarkerIcon] = useState<L.DivIcon | null>(null);
  const [isActive, setIsActive] = useState(false);
  const clickTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setMounted(true);
    setMarkerIcon(createCircleMarker('#22c55e'));
  }, []);

  useEffect(() => {
    async function geocode() {
      setIsLoading(true);
      setError(null);
      const res = await resolveValueToCoordinates(value);
      setCoordinates(res.coordinates);
      setError(res.error);
      setIsLoading(false);
    }

    if (value) geocode();
    else { setIsLoading(false); setError('No location specified'); }
  }, [value]);

  // Tile layer — CartoDB Voyager (light, labeled) / Dark All (dark, labeled)
  const tileUrl = useMemo(() => {
    if (resolvedTheme === 'dark')
      return 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
    return 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
  }, [resolvedTheme]);

  // Colore sfondo che combacia con le tiles — evita il flash bianco durante il caricamento
  const tileBg = resolvedTheme === 'dark' ? '#181828' : '#e4e0db';

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
        clickTimeoutRef.current = null;
        onDoubleClick?.();
      } else {
        clickTimeoutRef.current = setTimeout(() => {
          setIsActive(true);
          clickTimeoutRef.current = null;
        }, 250);
      }
    },
    [onDoubleClick]
  );

  const handleMouseLeave = useCallback(() => {
    setIsActive(false);
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
    }
  }, []);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
        clickTimeoutRef.current = null;
      }
      onDoubleClick?.();
    },
    [onDoubleClick]
  );

  const bgClass = resolvedTheme === 'dark' ? 'bg-zinc-900' : 'bg-stone-100';

  if (!mounted || isLoading) {
    return (
      <div className={`nodrag nopan flex h-full w-full items-center justify-center ${bgClass}`}>
        <div className='flex items-center gap-2'>
          <div className='h-4 w-4 animate-spin rounded-full border-2 border-green-500 border-t-transparent' />
          <span className='text-muted-foreground text-xs'>
            {!mounted ? 'Loading map...' : 'Geocoding...'}
          </span>
        </div>
      </div>
    );
  }

  if (error || !coordinates) {
    return (
      <div
        className={`nodrag nopan flex h-full w-full flex-col items-center justify-center gap-2 ${bgClass}`}
        onDoubleClick={handleDoubleClick}
      >
        <span className='text-muted-foreground text-xs'>{error || 'No location'}</span>
        <span className='text-muted-foreground/70 max-w-full truncate px-2 text-xs'>{value}</span>
      </div>
    );
  }

  return (
    <div
      className='nodrag nopan relative h-full w-full'
      style={{ minHeight: 100 }}
      onMouseLeave={handleMouseLeave}
    >
      <style jsx global>{`
        /* Sfondo che combacia con le tiles — niente flash bianco */
        .leaflet-container {
          height: 100% !important;
          width: 100% !important;
          border-radius: 0 0 8px 8px;
          background: ${tileBg} !important;
        }
        .custom-map-marker {
          background: transparent !important;
          border: none !important;
          overflow: visible !important;
          filter: drop-shadow(0 2px 5px rgba(0, 0, 0, 0.45));
        }
        .leaflet-control-zoom {
          border: none !important;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18) !important;
        }
        .leaflet-control-zoom a {
          border: 1px solid rgba(0, 0, 0, 0.12) !important;
          background: rgba(255, 255, 255, 0.92) !important;
          color: rgba(15, 23, 42, 0.92) !important;
          backdrop-filter: blur(10px);
        }
        .leaflet-control-zoom a:hover { background: rgba(255, 255, 255, 1) !important; }
        .dark .leaflet-control-zoom a {
          border: 1px solid rgba(255, 255, 255, 0.14) !important;
          background: rgba(24, 24, 27, 0.82) !important;
          color: rgba(255, 255, 255, 0.9) !important;
        }
        .dark .leaflet-control-zoom a:hover { background: rgba(24, 24, 27, 0.92) !important; }
      `}</style>

      <MapContainer
        center={[coordinates.lat, coordinates.lng]}
        zoom={15}
        minZoom={3}
        maxZoom={19}
        scrollWheelZoom={false}
        zoomControl={false}
        attributionControl={false}
        dragging={false}
        doubleClickZoom={false}
        className='h-full w-full'
      >
        <TileLayer url={tileUrl} noWrap keepBuffer={4} />
        {markerIcon && (
          <Marker position={[coordinates.lat, coordinates.lng]} icon={markerIcon}>
            {value && (
              <Tooltip direction='top' offset={[0, -22]} opacity={0.97}>
                <span className='max-w-[180px] text-xs font-medium'>{value}</span>
              </Tooltip>
            )}
          </Marker>
        )}
        <MapController isActive={isActive} />
      </MapContainer>

      {/* Overlay click-to-activate */}
      {!isActive && (
        <div
          className='absolute inset-0 z-10 flex cursor-pointer items-center justify-center'
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
        >
          <div className='rounded-full bg-black/30 p-3 opacity-0 transition-opacity hover:opacity-100'>
            <svg
              xmlns='http://www.w3.workspace/2000/svg'
              width='24'
              height='24'
              viewBox='0 0 24 24'
              fill='none'
              stroke='white'
              strokeWidth='2'
              strokeLinecap='round'
              strokeLinejoin='round'
            >
              <circle cx='11' cy='11' r='8' />
              <path d='m21 21-4.3-4.3' />
              <path d='M11 8v6' />
              <path d='M8 11h6' />
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}

export default MapContent;
