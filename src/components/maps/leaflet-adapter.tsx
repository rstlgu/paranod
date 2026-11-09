'use client';

// Local React integration implemented against Leaflet's public API.
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { createPortal } from 'react-dom';
import L from 'leaflet';

const MapContext = createContext<L.Map | null>(null);
const MarkerContext = createContext<L.Marker | null>(null);

export function useMap(): L.Map {
  const map = useContext(MapContext);
  if (!map) throw new Error('Map components must be inside MapContainer');
  return map;
}

type MapContainerProps = L.MapOptions & {
  children?: ReactNode;
  className?: string;
};
export function MapContainer({
  children,
  className,
  ...options
}: MapContainerProps) {
  const element = useRef<HTMLDivElement>(null);
  const initialOptions = useRef(options);
  const [map, setMap] = useState<L.Map | null>(null);
  useEffect(() => {
    if (!element.current) return;
    const instance = L.map(element.current, initialOptions.current);
    setMap(instance);
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => instance.invalidateSize({ pan: false }));
    observer?.observe(element.current);
    return () => {
      observer?.disconnect();
      instance.remove();
      setMap(null);
    };
  }, []);
  return (
    <>
      <div ref={element} className={className} role='region' aria-label='Map' />
      {map ? (
        <MapContext.Provider value={map}>{children}</MapContext.Provider>
      ) : null}
    </>
  );
}

export function TileLayer({
  url,
  noWrap,
  keepBuffer
}: {
  url: string;
  noWrap?: boolean;
  keepBuffer?: number;
}) {
  const map = useMap();
  useEffect(() => {
    const layer = L.tileLayer(url, {
      noWrap,
      keepBuffer,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
    }).addTo(map);
    return () => {
      layer.remove();
    };
  }, [map, url, noWrap, keepBuffer]);
  return null;
}

interface MarkerProps {
  position: L.LatLngExpression;
  icon: L.Icon | L.DivIcon;
  draggable?: boolean;
  zIndexOffset?: number;
  eventHandlers?: L.LeafletEventHandlerFnMap;
  children?: ReactNode;
}
export function Marker({
  position,
  icon,
  draggable = false,
  zIndexOffset = 0,
  eventHandlers,
  children
}: MarkerProps) {
  const map = useMap();
  const initial = useRef({ position, icon, draggable, zIndexOffset });
  const [marker, setMarker] = useState<L.Marker | null>(null);
  const coordinates = L.latLng(position);
  useEffect(() => {
    const instance = L.marker(initial.current.position, initial.current).addTo(
      map
    );
    setMarker(instance);
    return () => {
      instance.remove();
      setMarker(null);
    };
  }, [map]);
  useEffect(() => {
    marker?.setLatLng([coordinates.lat, coordinates.lng]);
  }, [marker, coordinates.lat, coordinates.lng]);
  useEffect(() => {
    marker?.setIcon(icon);
  }, [marker, icon]);
  useEffect(() => {
    marker?.setZIndexOffset(zIndexOffset);
  }, [marker, zIndexOffset]);
  useEffect(() => {
    if (draggable) marker?.dragging?.enable();
    else marker?.dragging?.disable();
  }, [marker, draggable]);
  useEffect(() => {
    if (!marker || !eventHandlers) return;
    marker.on(eventHandlers);
    return () => {
      marker.off(eventHandlers);
    };
  }, [marker, eventHandlers]);
  return marker ? (
    <MarkerContext.Provider value={marker}>{children}</MarkerContext.Provider>
  ) : null;
}

export function Tooltip({
  direction = 'auto',
  offset = [0, 0],
  opacity = 0.9,
  children
}: {
  direction?: L.Direction;
  offset?: L.PointExpression;
  opacity?: number;
  children?: ReactNode;
}) {
  const marker = useContext(MarkerContext);
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const point = L.point(offset);
  useEffect(() => {
    if (!marker) return;
    const container = document.createElement('div');
    marker.bindTooltip(container, {
      direction,
      offset: [point.x, point.y],
      opacity
    });
    setElement(container);
    return () => {
      marker.unbindTooltip();
      setElement(null);
    };
  }, [marker, direction, point.x, point.y, opacity]);
  // React renders text safely; labels are never passed to Leaflet as raw HTML.
  return element ? createPortal(children, element) : null;
}
