import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import L, { type LayerGroup, type Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import { AnimatePresence, motion } from "framer-motion";
import {
  Building2,
  CarFront,
  ChevronDown,
  CircleAlert,
  Crosshair,
  Download,
  ExternalLink,
  Info,
  Layers3,
  ListFilter,
  LocateFixed,
  MapPin,
  Menu,
  Moon,
  Navigation,
  ParkingCircle,
  RefreshCw,
  Route,
  Search,
  SlidersHorizontal,
  Sun,
  Warehouse,
  Wifi,
  WifiOff,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  distanceKm,
  getCurrentPrice,
  LOCAL_PARKING,
  OFFLINE_BASE_ROADS,
  type ParkingPlace,
  STOCKHOLM_CENTER,
  TARIFFS,
  TAX_AREAS,
  TAX_STREETS,
  type LatLng,
  type TariffId,
} from "./data";

type Category = "all" | "free" | "garage" | "street" | TariffId;
type RouteInfo = { distance: number; minutes: number; fallback: boolean; destination: ParkingPlace };
type SearchLocation = { name: string; lat: number; lng: number; type: string };

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function pointInPolygon(point: LatLng, polygon: LatLng[]) {
  const [y, x] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function tariffAt(point: LatLng): TariffId | null {
  for (const tariff of [1, 2, 3, 4, 5] as TariffId[]) {
    if (TAX_AREAS.some((area) => area.tariff === tariff && pointInPolygon(point, area.positions))) return tariff;
  }
  return null;
}

function parkingIcon(place: ParkingPlace, selected: boolean) {
  const color = place.free ? "#16a36f" : place.tariff ? TARIFFS[place.tariff].color : "#172536";
  const letter = place.kind === "garage" ? "G" : "P";
  return L.divIcon({
    className: "parking-marker-wrap",
    html: `<div class="parking-marker${selected ? " is-selected" : ""}" style="--marker-color:${color}"><span>${letter}</span></div>`,
    iconSize: selected ? [42, 48] : [34, 40],
    iconAnchor: selected ? [21, 46] : [17, 38],
  });
}

function userIcon() {
  return L.divIcon({
    className: "user-marker-wrap",
    html: '<div class="user-marker"><div></div></div>',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

function formatDistance(km: number) {
  if (km < 1) return `${Math.max(20, Math.round((km * 1000) / 10) * 10)} m`;
  return `${km.toFixed(1).replace(".", ",")} km`;
}

function parseOsmParking(payload: unknown): ParkingPlace[] {
  if (!payload || typeof payload !== "object" || !("elements" in payload)) return [];
  const elements = (payload as { elements?: Array<Record<string, unknown>> }).elements;
  if (!Array.isArray(elements)) return [];

  return elements.flatMap((element): ParkingPlace[] => {
    const tags = (element.tags || {}) as Record<string, string>;
    const center = element.center as { lat?: number; lon?: number } | undefined;
    const lat = Number(element.lat ?? center?.lat);
    const lng = Number(element.lon ?? center?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];

    const parkingTag = tags.parking || "surface";
    const kind = ["underground", "multi-storey", "garage", "sheds"].includes(parkingTag) || tags.building === "parking"
      ? "garage"
      : parkingTag === "street_side" || parkingTag === "lane"
        ? "street"
        : "surface";
    const free = tags.fee === "no";
    const tariff = free ? null : tariffAt([lat, lng]);
    const name = tags.name || tags.operator || (kind === "garage" ? "Parkeringsgarage" : "Parkering");
    const streetAddress = [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" ");

    return [{
      id: `osm-${String(element.type)}-${String(element.id)}`,
      name,
      address: streetAddress || tags.description || "Adress saknas",
      area: tags["addr:suburb"] || tags["addr:city"] || "Stockholm",
      lat,
      lng,
      kind,
      tariff,
      free,
      priceText: free ? "Gratis enligt OSM" : tags.charge || (tags.fee === "yes" ? "Avgift" : "Villkor okända"),
      note: free
        ? "Markerad som avgiftsfri i OpenStreetMap. Kontrollera skyltningen på plats."
        : "Parkeringsplats från OpenStreetMap. Aktuella villkor står vid infarten eller på gatuskylten.",
      spaces: Number.isFinite(Number(tags.capacity)) ? Number(tags.capacity) : undefined,
      source: "osm",
    }];
  });
}

function categoryLabel(category: Category) {
  if (typeof category === "number") return `Taxa ${category}`;
  if (category === "garage") return "Garage";
  if (category === "street") return "Gatuparkering";
  if (category === "free") return "Gratis";
  return "Alla parkeringar";
}

function App() {
  const mapNodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const parkingLayerRef = useRef<LayerGroup | null>(null);
  const locationLayerRef = useRef<LayerGroup | null>(null);
  const routeLayerRef = useRef<LayerGroup | null>(null);
  const clickLayerRef = useRef<LayerGroup | null>(null);
  const lastGeocodeRef = useRef(0);

  const [allParking, setAllParking] = useState<ParkingPlace[]>(LOCAL_PARKING);
  const [category, setCategory] = useState<Category>("all");
  const [query, setQuery] = useState("");
  const [searchLocations, setSearchLocations] = useState<SearchLocation[]>([]);
  const [searching, setSearching] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [selectedParking, setSelectedParking] = useState<ParkingPlace | null>(null);
  const [selectedZone, setSelectedZone] = useState<TariffId | null>(null);
  const [userPosition, setUserPosition] = useState<LatLng | null>(null);
  const [searchPosition, setSearchPosition] = useState<LatLng | null>(null);
  const [viewCenter, setViewCenter] = useState<LatLng>(STOCKHOLM_CENTER);
  const [mapZoom, setMapZoom] = useState(13);
  const [locating, setLocating] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [panelOpen, setPanelOpen] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [offlineReady, setOfflineReady] = useState(localStorage.getItem("parksthlm-offline-ready") === "true");
  const [notice, setNotice] = useState<string | null>(null);

  // Nya states för Dark Mode, Kartklick och Sökförslag
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("parksthlm-dark") === "true");
  const [clickedPosition, setClickedPosition] = useState<LatLng | null>(null);
  const [clickedAddress, setClickedAddress] = useState<string | null>(null);
  const [clickedLoading, setClickedLoading] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);

  // Synka Dark Mode i DOM:en
  useEffect(() => {
    localStorage.setItem("parksthlm-dark", String(darkMode));
    if (darkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [darkMode]);

  // Skapa virtuell parkeringsplats för klickad koordinat för rutt/navigering
  const clickedPlace = useMemo<ParkingPlace | null>(() => {
    if (!clickedPosition) return null;
    const tariff = tariffAt(clickedPosition);
    return {
      id: "clicked-pos",
      name: clickedAddress || "Vald kartposition",
      address: clickedAddress ? `${clickedPosition[0].toFixed(5)}, ${clickedPosition[1].toFixed(5)}` : "Position på kartan",
      area: "Stockholm",
      lat: clickedPosition[0],
      lng: clickedPosition[1],
      kind: "street",
      tariff,
      free: tariff === null,
      priceText: tariff ? TARIFFS[tariff].price : "Gratis",
      note: "Kartposition du valt. Kontrollera alltid skyltar på platsen för eventuella lokala regler.",
      source: "local"
    };
  }, [clickedPosition, clickedAddress]);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 3600);
  }, []);

  const fetchOsmParking = useCallback(async (force = false) => {
    const cachedRaw = localStorage.getItem("parksthlm-osm");
    if (cachedRaw && !force) {
      try {
        const cached = JSON.parse(cachedRaw) as { timestamp: number; places: ParkingPlace[] };
        if (Array.isArray(cached.places)) setAllParking([...LOCAL_PARKING, ...cached.places]);
        if (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000 || !navigator.onLine) return;
      } catch {
        localStorage.removeItem("parksthlm-osm");
      }
    }
    if (!navigator.onLine) return;

    setDataLoading(true);
    try {
      const overpassQuery = `[out:json][timeout:25];nwr["amenity"="parking"](around:7000,59.3293,18.0686);out center tags;`;
      const response = await fetch(`${OVERPASS_ENDPOINT}?data=${encodeURIComponent(overpassQuery)}`);
      if (!response.ok) throw new Error("Kunde inte hämta parkeringsdata");
      const places = parseOsmParking(await response.json()).slice(0, 220);
      localStorage.setItem("parksthlm-osm", JSON.stringify({ timestamp: Date.now(), places }));
      setAllParking([...LOCAL_PARKING, ...places]);
      if (force) showNotice(`${places.length} parkeringsplatser uppdaterades`);
    } catch {
      if (force) showNotice("Live-data kunde inte nås. Sparad data används.");
    } finally {
      setDataLoading(false);
    }
  }, [showNotice]);

  useEffect(() => {
    void fetchOsmParking();
  }, [fetchOsmParking]);

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      void fetchOsmParking();
    };
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [fetchOsmParking]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!mapNodeRef.current || mapRef.current) return;

    const map = L.map(mapNodeRef.current, {
      center: STOCKHOLM_CENTER,
      zoom: 13,
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true,
      minZoom: 10,
      maxZoom: 19,
    });
    mapRef.current = map;

    map.createPane("offlineBase");
    map.getPane("offlineBase")!.style.zIndex = "180";
    map.createPane("taxAreas");
    map.getPane("taxAreas")!.style.zIndex = "310";
    map.createPane("taxStreets");
    map.getPane("taxStreets")!.style.zIndex = "330";
    map.createPane("parking");
    map.getPane("parking")!.style.zIndex = "480";
    map.createPane("route");
    map.getPane("route")!.style.zIndex = "450";

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      crossOrigin: true,
      attribution: "&copy; OpenStreetMap-bidragsgivare",
      className: "base-map-tiles",
    }).addTo(map);
    L.control.attribution({ prefix: false, position: "bottomright" })
      .addAttribution('&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>')
      .addTo(map);

    const offlineBase = L.layerGroup().addTo(map);
    OFFLINE_BASE_ROADS.forEach((positions) => {
      L.polyline(positions, { pane: "offlineBase", color: "#c7d0d1", weight: 5, opacity: 0.55 }).addTo(offlineBase);
      L.polyline(positions, { pane: "offlineBase", color: "#f8faf9", weight: 2, opacity: 0.95 }).addTo(offlineBase);
    });

    const taxAreas = L.layerGroup().addTo(map);
    [...TAX_AREAS].sort((a, b) => b.tariff - a.tariff).forEach((area) => {
      const color = TARIFFS[area.tariff].color;
      L.polygon(area.positions, {
        pane: "taxAreas",
        color,
        fillColor: color,
        weight: 1.4,
        opacity: 0.72,
        fillOpacity: 0.105,
        interactive: true,
      })
        .on("click", (event) => {
          L.DomEvent.stopPropagation(event);
          setSelectedParking(null);
          setSelectedZone(area.tariff);
        })
        .addTo(taxAreas);
    });

    const taxStreets = L.layerGroup().addTo(map);
    TAX_STREETS.forEach((street) => {
      const color = TARIFFS[street.tariff].color;
      L.polyline(street.positions, { pane: "taxStreets", color: "#ffffff", weight: 8, opacity: 0.9 }).addTo(taxStreets);
      L.polyline(street.positions, { pane: "taxStreets", color, weight: 4.5, opacity: 0.94 })
        .bindTooltip(`${street.name} · Taxa ${street.tariff}`, { sticky: true, className: "street-tooltip" })
        .on("click", (event) => {
          L.DomEvent.stopPropagation(event);
          setSelectedParking(null);
          setSelectedZone(street.tariff);
        })
        .addTo(taxStreets);
    });

    parkingLayerRef.current = L.layerGroup().addTo(map);
    locationLayerRef.current = L.layerGroup().addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);
    clickLayerRef.current = L.layerGroup().addTo(map);

    map.on("click", (event) => {
      const latlng = event.latlng;
      const pos: LatLng = [latlng.lat, latlng.lng];
      
      setSelectedZone(null);
      setSelectedParking(null);
      setClickedPosition(pos);
      setClickedAddress(null);
      setSearchFocused(false);
      
      if (window.navigator.onLine) {
        setClickedLoading(true);
        fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latlng.lat}&lon=${latlng.lng}&format=jsonv2&zoom=18&accept-language=sv`)
          .then((res) => {
            if (!res.ok) throw new Error("reverse-geocoding-failed");
            return res.json();
          })
          .then((data) => {
            const address = data.address;
            const road = address.road || address.pedestrian || address.suburb || address.village || data.display_name.split(",")[0];
            setClickedAddress(road || "Klickad position");
          })
          .catch(() => {
            setClickedAddress("Klickad position");
          })
          .finally(() => {
            setClickedLoading(false);
          });
      } else {
        setClickedAddress("Klickad position (offline)");
      }
    });

    map.on("moveend", () => {
      const center = map.getCenter();
      setViewCenter([center.lat, center.lng]);
      setMapZoom(map.getZoom());
    });

    window.setTimeout(() => map.invalidateSize(), 100);
    return () => {
      map.remove();
      mapRef.current = null;
      parkingLayerRef.current = null;
      locationLayerRef.current = null;
      routeLayerRef.current = null;
      clickLayerRef.current = null;
    };
  }, []);

  // Hantera klickad markör på kartan reaktivt
  useEffect(() => {
    const layer = clickLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (clickedPosition) {
      const icon = L.divIcon({
        className: "click-marker-wrap",
        html: '<div class="click-marker"></div>',
        iconSize: [28, 28],
        iconAnchor: [14, 28],
      });
      L.marker(clickedPosition, { pane: "parking", icon }).addTo(layer);
    }
  }, [clickedPosition]);

  const matchesCategory = useCallback((place: ParkingPlace) => {
    if (category === "all") return true;
    if (category === "free") return place.free;
    if (category === "garage") return place.kind === "garage";
    if (category === "street") return place.kind === "street" || place.kind === "surface";
    return place.tariff === category;
  }, [category]);

  const filteredParking = useMemo(() => allParking.filter(matchesCategory), [allParking, matchesCategory]);
  const focusPosition = userPosition || searchPosition || viewCenter;

  const searchMatches = useMemo(() => {
    const needle = normalize(query);
    const places = filteredParking.filter((place) => {
      if (!needle) return true;
      return normalize(`${place.name} ${place.address} ${place.area} ${place.kind} ${place.tariff ? `taxa ${place.tariff}` : "gratis"}`).includes(needle);
    });
    return places
      .map((place) => ({ place, distance: distanceKm(focusPosition, [place.lat, place.lng] as LatLng) }))
      .sort((a, b) => a.distance - b.distance);
  }, [filteredParking, focusPosition, query]);

  useEffect(() => {
    const layer = parkingLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    const markerPlaces = mapZoom < 14
      ? filteredParking.filter((place) => place.source === "local" || place.kind === "garage").slice(0, 100)
      : filteredParking.slice(0, 220);
    markerPlaces.forEach((place) => {
      L.marker([place.lat, place.lng], {
        pane: "parking",
        icon: parkingIcon(place, selectedParking?.id === place.id),
        keyboard: true,
        title: place.name,
      })
        .on("click", (event) => {
          L.DomEvent.stopPropagation(event);
          setSelectedZone(null);
          setClickedPosition(null);
          setSearchFocused(false);
          setSelectedParking(place);
        })
        .addTo(layer);
    });
  }, [filteredParking, mapZoom, selectedParking]);

  const selectCategory = (next: Category, fit = false) => {
    setCategory(next);
    setSelectedParking(null);
    setClickedPosition(null);
    setSearchLocations([]);
    setPanelOpen(true);
    if (fit && typeof next === "number" && mapRef.current) {
      const points = TAX_AREAS.filter((area) => area.tariff === next).flatMap((area) => area.positions);
      if (points.length) mapRef.current.fitBounds(L.latLngBounds(points), { padding: [70, 70], maxZoom: 13 });
    }
  };

  const handleSearch = async (event: FormEvent) => {
    event.preventDefault();
    const value = query.trim();
    setPanelOpen(true);
    setSearchLocations([]);
    if (!value) return;

    const tariffMatch = normalize(value).match(/^taxa\s*([1-5])$/);
    if (tariffMatch) {
      selectCategory(Number(tariffMatch[1]) as TariffId, true);
      setQuery("");
      return;
    }
    if (["gratis", "gratis parkering"].includes(normalize(value))) {
      selectCategory("free");
      setQuery("");
      return;
    }
    if (["garage", "parkeringsgarage"].includes(normalize(value))) {
      selectCategory("garage");
      setQuery("");
      return;
    }

    if (searchMatches.length > 0) {
      const closest = searchMatches[0].place;
      mapRef.current?.flyTo([closest.lat, closest.lng], 16, { duration: 1.15 });
      setSelectedParking(closest);
      return;
    }
    if (!online) {
      showNotice("Adressökning kräver internet. Sparade parkeringar går att söka offline.");
      return;
    }

    setSearching(true);
    try {
      const elapsed = Date.now() - lastGeocodeRef.current;
      if (elapsed < 1100) await new Promise((resolve) => window.setTimeout(resolve, 1100 - elapsed));
      lastGeocodeRef.current = Date.now();
      const params = new URLSearchParams({
        q: `${value}, Stockholm`,
        format: "jsonv2",
        limit: "5",
        countrycodes: "se",
        bounded: "1",
        viewbox: "17.75,59.48,18.35,59.15",
      });
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("Sökningen misslyckades");
      const result = (await response.json()) as Array<{ display_name: string; lat: string; lon: string; type: string }>;
      setSearchLocations(result.map((item) => ({
        name: item.display_name.replace(/, Sverige$/, ""),
        lat: Number(item.lat),
        lng: Number(item.lon),
        type: item.type,
      })));
      if (result.length === 0) showNotice("Ingen adress hittades i Stockholm");
    } catch {
      showNotice("Adressökningen kunde inte nås just nu");
    } finally {
      setSearching(false);
    }
  };

  const chooseSearchLocation = (location: SearchLocation) => {
    const position: LatLng = [location.lat, location.lng];
    setSearchPosition(position);
    setClickedPosition(null);
    setQuery("");
    setSearchLocations([]);
    mapRef.current?.flyTo(position, 16, { duration: 1.2 });
    showNotice("Visar parkeringar närmast den valda platsen");
  };

  const locateUser = () => {
    if (!navigator.geolocation) {
      showNotice("Din webbläsare saknar stöd för GPS");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next: LatLng = [position.coords.latitude, position.coords.longitude];
        setUserPosition(next);
        setSearchPosition(null);
        setClickedPosition(null);
        setLocating(false);
        const layer = locationLayerRef.current;
        layer?.clearLayers();
        if (layer) {
          L.circle(next, {
            pane: "parking",
            radius: Math.min(position.coords.accuracy, 220),
            color: "#3478f6",
            fillColor: "#3478f6",
            fillOpacity: 0.08,
            weight: 1,
          }).addTo(layer);
          L.marker(next, { pane: "parking", icon: userIcon(), title: "Din position" }).addTo(layer);
        }
        mapRef.current?.flyTo(next, 16, { duration: 1.2 });
        showNotice("GPS-position hittad");
      },
      () => {
        setLocating(false);
        showNotice("Kunde inte läsa din position. Kontrollera platsbehörigheten.");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 },
    );
  };

  const buildRoute = async (destination: ParkingPlace) => {
    const start = userPosition || viewCenter;
    if (!userPosition) showNotice("Rutten startar från kartans mitt. Aktivera GPS för din exakta position.");
    setRouteLoading(true);
    routeLayerRef.current?.clearLayers();
    const drawRoute = (positions: LatLng[], fallback: boolean, distance: number, minutes: number) => {
      const layer = routeLayerRef.current;
      if (!layer) return;
      L.polyline(positions, { pane: "route", color: "#ffffff", weight: 10, opacity: 0.92 }).addTo(layer);
      L.polyline(positions, { pane: "route", color: "#1266ee", weight: 6, opacity: 1, dashArray: fallback ? "7 10" : undefined }).addTo(layer);
      mapRef.current?.fitBounds(L.latLngBounds(positions), { paddingTopLeft: [420, 90], paddingBottomRight: [70, 170], maxZoom: 17 });
      setRouteInfo({ distance, minutes, fallback, destination });
      setSelectedParking(null);
    };

    try {
      if (!online) throw new Error("offline");
      const url = `https://router.project-osrm.org/route/v1/driving/${start[1]},${start[0]};${destination.lng},${destination.lat}?overview=full&geometries=geojson&steps=false`;
      const response = await fetch(url);
      if (!response.ok) throw new Error("route");
      const data = (await response.json()) as {
        routes?: Array<{ distance: number; duration: number; geometry: { coordinates: [number, number][] } }>;
      };
      const route = data.routes?.[0];
      if (!route) throw new Error("route");
      const positions = route.geometry.coordinates.map(([lng, lat]) => [lat, lng] as LatLng);
      drawRoute(positions, false, route.distance / 1000, route.duration / 60);
    } catch {
      const direct = distanceKm(start, [destination.lat, destination.lng]);
      drawRoute([start, [destination.lat, destination.lng]], true, direct, (direct / 25) * 60);
      showNotice("Visar fågelvägen. Vägrutt kräver internet.");
    } finally {
      setRouteLoading(false);
    }
  };

  const clearRoute = () => {
    routeLayerRef.current?.clearLayers();
    setRouteInfo(null);
  };

  const saveOffline = async () => {
    localStorage.setItem("parksthlm-offline-ready", "true");
    setOfflineReady(true);
    try {
      const registration = await navigator.serviceWorker?.ready;
      registration?.active?.postMessage({ type: "CACHE_APP" });
    } catch {
      // Local map and parking data are already bundled in the application.
    }
    showNotice("Offline-läge klart. Besökta kartvyer sparas automatiskt.");
  };

  const showParking = (place: ParkingPlace) => {
    setSelectedZone(null);
    setSelectedParking(place);
    mapRef.current?.flyTo([place.lat, place.lng], Math.max(mapRef.current.getZoom(), 15), { duration: 0.8 });
  };

  const visibleResults = searchMatches.slice(0, query ? 18 : 10);

  return (
    <main className={`app-shell ${online ? "is-online" : "is-offline"}`}>
      <div ref={mapNodeRef} className="map-canvas" aria-label="Karta över parkeringsplatser och taxeområden i Stockholm" />

      <section className={`map-panel ${panelOpen ? "panel-open" : ""}`} aria-label="Parkeringssökning">
        <header className="brand-row">
          <button className="mobile-menu" type="button" onClick={() => setPanelOpen((open) => !open)} aria-label="Öppna meny">
            {panelOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <button className="brand" type="button" onClick={() => mapRef.current?.flyTo(STOCKHOLM_CENTER, 13, { duration: 1 })}>
            <span className="brand-mark"><ParkingCircle size={24} strokeWidth={2.4} /></span>
            <span><strong>Park Stockholm</strong><small>Taxa, plats, klart.</small></span>
          </button>
          <button className={`connection ${online ? "online" : "offline"}`} type="button" onClick={() => !online && showNotice("Offline: lokala taxor, GPS och sparade parkeringar fungerar") }>
            {online ? <Wifi size={14} /> : <WifiOff size={14} />}
            <span>{online ? "Live" : "Offline"}</span>
          </button>
          <button className="theme-toggle" type="button" onClick={() => setDarkMode(!darkMode)} aria-label="Växla tema">
            {darkMode ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </header>

        <form className="search-box" onSubmit={handleSearch}>
          <Search size={21} aria-hidden="true" />
          <input
            value={query}
            onFocus={() => setSearchFocused(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setSearchLocations([]);
            }}
            placeholder="Sök adress, gata, område eller taxa"
            aria-label="Sök efter adress, område eller parkering"
          />
          {(query || searchFocused) && (
            <button type="button" className="clear-search" onClick={() => { setQuery(""); setSearchLocations([]); setSearchFocused(false); }} aria-label="Rensa sökning">
              <X size={17} />
            </button>
          )}
          <button className="search-submit" type="submit" aria-label="Sök" disabled={searching}>
            {searching ? <RefreshCw className="spin" size={18} /> : <Navigation size={18} />}
          </button>
        </form>

        <div className="quick-filters" aria-label="Snabbfilter">
          <button className={category === "all" ? "active" : ""} onClick={() => selectCategory("all")} type="button">Alla</button>
          <button className={category === "garage" ? "active" : ""} onClick={() => selectCategory("garage")} type="button"><Warehouse size={15} /> Garage</button>
          <button className={category === "free" ? "active" : ""} onClick={() => selectCategory("free")} type="button">Gratis</button>
          <button className="filter-button" onClick={() => setFiltersOpen((open) => !open)} type="button" aria-expanded={filtersOpen}>
            <SlidersHorizontal size={15} /> Taxor <ChevronDown size={14} />
          </button>
        </div>

        <AnimatePresence initial={false}>
          {filtersOpen && (
            <motion.div
              className="tariff-filter"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25 }}
            >
              <div className="filter-heading"><span>Välj taxeområde</span><small>Pris just nu</small></div>
              <div className="tariff-grid">
                {([1, 2, 3, 4, 5] as TariffId[]).map((tariff) => {
                  const current = getCurrentPrice(tariff);
                  return (
                    <button
                      key={tariff}
                      type="button"
                      className={category === tariff ? "active" : ""}
                      onClick={() => selectCategory(tariff, true)}
                      style={{ "--tariff-color": TARIFFS[tariff].color } as React.CSSProperties}
                    >
                      <span className="tariff-number">{tariff}</span>
                      <span><strong>Taxa {tariff}</strong><small>{current.amount === 0 ? "Gratis nu" : `${current.amount} kr/tim`}</small></span>
                    </button>
                  );
                })}
              </div>
              <button type="button" className={`street-toggle ${category === "street" ? "active" : ""}`} onClick={() => selectCategory("street")}>
                <Route size={16} /> Visa endast gatu- och markparkering
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="panel-body">
          {searchFocused && !query ? (
            <div className="search-suggestions">
              <div className="suggestions-header">Snabbsökningar</div>
              <button type="button" onClick={() => { locateUser(); setSearchFocused(false); }} className="suggestion-item">
                <LocateFixed size={16} className="text-blue" />
                <span>Närmsta parkering utifrån GPS</span>
              </button>
              <button type="button" onClick={() => { selectCategory("free"); setSearchFocused(false); }} className="suggestion-item">
                <span className="dot free"></span>
                <span>Avgiftsfri parkering (Gratis)</span>
              </button>
              <button type="button" onClick={() => { selectCategory("garage"); setSearchFocused(false); }} className="suggestion-item">
                <Warehouse size={16} className="text-gray" />
                <span>Parkeringsgarage & P-hus</span>
              </button>
              <button type="button" onClick={() => { selectCategory("street"); setSearchFocused(false); }} className="suggestion-item">
                <Route size={16} className="text-gray" />
                <span>Gatu- & markparkering</span>
              </button>
              
              <div className="suggestions-header">Sök efter taxa</div>
              <div className="suggestion-tariff-grid">
                {([1, 2, 3, 4, 5] as TariffId[]).map((t) => (
                  <button key={t} type="button" onClick={() => { selectCategory(t, true); setSearchFocused(false); }} className="suggestion-tariff-btn" style={{ "--t-color": TARIFFS[t].color } as React.CSSProperties}>
                    <span className="tariff-badge">{t}</span>
                    <span>Taxa {t}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : searchLocations.length > 0 ? (
            <div className="location-results">
              <div className="results-heading"><span>Adresser i Stockholm</span><small>Välj plats</small></div>
              {searchLocations.map((location, index) => (
                <motion.button
                  key={`${location.lat}-${location.lng}`}
                  type="button"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.04 }}
                  onClick={() => chooseSearchLocation(location)}
                >
                  <MapPin size={18} />
                  <span><strong>{location.name.split(",")[0]}</strong><small>{location.name.split(",").slice(1, 4).join(",")}</small></span>
                  <Navigation size={16} />
                </motion.button>
              ))}
              <small className="osm-credit">Adressökning: OpenStreetMap Nominatim</small>
            </div>
          ) : (
            <div className="parking-results">
              <div className="results-heading">
                <span>{query ? "Sökresultat" : userPosition ? "Närmast dig" : searchPosition ? "Närmast vald plats" : categoryLabel(category)}</span>
                <button type="button" onClick={() => void fetchOsmParking(true)} disabled={dataLoading || !online} title="Uppdatera parkeringsdata">
                  <RefreshCw size={14} className={dataLoading ? "spin" : ""} />
                  {filteredParking.length} platser
                </button>
              </div>

              <div className="result-list">
                {visibleResults.map(({ place, distance }, index) => (
                  <motion.button
                    type="button"
                    key={place.id}
                    className={`parking-result ${selectedParking?.id === place.id ? "selected" : ""}`}
                    onClick={() => showParking(place)}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.22, delay: Math.min(index * 0.025, 0.18) }}
                  >
                    <span className="result-icon" style={{ "--place-color": place.free ? "#16a36f" : place.tariff ? TARIFFS[place.tariff].color : "#172536" } as React.CSSProperties}>
                      {place.kind === "garage" ? <Building2 size={17} /> : <ParkingCircle size={19} />}
                    </span>
                    <span className="result-copy">
                      <strong>{place.name}</strong>
                      <small>{place.address} · {place.area}</small>
                      <span>
                        <b className={place.free ? "free" : ""}>{place.free ? "Gratis" : place.tariff ? `Taxa ${place.tariff}` : place.priceText}</b>
                        <i>{place.kind === "garage" ? "Garage" : place.kind === "surface" ? "Markparkering" : "Gatuparkering"}</i>
                      </span>
                    </span>
                    <span className="result-distance">{formatDistance(distance)}<Navigation size={14} /></span>
                  </motion.button>
                ))}
                {visibleResults.length === 0 && (
                  <div className="empty-results">
                    <Search size={25} />
                    <strong>Ingen parkering matchar</strong>
                    <span>Prova en adress eller välj ett annat filter.</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="panel-foot">
            <CircleAlert size={14} />
            <span>Skyltningen på gatan gäller alltid. Taxekartan är vägledande.</span>
            <button type="button" onClick={() => setInfoOpen(true)}>Läs mer</button>
          </div>
        </div>
      </section>

      <div className="map-top-actions">
        <button type="button" onClick={() => setPanelOpen((open) => !open)} className="list-button">
          <ListFilter size={18} /> <span>{panelOpen ? "Dölj lista" : "Visa parkeringar"}</span>
        </button>
        <button type="button" onClick={saveOffline} className={offlineReady ? "offline-saved" : ""}>
          <Download size={17} /> <span>{offlineReady ? "Offline redo" : "Spara offline"}</span>
        </button>
        <button type="button" onClick={() => setInfoOpen(true)} aria-label="Information"><Info size={18} /></button>
      </div>

      <div className="map-controls" aria-label="Kartkontroller">
        <button type="button" onClick={() => mapRef.current?.zoomIn()} aria-label="Zooma in"><ZoomIn size={20} /></button>
        <button type="button" onClick={() => mapRef.current?.zoomOut()} aria-label="Zooma ut"><ZoomOut size={20} /></button>
        <button type="button" className={locating ? "locating" : ""} onClick={locateUser} aria-label="Hitta min position">
          {locating ? <RefreshCw className="spin" size={20} /> : <LocateFixed size={20} />}
        </button>
      </div>

      <div className="map-legend">
        <Layers3 size={15} />
        <span>Taxa</span>
        {([1, 2, 3, 4, 5] as TariffId[]).map((tariff) => (
          <button key={tariff} type="button" onClick={() => selectCategory(tariff, true)} title={`Visa taxa ${tariff}`}>
            <i style={{ background: TARIFFS[tariff].color }} />{tariff}
          </button>
        ))}
      </div>

      <AnimatePresence>
        {selectedParking && (
          <motion.aside
            className="place-sheet"
            initial={{ opacity: 0, y: 35, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 25, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 330, damping: 30 }}
          >
            <button className="sheet-close" type="button" onClick={() => setSelectedParking(null)} aria-label="Stäng"><X size={18} /></button>
            <div className="place-title">
              <span style={{ "--place-color": selectedParking.free ? "#16a36f" : selectedParking.tariff ? TARIFFS[selectedParking.tariff].color : "#172536" } as React.CSSProperties}>
                {selectedParking.kind === "garage" ? <Warehouse size={21} /> : <ParkingCircle size={23} />}
              </span>
              <div><small>{selectedParking.kind === "garage" ? "Parkeringsgarage" : selectedParking.kind === "surface" ? "Markparkering" : "Gatuparkering"}</small><h2>{selectedParking.name}</h2><p>{selectedParking.address}, {selectedParking.area}</p></div>
            </div>
            <div className="place-facts">
              <div><small>Pris</small><strong>{selectedParking.free ? "Gratis" : selectedParking.tariff ? getCurrentPrice(selectedParking.tariff).label : selectedParking.priceText}</strong></div>
              <div><small>Avstånd</small><strong>{formatDistance(distanceKm(focusPosition, [selectedParking.lat, selectedParking.lng]))}</strong></div>
              {selectedParking.spaces ? <div><small>Platser</small><strong>{selectedParking.spaces}</strong></div> : null}
            </div>
            <p className="place-note"><CircleAlert size={15} />{selectedParking.note}</p>
            <div className="place-actions">
              <button type="button" className="primary-action" onClick={() => void buildRoute(selectedParking)} disabled={routeLoading}>
                {routeLoading ? <RefreshCw className="spin" size={18} /> : <Navigation size={18} />} Navigera hit
              </button>
              <button type="button" onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${selectedParking.lat},${selectedParking.lng}&travelmode=driving`, "_blank", "noopener,noreferrer")}>
                <ExternalLink size={17} /> Google
              </button>
              <button type="button" onClick={() => window.open(`https://waze.com/ul?ll=${selectedParking.lat},${selectedParking.lng}&navigate=yes`, "_blank", "noopener,noreferrer")}>
                <CarFront size={17} /> Waze
              </button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {clickedPosition && clickedPlace && (
          <motion.aside
            className="place-sheet clicked-sheet"
            initial={{ opacity: 0, y: 35, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 25, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 330, damping: 30 }}
          >
            <button className="sheet-close" type="button" onClick={() => setClickedPosition(null)} aria-label="Stäng"><X size={18} /></button>
            <div className="place-title">
              <span style={{ "--place-color": clickedPlace.free ? "#16a36f" : TARIFFS[clickedPlace.tariff!].color } as React.CSSProperties}>
                <MapPin size={23} />
              </span>
              <div>
                <small>{clickedPlace.free ? "Avgiftsfritt område" : `Taxeområde ${clickedPlace.tariff}`}</small>
                {clickedLoading ? (
                  <div className="loader-dots"><span></span><span></span><span></span></div>
                ) : (
                  <h2>{clickedPlace.name}</h2>
                )}
                <p>{clickedPlace.address}</p>
              </div>
            </div>
            <div className="place-facts">
              <div>
                <small>Pris just nu</small>
                <strong>
                  {clickedPlace.free ? "Gratis" : getCurrentPrice(clickedPlace.tariff!).label}
                </strong>
              </div>
              <div>
                <small>Områdestaxa</small>
                <strong>
                  {clickedPlace.free ? "Gratis" : TARIFFS[clickedPlace.tariff!].price}
                </strong>
              </div>
              <div>
                <small>Avstånd</small>
                <strong>{formatDistance(distanceKm(focusPosition, [clickedPlace.lat, clickedPlace.lng]))}</strong>
              </div>
            </div>
            <p className="place-note"><CircleAlert size={15} />{clickedPlace.free ? "Detta område har ingen ordinarie taxa enligt kartgränserna. Lokala villkor och P-skiva kan gälla." : TARIFFS[clickedPlace.tariff!].hours}</p>
            <div className="place-actions">
              <button type="button" className="primary-action" onClick={() => void buildRoute(clickedPlace)} disabled={routeLoading}>
                {routeLoading ? <RefreshCw className="spin" size={18} /> : <Navigation size={18} />} Navigera hit
              </button>
              <button type="button" onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${clickedPlace.lat},${clickedPlace.lng}&travelmode=driving`, "_blank", "noopener,noreferrer")}>
                <ExternalLink size={17} /> Google
              </button>
              <button type="button" onClick={() => window.open(`https://waze.com/ul?ll=${clickedPlace.lat},${clickedPlace.lng}&navigate=yes`, "_blank", "noopener,noreferrer")}>
                <CarFront size={17} /> Waze
              </button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedZone && !selectedParking && (
          <motion.aside className="zone-sheet" initial={{ opacity: 0, y: 25 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}>
            <button className="sheet-close" type="button" onClick={() => setSelectedZone(null)} aria-label="Stäng"><X size={17} /></button>
            <span className="zone-number" style={{ background: TARIFFS[selectedZone].color }}>{selectedZone}</span>
            <div><small>Taxeområde {selectedZone}</small><h2>{getCurrentPrice(selectedZone).label}</h2><p>{TARIFFS[selectedZone].hours}</p></div>
            <button type="button" onClick={() => { selectCategory(selectedZone); setSelectedZone(null); }}>Visa parkeringar</button>
          </motion.aside>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {routeInfo && (
          <motion.div className="route-banner" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <span><Route size={22} /></span>
            <div><small>{routeInfo.fallback ? "Ungefärlig riktning" : "Snabbaste bilvägen"}</small><strong>{Math.max(1, Math.round(routeInfo.minutes))} min <i>·</i> {formatDistance(routeInfo.distance)}</strong><p>Till {routeInfo.destination.name}</p></div>
            <button type="button" onClick={clearRoute}><X size={18} /></button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {infoOpen && (
          <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setInfoOpen(false)}>
            <motion.section className="info-modal" initial={{ opacity: 0, y: 28, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 18 }} onClick={(event) => event.stopPropagation()}>
              <button className="sheet-close" type="button" onClick={() => setInfoOpen(false)} aria-label="Stäng"><X size={19} /></button>
              <span className="info-icon"><Info size={24} /></span>
              <h2>Parkera smartare i Stockholm</h2>
              <p>Kartan visar Stockholms fem ordinarie taxeområden, gatuparkering, garage, markparkering och platser som är markerade som gratis.</p>
              <div className="info-list">
                <div><strong>Taxedata</strong><span>Prisnivåer och tider baseras på Stockholms stads publicerade taxor. Helgdagar och lokala avvikelser kan förekomma.</span></div>
                <div><strong>Live-parkering</strong><span>Kompletteras online från OpenStreetMap och sparas i telefonen för senare användning.</span></div>
                <div><strong>Offline</strong><span>App, taxor, lokala parkeringar, GPS och besökta kartvyer fungerar utan nät. Ny adressökning och vägrutt kräver internet.</span></div>
              </div>
              <div className="warning-box"><CircleAlert size={18} /><span><strong>Viktigt:</strong> Vägmärken och skyltning på plats gäller alltid före kartan. Kontrollera även servicedag, max tid och eventuella tillståndskrav.</span></div>
              <div className="source-links">
                <a href="https://parkering.stockholm/betala-parkering/taxeomraden-avgifter/" target="_blank" rel="noreferrer">Stockholms stads taxor <ExternalLink size={14} /></a>
                <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap <ExternalLink size={14} /></a>
              </div>
              <button type="button" className="modal-action" onClick={() => { void saveOffline(); setInfoOpen(false); }}><Download size={17} /> {offlineReady ? "Offline-data är sparad" : "Gör appen redo offline"}</button>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {notice && (
          <motion.div className="toast" initial={{ opacity: 0, y: 18, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 14 }}>
            <Crosshair size={17} /> {notice}
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

export default App;
