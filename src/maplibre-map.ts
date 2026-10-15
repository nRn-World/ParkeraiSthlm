import type { FeatureCollection } from "geojson";
import { Marker, type Map as MapLibreMap, type StyleSpecification } from "maplibre-gl";
import type { LatLng } from "./data";
import { isEnglish } from "./i18n";

// 3D-vy som Google Maps/Waze i körläge. maxPitch är 60° (MapLibres max utan
// experimentellt läge) – det ger tydlig perspektivkänsla utan renderingsproblem.
export const DRIVING_PITCH = 60;

const MAP_3D_STORAGE_KEY = "parksthlm-map-3d-v1";

export function readMap3dEnabled() {
  const stored = localStorage.getItem(MAP_3D_STORAGE_KEY);
  // Standard: 3D på. Användaren kan stänga av till platt 2D i Profil.
  return stored === null ? true : stored !== "false";
}

export function writeMap3dEnabled(enabled: boolean) {
  localStorage.setItem(MAP_3D_STORAGE_KEY, enabled ? "true" : "false");
}

// Ren rasterstil mot OpenStreetMaps servrar – samma rutor som Leaflet använde,
// så den befintliga offline-cachen i service workern fortsätter att gälla.
// Raster only = inga glyphs/sprites behövs.
export const OSM_RASTER_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 19,
      attribution: `© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>${isEnglish ? " contributors" : "-bidragsgivare"}`,
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

// Slår på/av rotation och lutning med gester. I 2D-läge är kartan alltid platt
// och norr-upp – i 3D-läge får användaren rotera och luta fritt som i Google Maps.
export function applyMap3dInteractions(map: MapLibreMap, enabled: boolean) {
  if (enabled) {
    map.dragRotate.enable();
    map.touchPitch.enable();
    map.touchZoomRotate.enableRotation();
  } else {
    map.dragRotate.disable();
    map.touchPitch.disable();
    map.touchZoomRotate.disableRotation();
  }
}

// Appen använder [lat, lng] överallt – MapLibre vill ha [lng, lat].
export function toLngLat(position: LatLng): [number, number] {
  return [position[1], position[0]];
}

export function toLatLng(lngLat: { lng: number; lat: number }): LatLng {
  return [lngLat.lat, lngLat.lng];
}

export function boundsOf(points: LatLng[]): [[number, number], [number, number]] {
  let south = 90;
  let north = -90;
  let west = 180;
  let east = -180;
  points.forEach(([lat, lng]) => {
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (lng < west) west = lng;
    if (lng > east) east = lng;
  });
  return [[west, south], [east, north]];
}

// Fylld cirkel som GeoJSON-polygon (ersätter Leaflets L.circle för GPS-noggrannhet).
export function circlePolygon(center: LatLng, radiusMeters: number, steps = 64): number[][][] {
  const [lat, lng] = center;
  const earth = 6371000;
  const ring: number[][] = [];
  for (let index = 0; index <= steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    const pointLat = lat + (radiusMeters / earth) * (180 / Math.PI) * Math.cos(angle);
    const pointLng = lng + ((radiusMeters / earth) * (180 / Math.PI) * Math.sin(angle)) / Math.cos((lat * Math.PI) / 180);
    ring.push([pointLng, pointLat]);
  }
  return [ring];
}

export function emptyFeatureCollection(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

// Synkar en uppsättning HTML-markörer mot ett önskat id→element-tillstånd.
// Samma markörer återanvänds mellan rendereringar så att kartan inte flimrar.
export function syncMarkers(
  store: Map<string, Marker>,
  map: MapLibreMap,
  createMarker: (id: string) => { element: HTMLElement; lngLat: [number, number]; anchor?: "center" | "bottom"; offset?: [number, number] } | null,
  wantedIds: string[],
) {
  const wanted = new Set(wantedIds);
  for (const [id, marker] of store) {
    if (!wanted.has(id)) {
      marker.remove();
      store.delete(id);
    }
  }
  for (const id of wantedIds) {
    if (store.has(id)) continue;
    const created = createMarker(id);
    if (!created) continue;
    const marker = new Marker({ element: created.element, anchor: created.anchor ?? "center", offset: created.offset });
    marker.setLngLat(created.lngLat).addTo(map);
    store.set(id, marker);
  }
}

export function removeAllMarkers(store: Map<string, Marker>) {
  for (const marker of store.values()) marker.remove();
  store.clear();
}

export function makeMarkerElement(className: string, html: string) {
  const element = document.createElement("div");
  element.className = className;
  element.innerHTML = html;
  return element;
}
