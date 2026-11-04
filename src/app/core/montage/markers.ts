import { Marker, Montage } from './montage.model';

/** The markers of a montage in time order. */
export function sortedMarkers(montage: Montage): Marker[] {
  return [...(montage.markers ?? [])].sort((a, b) => a.time - b.time);
}

/** Adds a marker (kept in time order). */
export function addMarker(montage: Montage, marker: Marker): Montage {
  return withMarkers(montage, [...(montage.markers ?? []), marker]);
}

export function renameMarker(montage: Montage, id: string, name: string): Montage {
  const markers = montage.markers ?? [];
  if (!markers.some((m) => m.id === id && m.name !== name)) return montage;
  return withMarkers(montage, markers.map((m) => (m.id === id ? { ...m, name } : m)));
}

export function removeMarker(montage: Montage, id: string): Montage {
  const markers = montage.markers ?? [];
  return markers.some((m) => m.id === id) ? withMarkers(montage, markers.filter((m) => m.id !== id)) : montage;
}

/** Replaces all the markers (none with an empty list). */
export function withMarkers(montage: Montage, markers: Marker[]): Montage {
  if (!markers.length && !montage.markers) return montage;
  const { markers: _, ...rest } = montage;
  return markers.length ? { ...rest, markers: [...markers].sort((a, b) => a.time - b.time) } : rest;
}
