'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapContainer, Marker, TileLayer, Tooltip, useMap } from 'react-leaflet';
import type { Node } from 'reactflow';
import { resolveValueToCoordinates, type Coordinates } from '@/features/graph/components/map-utils';

// Tabler map-pin icon paths (24x24 viewBox, stroke-based)
const MAP_PIN_ICON = `
  <path d="M12 11m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"/>
  <path d="M17.657 16.657l-4.243 4.243a2 2 0 0 1 -2.827 0l-4.244 -4.243a8 8 0 1 1 11.314 0z"/>
`;

// Colori allineati a node-registry.ts
const NODE_COLORS: Record<string, string> = {
  location: '#fb7185', // rose-400
  maps:     '#22c55e', // green-500
};

interface MapPoint {
  nodeId: string;
  label: string;
  coordinates: Coordinates;
  nodeType: string;
}

// Marker circolare stile nodo analysis — cerchio colorato con icona map-pin bianca inside
function createCircleMarker(color: string): L.DivIcon | null {
  if (typeof window === 'undefined') return null;

  const html = `<svg xmlns="http://www.w3.workspace/2000/svg" width="36" height="36" viewBox="0 0 36 36" overflow="visible">
    <circle cx="18" cy="18" r="17" fill="white"/>
    <circle cx="18" cy="18" r="14" fill="${color}"/>
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

// Cache per evitare di ricreare gli stessi oggetti a ogni render
const _iconCache = new Map<string, L.DivIcon>();
function getCachedIcon(color: string): L.DivIcon | null {
  if (typeof window === 'undefined') return null;
  if (!_iconCache.has(color)) {
    const icon = createCircleMarker(color);
    if (icon) _iconCache.set(color, icon);
  }
  return _iconCache.get(color) ?? null;
}

function FitToPoints({ points }: { points: MapPoint[] }) {
  const map = useMap();
  const previousIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!points.length) return;
    const previous = previousIds.current;
    previousIds.current = new Set(points.map((point) => point.nodeId));
    if (previous) {
      const added = points.filter((point) => !previous.has(point.nodeId));
      const target = added[added.length - 1];
      if (target) map.panTo([target.coordinates.lat, target.coordinates.lng], { animate: true, duration: 0.38 });
      return;
    }
    if (points.length === 1) {
      map.setView([points[0].coordinates.lat, points[0].coordinates.lng], 13);
      return;
    }
    const bounds = L.latLngBounds(points.map((p) => [p.coordinates.lat, p.coordinates.lng]));
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 });
  }, [map, points]);

  return null;
}

export interface GraphMapViewProps {
  nodes: Node[];
  selectedNodeIds: string[];
  onSelectNodeId: (nodeId: string) => void;
  onMapApi: (api: GraphMapApi | null) => void;
}

export interface GraphMapApi {
  fitView: () => void;
  fitViewToNodeIds: (nodeIds: string[]) => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

function MapUiController(props: { onMapReady: (map: L.Map) => void }) {
  const map = useMap();
  const zoomControlRef = useRef<L.Control.Zoom | null>(null);

  useEffect(() => {
    props.onMapReady(map);
  }, [map, props]);

  useEffect(() => {
    if (!zoomControlRef.current) {
      zoomControlRef.current = L.control.zoom({ position: 'bottomright' });
      zoomControlRef.current.addTo(map);
    }
    return () => {
      if (zoomControlRef.current) {
        map.removeControl(zoomControlRef.current);
        zoomControlRef.current = null;
      }
    };
  }, [map]);

  return null;
}

export function GraphMapView(props: GraphMapViewProps) {
  const { resolvedTheme } = useTheme();
  const [points, setPoints] = useState<MapPoint[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const mapRef = useRef<L.Map | null>(null);

  // Includi sia nodi `maps` che `location`
  const mapNodes = useMemo(() => {
    return props.nodes.filter((n) => {
      const type = String((n.data as any)?.type ?? '');
      return type === 'maps' || type === 'location';
    });
  }, [props.nodes]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setIsLoading(true);
      const next: MapPoint[] = [];

      for (const n of mapNodes) {
        const label = String((n.data as any)?.label ?? '');
        if (!label) continue;
        const res = await resolveValueToCoordinates(label);
        if (res.coordinates)
          next.push({
            nodeId: String(n.id),
            label,
            coordinates: res.coordinates,
            nodeType: String((n.data as any)?.type ?? 'maps')
          });
      }

      if (cancelled) return;
      setPoints(next);
      setIsLoading(false);
    }

    if (!mapNodes.length) { setPoints([]); setIsLoading(false); return; }

    run();
    return () => { cancelled = true; };
  }, [mapNodes]);

  // CartoDB Voyager (light, con etichette) / Dark All (dark, con etichette)
  const tileUrl = useMemo(() => {
    if (resolvedTheme === 'dark')
      return 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
    return 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
  }, [resolvedTheme]);

  // Sfondo che combacia con le tiles per eliminare il flash bianco durante il caricamento
  const tileBg = resolvedTheme === 'dark' ? '#181828' : '#e4e0db';

  useEffect(() => {
    const api: GraphMapApi = {
      fitView: () => {
        const map = mapRef.current;
        if (!map) return;
        if (!points.length) { map.setView([20, 10], 3); return; }
        if (points.length === 1) {
          map.setView([points[0].coordinates.lat, points[0].coordinates.lng], 13);
          return;
        }
        const bounds = L.latLngBounds(points.map((p) => [p.coordinates.lat, p.coordinates.lng]));
        map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 });
      },
      fitViewToNodeIds: (nodeIds: string[]) => {
        const map = mapRef.current;
        if (!map) return;
        const ids = (nodeIds ?? []).map(String).filter(Boolean);
        const targets = points.filter((p) => ids.includes(p.nodeId));
        if (!targets.length) return;
        if (targets.length === 1) {
          map.setView([targets[0].coordinates.lat, targets[0].coordinates.lng], 14);
          return;
        }
        const bounds = L.latLngBounds(targets.map((p) => [p.coordinates.lat, p.coordinates.lng]));
        map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 });
      },
      zoomIn:  () => mapRef.current?.zoomIn(),
      zoomOut: () => mapRef.current?.zoomOut()
    };
    props.onMapApi(api);
    return () => props.onMapApi(null);
  }, [points, props]);

  return (
    <div className='relative h-full w-full'>
      <style jsx global>{`
        .custom-map-marker {
          background: transparent !important;
          border: none !important;
          overflow: visible !important;
          /* Drop shadow via CSS per evitare conflitti di ID nei filtri SVG */
          filter: drop-shadow(0 2px 5px rgba(0, 0, 0, 0.45));
        }
        .leaflet-container {
          height: 100% !important;
          width: 100% !important;
          background: ${tileBg} !important;
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
        .leaflet-tooltip {
          background: rgba(15, 23, 42, 0.9) !important;
          border: 1px solid rgba(255, 255, 255, 0.12) !important;
          color: #fff !important;
          font-size: 11px !important;
          font-weight: 500 !important;
          border-radius: 6px !important;
          padding: 4px 8px !important;
          backdrop-filter: blur(8px) !important;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4) !important;
          white-space: nowrap;
          max-width: 200px;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .leaflet-tooltip-top:before { border-top-color: rgba(15, 23, 42, 0.9) !important; }
      `}</style>

      <MapContainer
        center={[20, 10]}
        zoom={3}
        minZoom={3}
        maxZoom={19}
        scrollWheelZoom
        zoomControl={false}
        attributionControl={false}
        className='h-full w-full'
      >
        <TileLayer url={tileUrl} noWrap keepBuffer={4} />

        {points.map((p) => {
          const color = NODE_COLORS[p.nodeType] ?? NODE_COLORS.maps;
          const icon = getCachedIcon(color);
          const isSelected = props.selectedNodeIds.includes(p.nodeId);
          return icon ? (
            <Marker
              key={p.nodeId}
              draggable={false}
              position={[p.coordinates.lat, p.coordinates.lng]}
              icon={icon}
              zIndexOffset={isSelected ? 1000 : 0}
              eventHandlers={{ click: () => props.onSelectNodeId(p.nodeId) }}
            >
              <Tooltip direction='top' offset={[0, -22]} opacity={1}>
                {p.label}
              </Tooltip>
            </Marker>
          ) : null;
        })}

        <FitToPoints points={points} />
        <MapUiController onMapReady={(map) => { mapRef.current = map; }} />
      </MapContainer>

      {!isLoading && points.length === 0 && (
        <div className='pointer-events-none absolute inset-0 flex items-center justify-center'>
          <div className='text-muted-foreground rounded-lg border bg-background/70 px-4 py-3 text-sm font-medium shadow backdrop-blur'>
            No map points in this graph.
            <span className='text-muted-foreground/60 mt-0.5 block text-xs font-normal'>
              Add <strong>Location</strong> or <strong>Map</strong> nodes with an address or coordinates.
            </span>
          </div>
        </div>
      )}

      {isLoading && (
        <div className='pointer-events-none absolute inset-0 flex items-center justify-center'>
          <div className='bg-background/70 text-muted-foreground rounded-md border px-3 py-2 text-xs shadow-sm backdrop-blur'>
            Loading map points…
          </div>
        </div>
      )}
    </div>
  );
}
