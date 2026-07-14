import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import L, { type LayerGroup, type Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import { AnimatePresence, motion } from "framer-motion";
import {
  Accessibility,
  Bike,
  Building2,
  CarFront,
  ChevronDown,
  CircleAlert,
  Crosshair,
  Download,
  ExternalLink,
  Heart,
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
  Save,
  Search,
  Settings2,
  Share2,
  SlidersHorizontal,
  Sun,
  Warehouse,
  Wifi,
  WifiOff,
  X,
  Zap,
  Clock3,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  distanceKm,
  getCurrentPrice,
  LOCAL_PARKING,
  OFFLINE_BASE_ROADS,
  type EvConnection,
  type ParkingPlace,
  STOCKHOLM_CENTER,
  TARIFFS,
  TAX_AREAS,
  TAX_STREETS,
  type LatLng,
  type TariffId,
} from "./data";

type Category = "all" | "free" | "garage" | "street" | "disabled" | "ev" | "mc" | TariffId;
type NavigationStep = { instruction: string; distance: number; location: LatLng };
type AreaScope = { center: LatLng; label: string; radiusKm: number };
type RouteInfo = {
  distance: number;
  minutes: number;
  fallback: boolean;
  destination: ParkingPlace;
  positions: LatLng[];
  steps: NavigationStep[];
  currentStep: number;
  remainingMeters: number;
  tracking: boolean;
  arrived: boolean;
};
type SearchLocation = { name: string; lat: number; lng: number; type: string };
type InstallPlatform = "android" | "ios";
type VehicleProfile = "car" | "ev" | "mc" | "disabled";
type ParkedCar = {
  lat: number;
  lng: number;
  address: string;
  savedAt: number;
  note: string;
  spot: string;
  source: "parking" | "gps" | "search" | "map";
};
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const OVERPASS_ENDPOINTS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];
const OVERPASS_ENDPOINT = OVERPASS_ENDPOINTS[0];
const STOCKHOLM_DATA_BBOX = "59.15,17.70,59.50,18.35";
const NON_PUBLIC_OSM_ACCESS = new Set(["private", "no", "permit", "employees"]);
const PWA_INSTALL_DISMISSAL_KEY = "parksthlm-pwa-install-dismissed-v4";
const AREA_SEARCH_RADIUS_KM = 1.15;
const FAVORITES_STORAGE_KEY = "parksthlm-favorites-v1";
const PARKED_CAR_STORAGE_KEY = "parksthlm-parked-car-v1";
const VEHICLE_PROFILE_STORAGE_KEY = "parksthlm-vehicle-profile-v1";

const VEHICLE_PROFILES: Record<VehicleProfile, { label: string; filter: Category; description: string }> = {
  car: { label: "Bil", filter: "all", description: "Visar alla parkeringar" },
  ev: { label: "Elbil", filter: "ev", description: "Visar laddplatser" },
  mc: { label: "MC", filter: "mc", description: "Visar MC-parkeringar" },
  disabled: { label: "Rörelsehindrad", filter: "disabled", description: "Visar tillgängliga platser" },
};

function readLocalStorage<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function isIosDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isMobileDevice() {
  return isIosDevice() || /Android/i.test(navigator.userAgent) || window.matchMedia("(max-width: 820px)").matches;
}

function hasRecentPwaInstallDismissal() {
  return sessionStorage.getItem(PWA_INSTALL_DISMISSAL_KEY) === "true";
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function isTariffId(value: unknown): value is TariffId {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

function placeColor(place: ParkingPlace) {
  if ((place.evSpaces ?? 0) > 0) return "#7c3aed";
  if ((place.disabledSpaces ?? 0) > 0) return "#2563eb";
  if ((place.mcSpaces ?? 0) > 0) return "#d97706";
  if (place.free) return "#16a36f";
  return isTariffId(place.tariff) ? TARIFFS[place.tariff].color : "#172536";
}

function placeTariffLabel(place: ParkingPlace) {
  if (place.free) return "Avgiftsfri";
  if (isTariffId(place.tariff)) return `Taxa ${place.tariff}`;
  return place.priceText;
}

function placeKindLabel(place: ParkingPlace) {
  if ((place.evSpaces ?? 0) > 0) return "Laddplats";
  if ((place.disabledSpaces ?? 0) > 0) return "Rörelsehindrade";
  if ((place.mcSpaces ?? 0) > 0) return "MC-parkering";
  if (place.kind === "garage") return "Parkeringsgarage";
  if (place.kind === "surface") return "Markparkering";
  return "Gatuparkering";
}

function parkingIcon(place: ParkingPlace, selected: boolean) {
  const isEv = (place.evSpaces ?? 0) > 0;
  const isDisabled = (place.disabledSpaces ?? 0) > 0;
  const isMc = (place.mcSpaces ?? 0) > 0;
  const color = placeColor(place);
  const letter = isEv ? "E" : isDisabled ? "H" : isMc ? "M" : place.free ? "G" : place.kind === "garage" ? "G" : "P";
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

function parkedCarIcon() {
  return L.divIcon({
    className: "parked-car-marker-wrap",
    html: '<div class="parked-car-marker"><span>🚙</span><b>MIN BIL</b></div>',
    iconSize: [76, 58],
    iconAnchor: [10, 54],
  });
}

function formatRouteDistance(meters: number) {
  return meters < 1000 ? `${Math.max(10, Math.round(meters / 10) * 10)} m` : `${(meters / 1000).toFixed(1).replace(".", ",")} km`;
}

function navigationInstruction(type?: string, modifier?: string, name?: string, exit?: number) {
  const road = name ? ` på ${name}` : "";
  const direction = modifier === "left" ? "vänster" : modifier === "right" ? "höger" : modifier === "slight left" ? "svagt vänster" : modifier === "slight right" ? "svagt höger" : modifier === "sharp left" ? "skarpt vänster" : modifier === "sharp right" ? "skarpt höger" : "rakt fram";
  if (type === "depart") return name ? `Kör ut på ${name}` : "Starta körningen";
  if (type === "arrive") return "Du är framme vid parkeringen";
  if (type === "roundabout" || type === "rotary") return exit ? `Ta avfart ${exit} i rondellen${road}` : `Kör in i rondellen${road}`;
  if (type === "merge") return `Foga in${road}`;
  if (type === "fork") return `Håll ${direction}${road}`;
  if (type === "continue" || type === "new name") return name ? `Fortsätt på ${name}` : "Fortsätt rakt fram";
  if (type === "turn" || type === "end") return `Sväng ${direction}${road}`;
  return name ? `Fortsätt på ${name}` : "Fortsätt på vägen";
}

function routeProgress(position: LatLng, positions: LatLng[]) {
  let nearestIndex = 0;
  let nearestMeters = Number.POSITIVE_INFINITY;
  positions.forEach((routePosition, index) => {
    const meters = distanceKm(position, routePosition) * 1000;
    if (meters < nearestMeters) {
      nearestMeters = meters;
      nearestIndex = index;
    }
  });
  let remainingMeters = nearestMeters;
  for (let index = nearestIndex; index < positions.length - 1; index += 1) {
    remainingMeters += distanceKm(positions[index], positions[index + 1]) * 1000;
  }
  return { nearestMeters, remainingMeters };
}

const OSM_SOCKET_NAMES: Record<string, string> = {
  type2: "Type 2 (Socket)",
  type2_tethered: "Type 2 (Tethered)",
  type2_cable: "Type 2 (Socket)",
  type2_combo: "CCS (Type 2)",
  chademo: "CHAdeMO",
  tesla_supercharger: "Tesla Supercharger",
  tesla_destination: "Tesla Destination",
  schuko: "Schuko (Type F)",
  type1: "Type 1 (J1772)",
  type1_ccs: "CCS (Type 1)",
  type3: "Type 3",
  ccee: "CEE",
};

function parseOsmSocketTags(tags: Record<string, string>): EvConnection[] | undefined {
  const connections: EvConnection[] = [];
  for (const key in tags) {
    const match = key.match(/^socket:(.+?)(?::output|:voltage|:current|:ampere)?$/);
    if (!match) continue;
    const socketName = match[1];
    if (!OSM_SOCKET_NAMES[socketName]) continue;
    const value = tags[key];
    const qty = Number(value);
    if (!Number.isFinite(qty) || qty < 1) continue;
    const outputKey = `socket:${socketName}:output`;
    const voltageKey = `socket:${socketName}:voltage`;
    const currentKey = `socket:${socketName}:current`;
    const ampereKey = `socket:${socketName}:ampere`;
    const powerStr = tags[outputKey];
    const powerKW = powerStr ? parseFloat(powerStr.replace(/,/g, ".")) : undefined;
    const voltage = tags[voltageKey] ? parseFloat(tags[voltageKey].replace(/,/g, ".")) : undefined;
    const current = tags[currentKey] ? parseFloat(tags[currentKey].replace(/,/g, ".")) : tags[ampereKey] ? parseFloat(tags[ampereKey].replace(/,/g, ".")) : undefined;
    connections.push({
      quantity: qty,
      powerKW: powerKW ?? 0,
      type: OSM_SOCKET_NAMES[socketName],
      status: "Operativ",
      currentType: current && voltage ? "AC (Trefas)" : powerKW !== undefined && powerKW > 50 ? "DC" : "AC",
      amps: current ?? 0,
      voltage: voltage ?? 0,
    });
  }
  return connections.length > 0 ? connections : undefined;
}

function parseOsmParking(payload: unknown): ParkingPlace[] {
  if (!payload || typeof payload !== "object" || !("elements" in payload)) return [];
  const elements = (payload as { elements?: Array<Record<string, unknown>> }).elements;
  if (!Array.isArray(elements)) return [];

  return elements.flatMap((element): ParkingPlace[] => {
    const tags = (element.tags || {}) as Record<string, string>;
    if (NON_PUBLIC_OSM_ACCESS.has(tags.access)) return [];
    const center = element.center as { lat?: number; lon?: number } | undefined;
    const lat = Number(element.lat ?? center?.lat);
    const lng = Number(element.lon ?? center?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];

    const isDisabledSpace = tags.amenity === "parking_space" && ["yes", "designated"].includes(tags.disabled);
    const isMotorcycleSpace = tags.amenity === "parking_space" && ["yes", "designated", "only"].includes(tags.motorcycle);
    const isChargingStation = tags.amenity === "charging_station";

    const parkingTag = tags.parking || "surface";
    const kind = ["underground", "multi-storey", "garage", "sheds"].includes(parkingTag) || tags.building === "parking"
      ? "garage"
      : parkingTag === "street_side" || parkingTag === "lane"
        ? "street"
        : "surface";
    const free = tags.fee === "no";
    const name = isDisabledSpace ? "Parkering för rörelsehindrade" : isMotorcycleSpace ? "MC-parkering" : isChargingStation ? (tags.name || tags.operator || "Laddstation") : tags.name || tags.operator || (kind === "garage" ? "Parkeringsgarage" : "Parkering");
    const streetAddress = [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" ");
    const disabledSpacesVal = (() => {
      if (isDisabledSpace) return 1;
      const capDisabled = Number(tags["capacity:disabled"]);
      if (Number.isFinite(capDisabled)) return capDisabled;
      const disabledCap = Number(tags["disabled:capacity"]);
      if (Number.isFinite(disabledCap)) return disabledCap;
      if (tags.disabled === "yes" || tags.disabled === "designated") return 1;
      return undefined;
    })();
    const evSpacesVal = isChargingStation ? (Number.isFinite(Number(tags.capacity)) ? Number(tags.capacity) : 1) : Number.isFinite(Number(tags["capacity:charging"])) ? Number(tags["capacity:charging"]) : undefined;
    const evConnectionsVal = isChargingStation ? parseOsmSocketTags(tags) : undefined;
    const mcSpacesVal = isMotorcycleSpace
      ? 1
      : Number.isFinite(Number(tags["capacity:motorcycle"]))
        ? Number(tags["capacity:motorcycle"])
        : ["yes", "designated", "only"].includes(tags.motorcycle)
          ? Number(tags.capacity) || 1
          : undefined;

    return [{
      id: `osm-${String(element.type)}-${String(element.id)}`,
      name,
      address: streetAddress || tags.description || tags.name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      area: tags["addr:suburb"] || tags["addr:city"] || "Stockholm",
      lat,
      lng,
      kind: isChargingStation ? "surface" : kind,
      tariff: null,
      free,
      priceText: free ? "Avgiftsfri enligt OpenStreetMap" : tags.charge || (tags.fee === "yes" ? "Avgift enligt OpenStreetMap" : "Pris ej verifierat"),
      note: isDisabledSpace
        ? "Handikapparkering. Gällande regler skyltas på plats."
        : isMotorcycleSpace
          ? "MC-parkering enligt OpenStreetMap. Kontrollera skyltning och fordonsslag på plats."
          : isChargingStation
          ? "Laddstation enligt OpenStreetMap. Ladd- och parkeringsavgift verifieras inte av denna källa."
          : free
            ? tags.fee === "no"
              ? "Markerad som avgiftsfri i OpenStreetMap. Kontrollera skyltningen på plats."
              : "Markerad som avgiftsfri i OpenStreetMap. Kontrollera alltid skyltning på plats."
            : "Pris saknas eller är osäkert i OpenStreetMap. Kontrollera infart eller skyltning på plats.",
      spaces: Number.isFinite(Number(tags.capacity)) ? Number(tags.capacity) : undefined,
      disabledSpaces: disabledSpacesVal,
      mcSpaces: mcSpacesVal,
      evSpaces: evSpacesVal,
      evConnections: evConnectionsVal,
      source: "osm",
    }];
  });
}

type ApiFacility = {
  Name?: string;
  Namn?: string;
  Adress?: string;
  AdressLatitud?: number;
  AdressLongitud?: number;
  Anlaggningstyp?: string;
  AntalBesokPlatser?: number;
  AntalBesokPlatserRorelsehindrad?: number;
  AntalBesokPlatserMc?: number;
  AntalLaddplatserBesokBil?: number;
  AntalLaddplatserBesokMc?: number;
  GeografisktOmrade?: string;
  Omrade?: string;
  Besokstaxa?: { Galler?: string; Taxa?: number; Tidsenhet?: string };
  BesokstaxaCollection?: Array<{ Galler?: string; Taxa?: number; Tidsenhet?: string; ParkeringsTypNamn?: string }>;
};

type StockholmParkingFacility = {
  id?: string;
  name?: string;
  url?: string;
  location?: { address?: string; areaCode?: string; position?: { latitude?: number; longitude?: number } };
  visitorTaxes?: Array<{ tax?: number; timeUnit?: string; active?: string; parkingTypeName?: string }>;
  facilityType?: string;
  features?: {
    totalVisitorSpace?: number;
    totalDisabledSpaces?: number;
    totalMcVisitorSpaces?: number;
    loadingSpacesCarVisitors?: number;
    fastLoadingSpaces?: number;
  };
  isVisit?: boolean;
  isGarage?: boolean;
  isSurfaceParking?: boolean;
  facilityNumber?: string;
};

function parseApiParking(payload: unknown): ParkingPlace[] {
  const currentFacilities = (payload as { Hits?: StockholmParkingFacility[] } | null)?.Hits;
  if (Array.isArray(currentFacilities)) {
    return currentFacilities.flatMap((facility): ParkingPlace[] => {
      const lat = Number(facility.location?.position?.latitude);
      const lng = Number(facility.location?.position?.longitude);
      if (!facility.name || facility.isVisit === false || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];
      const tax = facility.visitorTaxes?.find((entry) => Number.isFinite(Number(entry.tax)));
      const free = Number(tax?.tax) === 0;
      const priceText = free
        ? "Avgiftsfri enligt Stockholm Parkering"
        : tax
          ? `${tax.tax} kr/${tax.timeUnit?.toLowerCase() ?? "timme"}`
          : "Pris ej rapporterat";
      const evSpaces = (facility.features?.loadingSpacesCarVisitors ?? 0) + (facility.features?.fastLoadingSpaces ?? 0);
      return [{
        id: `api-${facility.facilityNumber ?? facility.id ?? facility.name.replace(/\s+/g, "-")}`,
        name: facility.name,
        address: facility.location?.address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        area: facility.location?.areaCode || "Stockholm",
        lat,
        lng,
        kind: facility.isGarage || normalize(facility.facilityType ?? "").includes("garage") ? "garage" : "surface",
        tariff: null,
        free,
        priceText,
        note: tax
          ? `Stockholm Parkering: ${tax.active ?? "se skyltning"}, ${tax.tax} kr/${tax.timeUnit?.toLowerCase() ?? "tim"}.`
          : "Pris saknas i Stockholm Parkerings aktuella data. Kontrollera skyltningen på plats.",
        spaces: facility.features?.totalVisitorSpace || undefined,
        disabledSpaces: facility.features?.totalDisabledSpaces || undefined,
        mcSpaces: facility.features?.totalMcVisitorSpaces || undefined,
        evSpaces: evSpaces || undefined,
        source: "api",
      }];
    });
  }
  if (!Array.isArray(payload)) return [];
  return (payload as ApiFacility[]).flatMap((f): ParkingPlace[] => {
    const name = f.Namn ?? f.Name;
    if (!f.AdressLatitud || !f.AdressLongitud || !name) return [];
    const lat = Number(f.AdressLatitud);
    const lng = Number(f.AdressLongitud);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];

    const totalSpots = f.AntalBesokPlatser ?? 0;
    const kind = normalize(f.Anlaggningstyp ?? "").includes("garage") ? "garage" : "surface";
    const tax = f.BesokstaxaCollection?.find((entry) => entry.Taxa != null) ?? f.Besokstaxa;
    const free = tax?.Taxa === 0;
    const priceText = free ? "Avgiftsfri enligt Stockholm Parkering" : tax ? `${tax.Taxa} kr/${tax.Tidsenhet?.toLowerCase() ?? "timme"}` : "Pris ej rapporterat";

    return [{
      id: `api-${name.replace(/\s+/g, "-")}`,
      name,
      address: f.Adress || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      area: f.GeografisktOmrade || f.Omrade || "Stockholm",
      lat,
      lng,
      kind,
      tariff: null,
      free,
      priceText,
      note: tax
          ? `Taxa: ${tax.Galler ?? "Se skyltning"}. ${tax.Taxa} kr/${tax.Tidsenhet?.toLowerCase() ?? "tim"}.`
          : "Pris saknas i Stockholm Parkerings API. Kontrollera skyltningen på plats.",
      spaces: totalSpots > 0 ? totalSpots : undefined,
      disabledSpaces: (f.AntalBesokPlatserRorelsehindrad ?? 0) > 0 ? f.AntalBesokPlatserRorelsehindrad : undefined,
      mcSpaces: (f.AntalBesokPlatserMc ?? 0) > 0 ? f.AntalBesokPlatserMc : undefined,
      evSpaces: (f.AntalLaddplatserBesokBil ?? 0) > 0 ? f.AntalLaddplatserBesokBil : undefined,
      source: "api",
    }];
  });
}

type OcmPoi = {
  ID: number;
  AddressInfo: {
    Title?: string;
    AddressLine1?: string;
    Town?: string;
    Latitude: number;
    Longitude: number;
    AccessComments?: string;
  };
  NumberOfPoints?: number;
  UsageCost?: string;
  Connections?: Array<{
    ConnectionTypeID?: number;
    StatusTypeID?: number;
    LevelID?: number;
    PowerKW?: number;
    Quantity?: number;
    CurrentTypeID?: number;
    Amps?: number;
    Voltage?: number;
  }>;
};

const CONN_TYPE_NAMES: Record<number, string> = {
  0: "Okänd",
  1: "Type 1 (J1772)",
  2: "Type 2 (Socket)",
  25: "Type 2 (Tethered)",
  27: "Type 3A",
  28: "Type 3",
  30: "Tesla Connector",
  33: "CCS (Type 2)",
  1036: "CHAdeMO",
};

const CURRENT_TYPE_NAMES: Record<number, string> = {
  10: "AC (Enfas)",
  20: "AC (Trefas)",
  30: "DC",
};

const STATUS_NAMES: Record<number, string> = {
  50: "Operativ",
  75: "Delvis operativ",
  100: "Stängd",
};

function parseOcmParking(payload: unknown): ParkingPlace[] {
  if (!Array.isArray(payload)) return [];
  return (payload as OcmPoi[]).flatMap((p): ParkingPlace[] => {
    const addr = p.AddressInfo;
    if (!addr || !Number.isFinite(addr.Latitude) || !Number.isFinite(addr.Longitude)) return [];
    const totalPoints = p.NumberOfPoints ?? 1;
    const connections: EvConnection[] = (p.Connections ?? []).flatMap((c): EvConnection[] => {
      const qty = c.Quantity ?? 1;
      const kw = c.PowerKW ?? 0;
      if (qty < 1 || kw < 1) return [];
      return [{
        quantity: qty,
        powerKW: kw,
        type: CONN_TYPE_NAMES[c.ConnectionTypeID ?? 0] ?? "Okänd",
        status: STATUS_NAMES[c.StatusTypeID ?? 0] ?? "Okänd",
        currentType: CURRENT_TYPE_NAMES[c.CurrentTypeID ?? 0] ?? "",
        amps: c.Amps ?? 0,
        voltage: c.Voltage ?? 0,
      }];
    });
    return [{
      id: "ocm-" + p.ID,
      name: addr.Title || "Laddstation",
      address: addr.AddressLine1 || addr.Title || "",
      area: addr.Town || "Stockholm",
      lat: addr.Latitude,
      lng: addr.Longitude,
      kind: "surface",
      tariff: null,
      free: false,
      priceText: p.UsageCost || "Laddkostnad ej rapporterad",
      note: addr.AccessComments ? "Info: " + addr.AccessComments : "Laddstation från Open Charge Map. Avgift är inte verifierad.",
      evSpaces: totalPoints,
      evConnections: connections.length > 0 ? connections : undefined,
      source: "ocm",
    }];
  });
}

type OfficialFeature = {
  id?: string | number;
  type?: string;
  geometry?: { type?: string; coordinates?: unknown };
  properties?: Record<string, unknown>;
  [key: string]: unknown;
};

type OfficialRule = "pmotorcykel" | "prorelsehindrad" | "ptillaten";

function officialCoordinate(value: unknown): LatLng | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lng = Number(value[0]);
  const lat = Number(value[1]);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null;
}

function officialLinePositions(value: unknown): LatLng[] {
  if (!Array.isArray(value)) return [];
  const directLine = value.map(officialCoordinate);
  if (directLine.length >= 2 && directLine.every((position): position is LatLng => position !== null)) return directLine;

  return value
    .map(officialLinePositions)
    .sort((first, second) => second.length - first.length)[0] ?? [];
}

function lineMidpoint(positions: LatLng[]): LatLng | null {
  if (positions.length === 0) return null;
  if (positions.length === 1) return positions[0];

  const segmentLengths = positions.slice(1).map((position, index) => distanceKm(positions[index], position));
  const totalLength = segmentLengths.reduce((sum, length) => sum + length, 0);
  if (totalLength === 0) return positions[0];

  let traversed = 0;
  for (let index = 0; index < segmentLengths.length; index += 1) {
    const segmentLength = segmentLengths[index];
    if (traversed + segmentLength >= totalLength / 2) {
      const progress = (totalLength / 2 - traversed) / segmentLength;
      const start = positions[index];
      const end = positions[index + 1];
      return [start[0] + (end[0] - start[0]) * progress, start[1] + (end[1] - start[1]) * progress];
    }
    traversed += segmentLength;
  }
  return positions[positions.length - 1];
}

function isWithinArea(place: ParkingPlace, scope: AreaScope) {
  const positions = place.positions?.length ? place.positions : [[place.lat, place.lng] as LatLng];
  return positions.some((position) => distanceKm(scope.center, position) <= scope.radiusKm) || distanceKm(scope.center, [place.lat, place.lng]) <= scope.radiusKm;
}

function officialProperty(properties: Record<string, unknown>, ...names: string[]): string | undefined {
  const matchingName = Object.keys(properties).find((key) =>
    names.some((name) => key.toLowerCase() === name.toLowerCase()),
  );
  const value = matchingName ? properties[matchingName] : undefined;
  return typeof value === "string" || typeof value === "number" ? String(value).trim() || undefined : undefined;
}

function formatOfficialTime(value: string | undefined): string | undefined {
  if (!value || !/^\d{1,4}$/.test(value)) return undefined;
  const paddedValue = value.padStart(4, "0");
  const hours = Number(paddedValue.slice(0, 2));
  const minutes = Number(paddedValue.slice(2));
  if (hours > 23 || minutes > 59) return undefined;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function officialRuleDetails(properties: Record<string, unknown>): string[] {
  const maxMinutes = officialProperty(properties, "max_minutes");
  const maxHours = officialProperty(properties, "max_hours");
  const startTime = formatOfficialTime(officialProperty(properties, "start_time"));
  const endTime = formatOfficialTime(officialProperty(properties, "end_time"));
  const dayType = officialProperty(properties, "day_type");
  const startWeekday = officialProperty(properties, "start_weekday");
  const details: string[] = [];

  if (maxMinutes) details.push(`Max ${maxMinutes} min`);
  else if (maxHours) details.push(`Max ${maxHours} tim`);

  const days = [dayType, startWeekday].filter(Boolean).join(", ");
  if (startTime && endTime) details.push(`${days ? `${days} ` : ""}${startTime}–${endTime}`);
  else if (days) details.push(days);

  return details;
}

function parseOfficialRuleParking(payload: unknown, rule: OfficialRule): ParkingPlace[] {
  const container = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const features = Array.isArray(payload)
    ? payload
    : Array.isArray(container.features)
      ? container.features
      : Object.values(container).find(Array.isArray) ?? [];
  if (!Array.isArray(features)) return [];

  return (features as OfficialFeature[]).flatMap((feature, index): ParkingPlace[] => {
    const properties = feature.properties ?? feature as Record<string, unknown>;
    const geometry = feature.geometry ?? properties.geometry as OfficialFeature["geometry"];
    const positions = officialLinePositions(geometry?.coordinates ?? properties.coordinates ?? properties.koordinater);
    const point = lineMidpoint(positions);
    if (!point) return [];
    const [lat, lng] = point;
    const streetName = officialProperty(properties, "street_name", "gata", "street", "gatunamn");
    const addressValue = officialProperty(properties, "address", "adress");
    const address = addressValue && !/^<.*saknas>$/i.test(addressValue) ? addressValue : streetName;
    const citation = officialProperty(properties, "citation", "föreskrift", "foreskrift");
    let otherInfo = officialProperty(properties, "other_info", "beskrivning", "description");
    const tariff = officialProperty(properties, "parking_rate", "avgift", "taxa");
    const placeType = officialProperty(properties, "vf_plats_typ");
    const vehicle = officialProperty(properties, "vehicle", "fordon");
    const district = officialProperty(properties, "city_district", "stadsdel");
    const normalizedPlaceType = normalize(placeType ?? "");
    const normalizedVehicle = normalize(vehicle ?? "");
    const isMotorcycle = rule === "pmotorcykel" || normalizedPlaceType.includes("motorcykel") || normalizedVehicle.includes("motorcykel");
    const isDisabled = rule === "prorelsehindrad" || normalizedPlaceType.includes("rorelsehindrad") || normalizedVehicle.includes("rorelsehindrad");
    const isFree = /^avgiftsfri\b/i.test(tariff ?? "");
    const tariffMatch = normalize(tariff ?? "").match(/\btaxa\s*([1-5])\b/);
    const tariffId = tariffMatch ? Number(tariffMatch[1]) as TariffId : null;
    const restrictionDetails = officialRuleDetails(properties);
    otherInfo = [...restrictionDetails, otherInfo].filter(Boolean).join(" · ") || undefined;
    const identifier = String(feature.id ?? officialProperty(properties, "id", "objectid", "feature_object_id", "fid") ?? `${lat}-${lng}-${index}`);
    return [{
      id: `stockholm-open-data-${rule}-${identifier}`,
      name: isMotorcycle ? "MC-parkering" : isDisabled ? "Parkering för rörelsehindrade" : placeType || "Gatuparkering",
      address: address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      area: district ? `Stockholms stad · ${district}` : "Stockholms stad",
      lat,
      lng,
      positions,
      kind: "street",
      tariff: tariffId,
      free: isFree,
      priceText: tariff == null ? "Taxa ej rapporterad i föreskriften" : `Taxa enligt Stockholms stad: ${String(tariff)}`,
      note: [citation && `Föreskrift: ${citation}`, otherInfo].filter(Boolean).join(" · ") || (isMotorcycle
        ? "Endast motorcyklar enligt Stockholms stads gällande föreskrift. Kontrollera skyltning på plats."
        : isDisabled
          ? "För rörelsehindrade med tillstånd enligt Stockholms stads gällande föreskrift. Kontrollera skyltning på plats."
          : "Tillåten gatuparkering enligt Stockholms stads gällande föreskrift. Kontrollera alltid skyltning på plats."),
      disabledSpaces: isDisabled ? 1 : undefined,
      mcSpaces: isMotorcycle ? 1 : undefined,
      source: "stockholm-open-data",
    }];
  });
}

async function fetchOverpass(query: string) {
  let lastError: Error | undefined;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error(`Overpass svarade ${response.status}`);
      return response.json();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Overpass kunde inte nås");
    }
  }
  throw lastError ?? new Error("Overpass kunde inte nås");
}

function bundledDataUrls(fileName: string) {
  return Array.from(new Set([
    `${import.meta.env.BASE_URL}data/${fileName}`,
    `/data/${fileName}`,
  ]));
}

async function fetchJsonWithBundledFallback(apiUrl: string, fileName: string, init?: RequestInit) {
  try {
    const response = await fetch(apiUrl, init);
    if (response.ok && (response.headers.get("content-type") ?? "").includes("json")) return response.json();
  } catch {
    // GitHub Pages has no API proxy, so use the bundled public-data snapshot.
  }

  for (const bundledUrl of bundledDataUrls(fileName)) {
    const bundledResponse = await fetch(bundledUrl);
    if (bundledResponse.ok && (bundledResponse.headers.get("content-type") ?? "").includes("json")) {
      return bundledResponse.json();
    }
  }

  throw new Error(`Kunde inte hämta ${fileName}`);
}

type NobilStation = {
  csmd?: NobilStation;
  id?: string | number;
  active?: boolean | number | string;
  name?: string;
  address?: string;
  city?: string;
  geolocation?: string;
  chargerpointnumber?: number | string;
  usercomment?: string;
  accessibility?: string;
  parkingfee?: boolean | number | string;
  Street?: string;
  House_number?: string;
  City?: string;
  Position?: string;
  Number_charging_points?: number | string;
  Description_of_location?: string;
  User_comment?: string;
  Station_status?: number | string;
  International_id?: string;
};

function parseNobilParking(payload: unknown): ParkingPlace[] {
  const items = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object"
      ? Object.values(payload as Record<string, unknown>).find(Array.isArray) ?? []
      : [];
  if (!Array.isArray(items)) return [];

  return (items as NobilStation[]).flatMap((station): ParkingPlace[] => {
    const details = station.csmd ?? station;
    if (details.active === false || details.active === 0 || details.active === "false" || details.Station_status === 0 || details.Station_status === "0") return [];
    const coordinates = (details.geolocation ?? details.Position)?.match(/\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/);
    if (!coordinates) return [];
    const lat = Number(coordinates[1]);
    const lng = Number(coordinates[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];

    return [{
      id: `nobil-${String(details.International_id ?? details.id ?? `${lat}-${lng}`)}`,
      name: details.name || "Laddstation",
      address: details.address || [details.Street, details.House_number].filter(Boolean).join(" ") || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      area: details.city || details.City || "Stockholm",
      lat,
      lng,
      kind: "surface",
      tariff: null,
      free: false,
      priceText: "Laddkostnad ej rapporterad",
      note: [details.accessibility, details.usercomment, details.Description_of_location, details.User_comment].filter(Boolean).join(". ") || "Laddstation från NOBIL. Avgift är inte verifierad.",
      evSpaces: Number(details.chargerpointnumber ?? details.Number_charging_points) > 0 ? Number(details.chargerpointnumber ?? details.Number_charging_points) : 1,
      source: "nobil",
    }];
  });
}

function categoryLabel(category: Category) {
  if (typeof category === "number") return `Taxa ${category}`;
  if (category === "garage") return "Garage";
  if (category === "street") return "Gatuparkering";
  if (category === "free") return "Gratis";
  if (category === "disabled") return "Handikapp";
  if (category === "ev") return "Elbil";
  if (category === "mc") return "MC";
  return "Alla parkeringar";
}

function replaceSource(places: ParkingPlace[], source: ParkingPlace["source"], incoming: ParkingPlace[]) {
  return [...places.filter((place) => place.source !== source), ...incoming];
}

function mergePlacesById(places: ParkingPlace[], incoming: ParkingPlace[]) {
  const merged = new Map(places.map((place) => [place.id, place]));
  incoming.forEach((place) => merged.set(place.id, place));
  return [...merged.values()];
}

function replaceOfficialRules(places: ParkingPlace[], rules: OfficialRule[], incoming: ParkingPlace[]) {
  const prefixes = rules.map((rule) => `stockholm-open-data-${rule}-`);
  return [...places.filter((place) => !prefixes.some((prefix) => place.id.startsWith(prefix))), ...incoming];
}

function parkingRecordScore(place: ParkingPlace) {
  const sourceScore = place.source === "api" ? 5 : place.source === "local" ? 4 : place.source === "ocm" ? 3 : place.source === "nobil" ? 2 : 1;
  const priceScore = /ej verifierat|ej rapporterat|saknas/i.test(place.priceText) ? 0 : 3;
  const addressScore = /^[-\d.]+,\s*[-\d.]+$/.test(place.address) || normalize(place.address) === normalize(place.name) ? 0 : 2;
  return sourceScore + priceScore + addressScore + (place.spaces ? 1 : 0);
}

function mergeDuplicateParking(first: ParkingPlace, second: ParkingPlace): ParkingPlace {
  const preferred = parkingRecordScore(second) > parkingRecordScore(first) ? second : first;
  const other = preferred === first ? second : first;
  return {
    ...other,
    ...preferred,
    spaces: Math.max(first.spaces ?? 0, second.spaces ?? 0) || undefined,
    disabledSpaces: Math.max(first.disabledSpaces ?? 0, second.disabledSpaces ?? 0) || undefined,
    mcSpaces: Math.max(first.mcSpaces ?? 0, second.mcSpaces ?? 0) || undefined,
    evSpaces: Math.max(first.evSpaces ?? 0, second.evSpaces ?? 0) || undefined,
    evConnections: (preferred.evConnections?.length ?? 0) >= (other.evConnections?.length ?? 0) ? preferred.evConnections : other.evConnections,
  };
}

function dedupeDisplayParking(places: ParkingPlace[], category: Category) {
  if (!(["all", "garage", "ev"] as Category[]).includes(category)) return places;
  const result: ParkingPlace[] = [];
  const groupedIndexes = new Map<string, number>();

  places.forEach((place) => {
    let key: string | null = null;
    if (place.kind === "garage" || category === "garage") {
      const baseName = normalize(place.name)
        .replace(/\b(p[- ]?hus|parkeringshus|parkeringsgarage|garage|parkering|entre|norr|soder|oster|vaster|norra|sodra|ostra|vastra)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      key = `garage:${baseName.length > 3 ? baseName : `${place.lat.toFixed(3)}:${place.lng.toFixed(3)}`}`;
    } else if ((place.evSpaces ?? 0) > 0) {
      key = `ev:${place.lat.toFixed(4)}:${place.lng.toFixed(4)}`;
    }

    if (!key) {
      result.push(place);
      return;
    }
    const existingIndex = groupedIndexes.get(key);
    if (existingIndex == null) {
      groupedIndexes.set(key, result.length);
      result.push(place);
      return;
    }
    result[existingIndex] = mergeDuplicateParking(result[existingIndex], place);
  });

  return result;
}

function addNearbyStreetAddresses(places: ParkingPlace[]): ParkingPlace[] {
  const streetRules = places.filter((place) => place.source === "stockholm-open-data" && place.kind === "street" && !/^[-\d.]+,\s*[-\d.]+$/.test(place.address));
  if (streetRules.length === 0) return places;

  let changed = false;
  const enriched = places.map((place) => {
    if (place.source !== "osm" || !/^[-\d.]+,\s*[-\d.]+$/.test(place.address)) return place;
    const nearestStreet = streetRules.reduce<ParkingPlace | undefined>((closest, street) => {
      if (!closest) return street;
      return distanceKm([place.lat, place.lng], [street.lat, street.lng]) < distanceKm([place.lat, place.lng], [closest.lat, closest.lng])
        ? street
        : closest;
    }, undefined);
    if (!nearestStreet || distanceKm([place.lat, place.lng], [nearestStreet.lat, nearestStreet.lng]) > 0.08) return place;
    changed = true;
    return {
      ...place,
      address: `Nära ${nearestStreet.address}`,
      area: nearestStreet.area,
    };
  });

  return changed ? enriched : places;
}

function App() {
  const mapNodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const parkingLayerRef = useRef<LayerGroup | null>(null);
  const streetRuleLayerRef = useRef<LayerGroup | null>(null);
  const locationLayerRef = useRef<LayerGroup | null>(null);
  const searchMarkerLayerRef = useRef<LayerGroup | null>(null);
  const routeLayerRef = useRef<LayerGroup | null>(null);
  const clickLayerRef = useRef<LayerGroup | null>(null);
  const parkedCarLayerRef = useRef<LayerGroup | null>(null);
  const lastGeocodeRef = useRef(0);
  const lastMcFitCountRef = useRef(0);
  const routeInfoRef = useRef<RouteInfo | null>(null);
  const lastRerouteRef = useRef(0);
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const installActionRef = useRef<HTMLButtonElement>(null);
  const loadedGlobalRulesRef = useRef(new Set<OfficialRule>());
  const globalRuleCountsRef = useRef(new Map<OfficialRule, number>());
  const loadedGlobalOsmRef = useRef(new Set<"garage" | "free">());

  const [allParking, setAllParking] = useState<ParkingPlace[]>(LOCAL_PARKING);
  const [category, setCategory] = useState<Category>("all");
  const [query, setQuery] = useState("");
  const [searchLocations, setSearchLocations] = useState<SearchLocation[]>([]);
  const [searching, setSearching] = useState(false);
  const [areaLoading, setAreaLoading] = useState(false);
  const [selectedParking, setSelectedParking] = useState<ParkingPlace | null>(null);
  const [selectedZone, setSelectedZone] = useState<TariffId | null>(null);
  const [userPosition, setUserPosition] = useState<LatLng | null>(null);
  const [searchPosition, setSearchPosition] = useState<LatLng | null>(null);
  const [areaScope, setAreaScope] = useState<AreaScope | null>(null);
  const [limitToArea, setLimitToArea] = useState(false);
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
  const [offlineDialogOpen, setOfflineDialogOpen] = useState(false);
  const [offlineProgress, setOfflineProgress] = useState<{ cached: number; total: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [pwaInstallOpen, setPwaInstallOpen] = useState(false);
  const [installPlatform, setInstallPlatform] = useState<InstallPlatform | null>(null);
  const [manualInstallHelp, setManualInstallHelp] = useState(false);
  const [favorites, setFavorites] = useState<ParkingPlace[]>(() => readLocalStorage(FAVORITES_STORAGE_KEY, []));
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [parkedCar, setParkedCar] = useState<ParkedCar | null>(() => readLocalStorage(PARKED_CAR_STORAGE_KEY, null));
  const [parkedCarOpen, setParkedCarOpen] = useState(false);
  const [parkedCarEditing, setParkedCarEditing] = useState(false);
  const [parkedCarNote, setParkedCarNote] = useState("");
  const [parkedCarSpot, setParkedCarSpot] = useState("");
  const [vehicleProfile, setVehicleProfile] = useState<VehicleProfile>(() => readLocalStorage(VEHICLE_PROFILE_STORAGE_KEY, "car"));
  const [vehicleProfileDraft, setVehicleProfileDraft] = useState<VehicleProfile>(() => readLocalStorage(VEHICLE_PROFILE_STORAGE_KEY, "car"));
  const [vehicleProfileOpen, setVehicleProfileOpen] = useState(false);

  // Nya states för Dark Mode, Kartklick och Sökförslag
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("parksthlm-dark") === "true");
  const [clickedPosition, setClickedPosition] = useState<LatLng | null>(null);
  const [clickedAddress, setClickedAddress] = useState<string | null>(null);
  const [clickedLoading, setClickedLoading] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);

  useEffect(() => {
    routeInfoRef.current = routeInfo;
  }, [routeInfo]);

  useEffect(() => {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    if (parkedCar) localStorage.setItem(PARKED_CAR_STORAGE_KEY, JSON.stringify(parkedCar));
    else localStorage.removeItem(PARKED_CAR_STORAGE_KEY);
  }, [parkedCar]);

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
    return {
      id: "clicked-pos",
      name: clickedAddress || "Vald kartposition",
      address: clickedAddress ? `${clickedPosition[0].toFixed(5)}, ${clickedPosition[1].toFixed(5)}` : "Position på kartan",
      area: "Stockholm",
      lat: clickedPosition[0],
      lng: clickedPosition[1],
      kind: "street",
      tariff: null,
      free: false,
      priceText: "Pris ej verifierat",
      note: "Kartposition utan verifierad parkeringstaxa. Kontrollera alltid skyltar och betalningsapp på plats.",
      source: "local"
    };
  }, [clickedPosition, clickedAddress]);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 3600);
  }, []);

  const fetchNearbyOsmParking = useCallback(async (scope: AreaScope) => {
    if (!navigator.onLine) return;
    const [lat, lng] = scope.center;
    const around = `around:${Math.round(scope.radiusKm * 1000)},${lat},${lng}`;
    const query = `[out:json][timeout:55];(nwr["amenity"="parking"](${around});nwr["amenity"="parking_entrance"](${around});nwr["amenity"="parking_space"](${around});nwr["amenity"="charging_station"](${around}););out center tags;`;
    const payload = await fetchOverpass(query);
    const byId = new Map<string, ParkingPlace>();
    parseOsmParking(payload).forEach((place) => byId.set(place.id, place));
    setAllParking((previous) => mergePlacesById(previous, [...byId.values()]));
  }, []);

  const fetchGlobalOsmParking = useCallback(async (dataset: "garage" | "free") => {
    if (!navigator.onLine) return 0;
    if (loadedGlobalOsmRef.current.has(dataset)) return 0;
    const cacheKey = `parksthlm-osm-${dataset}-stockholm-v2`;
    const cachedRaw = localStorage.getItem(cacheKey);
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw) as { timestamp: number; places: ParkingPlace[] };
        if (Array.isArray(cached.places) && Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
          setAllParking((previous) => mergePlacesById(previous, cached.places));
          loadedGlobalOsmRef.current.add(dataset);
          return cached.places.length;
        }
      } catch {
        localStorage.removeItem(cacheKey);
      }
    }

    const query = dataset === "garage"
      ? `[out:json][timeout:120];(nwr["amenity"="parking"]["parking"~"underground|multi-storey|garage"](${STOCKHOLM_DATA_BBOX});nwr["amenity"="parking"]["building"="parking"](${STOCKHOLM_DATA_BBOX});nwr["amenity"="parking_entrance"]["parking"~"underground|multi-storey|garage"](${STOCKHOLM_DATA_BBOX});nwr["amenity"="parking"]["fee"="yes"]["name"](${STOCKHOLM_DATA_BBOX});nwr["amenity"="parking"]["fee"="yes"]["operator"](${STOCKHOLM_DATA_BBOX}););out center tags;`
      : `[out:json][timeout:120];nwr["amenity"="parking"]["fee"="no"](${STOCKHOLM_DATA_BBOX});out center tags;`;
    const payload = await fetchOverpass(query);
    const sourceElements = payload && typeof payload === "object" && "elements" in payload
      ? (payload as { elements?: Array<Record<string, unknown>> }).elements ?? []
      : [];
    const publicPayload = dataset === "garage"
      ? {
          elements: sourceElements.filter((element) => {
            const tags = (element.tags ?? {}) as Record<string, string>;
            return ["yes", "customers", "permissive", "destination"].includes(tags.access) || ["yes", "no"].includes(tags.fee);
          }),
        }
      : payload;
    const places = parseOsmParking(publicPayload).filter((place) => dataset === "garage"
      ? place.kind === "garage" || (place.kind === "surface" && place.name !== "Parkering" && place.priceText === "Avgift enligt OpenStreetMap")
      : place.free);
    setAllParking((previous) => mergePlacesById(previous, places));
    loadedGlobalOsmRef.current.add(dataset);
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ timestamp: Date.now(), places }));
    } catch {
      localStorage.removeItem(cacheKey);
    }
    return places.length;
  }, []);

  const fetchApiParking = useCallback(async (force = false) => {
    const CACHE_KEY = "parksthlm-api-v4";
    const cachedRaw = localStorage.getItem(CACHE_KEY);
    if (cachedRaw && !force) {
      try {
        const cached = JSON.parse(cachedRaw) as { timestamp: number; places: ParkingPlace[]; version?: number };
        if (cached.version !== 4) throw new Error("cache-version");
        if (Array.isArray(cached.places)) setAllParking((prev) => replaceSource(prev, "api", cached.places));
        if (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000 || !navigator.onLine) return;
      } catch {
        localStorage.removeItem(CACHE_KEY);
      }
    }
    if (!navigator.onLine) return;
    try {
      const payload = await fetchJsonWithBundledFallback("/api/stockholm-parking", "stockholm-parking.json");
      const places = parseApiParking(payload);
      setAllParking((prev) => replaceSource(prev, "api", places));
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), version: 4, places }));
      } catch {
        localStorage.removeItem(CACHE_KEY);
      }
      if (force) showNotice(places.length + " infartsparkeringar uppdaterades");
    } catch {
      if (force) showNotice("Infartsparkeringar kunde inte nås. Sparad data används.");
    }
  }, [showNotice]);

  const fetchOfficialRuleParking = useCallback(async (rules: OfficialRule[], scope: AreaScope) => {
    if (!navigator.onLine) return;
    const radiusMeters = Math.round(scope.radiusKm * 1000);
    const scopeKey = `${scope.center[0].toFixed(3)}-${scope.center[1].toFixed(3)}-${radiusMeters}`;
    const results = await Promise.all(rules.map(async (rule): Promise<ParkingPlace[]> => {
      const cacheKey = `parksthlm-stockholm-open-data-${rule}-${scopeKey}`;
      const cachedRaw = localStorage.getItem(cacheKey);
      if (cachedRaw) {
        try {
          const cached = JSON.parse(cachedRaw) as { timestamp: number; places: ParkingPlace[]; version?: number };
          if (cached.version === 2 && Array.isArray(cached.places) && Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
            return cached.places;
          }
        } catch {
          localStorage.removeItem(cacheKey);
        }
      }
      try {
        const params = new URLSearchParams({
          lat: String(scope.center[0]),
          lng: String(scope.center[1]),
          radius: String(radiusMeters),
        });
        const payload = await fetchJsonWithBundledFallback(
          `/api/stockholm-open-data/${rule}?${params}`,
          `${rule}.json`,
        );
        const places = parseOfficialRuleParking(payload, rule).filter((place) => isWithinArea(place, scope));
        localStorage.setItem(cacheKey, JSON.stringify({ timestamp: Date.now(), version: 2, places }));
        return places;
      } catch {
        return [];
      }
    }));
    setAllParking((previous) => mergePlacesById(previous, results.flat()));
  }, []);

  const fetchAllOfficialRuleParking = useCallback(async (rules: OfficialRule[]) => {
    const missingRules = rules.filter((rule) => !loadedGlobalRulesRef.current.has(rule));
    if (missingRules.length === 0) return rules.reduce((sum, rule) => sum + (globalRuleCountsRef.current.get(rule) ?? 0), 0);
    const results = await Promise.all(missingRules.map(async (rule) => {
      const cacheKey = `parksthlm-stockholm-open-data-${rule}-all-v2`;
      const cachedRaw = localStorage.getItem(cacheKey);
      if (cachedRaw) {
        try {
          const cached = JSON.parse(cachedRaw) as { timestamp: number; places: ParkingPlace[] };
          if (Array.isArray(cached.places) && Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
            loadedGlobalRulesRef.current.add(rule);
            globalRuleCountsRef.current.set(rule, cached.places.length);
            return cached.places;
          }
        } catch {
          localStorage.removeItem(cacheKey);
        }
      }

      const payload = await fetchJsonWithBundledFallback(
        `/api/stockholm-open-data/${rule}?all=true`,
        `${rule}.json`,
      );
      const places = parseOfficialRuleParking(payload, rule);
      loadedGlobalRulesRef.current.add(rule);
      globalRuleCountsRef.current.set(rule, places.length);
      try {
        localStorage.setItem(cacheKey, JSON.stringify({ timestamp: Date.now(), places }));
      } catch {
        localStorage.removeItem(cacheKey);
      }
      return places;
    }));
    const places = results.flat();
    setAllParking((previous) => replaceOfficialRules(previous, missingRules, places));
    return rules.reduce((sum, rule) => sum + (globalRuleCountsRef.current.get(rule) ?? 0), 0);
  }, []);

  const fetchEvCharging = useCallback(async () => {
    if (!navigator.onLine) return;
    const key = "parksthlm-ev-v3";
    const cachedRaw = localStorage.getItem(key);
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw) as { timestamp: number; places: ParkingPlace[]; version?: number };
        if (cached.version === 2 && Array.isArray(cached.places)) {
          setAllParking((prev) => replaceSource(prev, "osm-ev", cached.places));
          if (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) return;
        }
      } catch { localStorage.removeItem(key); }
    }
    try {
      const q = `[out:json][timeout:120];nwr["amenity"="charging_station"](${STOCKHOLM_DATA_BBOX});out center tags;`;
      const res = await fetch(OVERPASS_ENDPOINT + "?data=" + encodeURIComponent(q));
      if (!res.ok) return;
      const places = parseOsmParking(await res.json())
        .filter((place) => (place.evSpaces ?? 0) > 0)
        .map((place): ParkingPlace => ({ ...place, source: "osm-ev" }));
      try {
        localStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), version: 2, places }));
      } catch {
        localStorage.removeItem(key);
      }
      setAllParking((prev) => replaceSource(prev, "osm-ev", places));
    } catch { /* silent */ }
  }, []);

  const fetchOcmCharging = useCallback(async () => {
    if (!navigator.onLine) return;
    const key = "parksthlm-ocm-v2";
    const cachedRaw = localStorage.getItem(key);
    let ocmPlaces: ParkingPlace[] | null = null;
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw) as { timestamp: number; places: ParkingPlace[]; version?: number };
        if (cached.version === 3 && Array.isArray(cached.places)) {
          ocmPlaces = cached.places;
          setAllParking((prev) => {
            const injected = prev.map((p) => {
              if ((p.evSpaces ?? 0) === 0 || (p.evConnections ?? []).length > 0) return p;
              const match = ocmPlaces!.find((o) => (o.evConnections ?? []).length > 0 && distanceKm([p.lat, p.lng], [o.lat, o.lng]) < 0.05);
              return match ? { ...p, evConnections: match.evConnections } : p;
            });
            const ocmIds = new Set(prev.map((p) => p.id));
            return [...injected, ...ocmPlaces!.filter((o) => !ocmIds.has(o.id))];
          });
          if (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) return;
        }
      } catch { localStorage.removeItem(key); }
    }
    try {
      const payload = await fetchJsonWithBundledFallback("/api/open-charge-map", "open-charge-map.json");
      ocmPlaces = parseOcmParking(payload);
      setAllParking((prev) => {
        const injected = prev.map((p) => {
          if ((p.evSpaces ?? 0) === 0 || (p.evConnections ?? []).length > 0) return p;
          const match = ocmPlaces!.find((o) => (o.evConnections ?? []).length > 0 && distanceKm([p.lat, p.lng], [o.lat, o.lng]) < 0.05);
          return match ? { ...p, evConnections: match.evConnections } : p;
        });
        const ocmIds = new Set(prev.map((p) => p.id));
        return [...injected, ...ocmPlaces!.filter((o) => !ocmIds.has(o.id))];
      });
      try {
        localStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), version: 3, places: ocmPlaces }));
      } catch {
        localStorage.removeItem(key);
      }
    } catch { /* silent */ }
  }, []);

  const fetchNobilCharging = useCallback(async () => {
    if (!navigator.onLine) return;
    const key = "parksthlm-nobil-v2";
    const cachedRaw = localStorage.getItem(key);
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw) as { timestamp: number; places: ParkingPlace[]; version?: number };
        if (cached.version === 2 && Array.isArray(cached.places)) {
          setAllParking((prev) => replaceSource(prev, "nobil", cached.places));
          if (Date.now() - cached.timestamp < 60 * 60 * 1000) return;
        }
      } catch {
        localStorage.removeItem(key);
      }
    }

    try {
      const payload = await fetchJsonWithBundledFallback("/api/nobil", "nobil.json", { method: "POST" });
      const places = parseNobilParking(payload);
      setAllParking((prev) => replaceSource(prev, "nobil", places));
      try {
        localStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), version: 2, places }));
      } catch {
        localStorage.removeItem(key);
      }
    } catch {
      // Cached NOBIL data is retained if the provider cannot be reached.
    }
  }, []);

  useEffect(() => {
    void fetchApiParking();
  }, [fetchApiParking]);

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      void fetchApiParking();
    };
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [fetchApiParking]);

  useEffect(() => {
    const isStandaloneMode = window.matchMedia("(display-mode: standalone)").matches ||
                          (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    setIsStandalone(isStandaloneMode);

    const shouldOfferInstall = isMobileDevice() && !isStandaloneMode && !hasRecentPwaInstallDismissal();
    const openInstallPrompt = () => {
      setCanInstall(true);
      setInstallPlatform(isIosDevice() ? "ios" : "android");
      setManualInstallHelp(false);
      setPwaInstallOpen(true);
    };
    let promptFallbackTimer: number | undefined;
    if (shouldOfferInstall) {
      openInstallPrompt();
    }

    // Check if inline script already captured the event before React mounted
    if ((window as any).__ipp) {
      deferredPromptRef.current = (window as any).__ipp as BeforeInstallPromptEvent;
      setCanInstall(true);
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      deferredPromptRef.current = e as BeforeInstallPromptEvent;
      setCanInstall(true);
      setManualInstallHelp(false);
      if (shouldOfferInstall) openInstallPrompt();
    };

    const handleAppInstalled = () => {
      deferredPromptRef.current = null;
      setCanInstall(false);
      setIsStandalone(true);
      setPwaInstallOpen(false);
      showNotice("Appen installerad!");
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    if (shouldOfferInstall) {
      promptFallbackTimer = window.setTimeout(() => {
        if (deferredPromptRef.current || isStandaloneMode || hasRecentPwaInstallDismissal()) return;
        openInstallPrompt();
      }, 1200);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
      if (promptFallbackTimer) window.clearTimeout(promptFallbackTimer);
    };
  }, []);

  useEffect(() => {
    if (!pwaInstallOpen) return;

    const focusInstallAction = window.requestAnimationFrame(() => installActionRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismissPwaInstall();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusInstallAction);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [pwaInstallOpen]);

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
    map.createPane("parkedCar");
    map.getPane("parkedCar")!.style.zIndex = "680";
    map.createPane("charging");
    map.getPane("charging")!.style.zIndex = "470";
    map.createPane("officialStreetRules");
    map.getPane("officialStreetRules")!.style.zIndex = "420";
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
    streetRuleLayerRef.current = L.layerGroup().addTo(map);
    locationLayerRef.current = L.layerGroup().addTo(map);
    searchMarkerLayerRef.current = L.layerGroup().addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);
    clickLayerRef.current = L.layerGroup().addTo(map);
    parkedCarLayerRef.current = L.layerGroup().addTo(map);

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
      streetRuleLayerRef.current = null;
      locationLayerRef.current = null;
      searchMarkerLayerRef.current = null;
      routeLayerRef.current = null;
      clickLayerRef.current = null;
      parkedCarLayerRef.current = null;
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

  useEffect(() => {
    const layer = searchMarkerLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!searchPosition) return;
    const icon = L.divIcon({
      className: "search-marker-wrap",
      html: '<div class="search-marker" aria-label="Sökt adress"></div>',
      iconSize: [34, 44],
      iconAnchor: [17, 42],
    });
    L.marker(searchPosition, { pane: "parking", icon, title: "Sökt adress" }).addTo(layer);
  }, [searchPosition]);

  useEffect(() => {
    const layer = parkedCarLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!parkedCar) return;
    L.marker([parkedCar.lat, parkedCar.lng], {
      pane: "parkedCar",
      icon: parkedCarIcon(),
      keyboard: true,
      title: "Min parkerade bil",
    })
      .on("click", (event) => {
        L.DomEvent.stopPropagation(event);
        setParkedCarOpen(true);
      })
      .addTo(layer);
  }, [parkedCar]);

  const matchesCategory = useCallback((place: ParkingPlace) => {
    if (category === "all") return true;
    if (category === "free") return place.free && (place.evSpaces ?? 0) === 0;
    if (category === "garage") return place.kind === "garage" || (place.kind === "surface" && place.name !== "Parkering" && (place.evSpaces ?? 0) === 0 && !place.free && place.priceText !== "Pris ej verifierat");
    if (category === "street") return place.kind === "street" || place.kind === "surface";
    if (category === "disabled") return (place.disabledSpaces ?? 0) > 0;
    if (category === "ev") return (place.evSpaces ?? 0) > 0;
    if (category === "mc") return (place.mcSpaces ?? 0) > 0;
    return place.tariff === category;
  }, [category]);

  const focusPosition = userPosition || searchPosition || viewCenter;
  const hasOfficialStreetData = allParking.some((place) => place.id.startsWith("stockholm-open-data-ptillaten-"));
  const filteredParking = useMemo(
    () => dedupeDisplayParking(
      allParking.filter((place) =>
        !(hasOfficialStreetData && place.source === "local" && place.kind === "street")
        && (!limitToArea || !areaScope || isWithinArea(place, areaScope))
        && matchesCategory(place),
      ),
      category,
    ),
    [allParking, areaScope, category, hasOfficialStreetData, limitToArea, matchesCategory],
  );
  const selectedParkingTariff = selectedParking && isTariffId(selectedParking.tariff) ? selectedParking.tariff : null;

  const loadParkingAround = useCallback(async (nextCategory: Category = category, requestedScope?: AreaScope) => {
    if (!online) {
      showNotice("Områdessökning kräver internet. Sparad data kan fortfarande visas.");
      return;
    }

    if (typeof nextCategory !== "number") {
      setAreaLoading(true);
      try {
        let count = 0;
        if (nextCategory === "garage") {
          count = await fetchGlobalOsmParking("garage");
          void fetchApiParking();
        } else if (nextCategory === "free") {
          const counts = await Promise.all([fetchGlobalOsmParking("free"), fetchAllOfficialRuleParking(["ptillaten"])]);
          count = counts.reduce((sum, value) => sum + value, 0);
        } else if (nextCategory === "disabled") {
          count = await fetchAllOfficialRuleParking(["prorelsehindrad"]);
        } else if (nextCategory === "mc") {
          count = await fetchAllOfficialRuleParking(["pmotorcykel"]);
        } else if (nextCategory === "ev") {
          await Promise.all([fetchEvCharging(), fetchOcmCharging(), fetchNobilCharging()]);
        } else if (nextCategory === "street") {
          count = await fetchAllOfficialRuleParking(["ptillaten"]);
        } else {
          const counts = await Promise.all([
            fetchGlobalOsmParking("garage"),
            fetchGlobalOsmParking("free"),
            fetchAllOfficialRuleParking(["ptillaten", "prorelsehindrad", "pmotorcykel"]),
            Promise.all([fetchEvCharging(), fetchOcmCharging(), fetchNobilCharging()]).then(() => 0),
          ]);
          count = counts.reduce((sum, value) => sum + value, 0);
          void fetchApiParking();
        }
        showNotice(count > 0
          ? `${count} källposter hämtades för ${categoryLabel(nextCategory).toLowerCase()} i Stockholmsområdet`
          : `${categoryLabel(nextCategory)} är uppdaterat för hela Stockholmsområdet`);
      } catch {
        showNotice(`All data för ${categoryLabel(nextCategory).toLowerCase()} kunde inte hämtas just nu. Sparad data visas.`);
      } finally {
        setAreaLoading(false);
      }
      return;
    }

    const scope = requestedScope ?? areaScope ?? {
      center: focusPosition,
      label: userPosition ? "din position" : "kartans område",
      radiusKm: AREA_SEARCH_RADIUS_KM,
    };
    setAreaScope(scope);
    setAreaLoading(true);

    try {
      await fetchNearbyOsmParking(scope);
      showNotice(`Visar ${categoryLabel(nextCategory).toLowerCase()} inom ${Math.round(scope.radiusKm * 1000)} m från ${scope.label}`);
    } catch {
      showNotice("Kunde inte hämta all områdesdata just nu. Försök igen.");
    } finally {
      setAreaLoading(false);
    }
  }, [areaScope, category, fetchAllOfficialRuleParking, fetchApiParking, fetchEvCharging, fetchGlobalOsmParking, fetchNearbyOsmParking, fetchNobilCharging, fetchOcmCharging, focusPosition, online, showNotice, userPosition]);

  const loadCurrentMapView = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    const center = map.getCenter();
    const bounds = map.getBounds();
    const radiusKm = distanceKm([center.lat, center.lng], [bounds.getNorth(), bounds.getEast()]);
    if (radiusKm > 5) {
      showNotice("Zooma in mer för att hämta exakt parkeringsdata i kartvyn.");
      return;
    }
    const scope: AreaScope = {
      center: [center.lat, center.lng],
      label: "aktuell kartvy",
      radiusKm: Math.min(5, Math.max(AREA_SEARCH_RADIUS_KM, radiusKm)),
    };
    setAreaScope(scope);
    setLimitToArea(true);
    setAreaLoading(true);
    const officialRules: OfficialRule[] = category === "mc"
      ? ["pmotorcykel"]
      : category === "disabled"
        ? ["prorelsehindrad"]
        : category === "all" || category === "street" || category === "free" || typeof category === "number"
          ? ["ptillaten"]
          : [];
    try {
      await Promise.all([
        fetchNearbyOsmParking(scope),
        officialRules.length > 0 ? fetchOfficialRuleParking(officialRules, scope) : Promise.resolve(),
        category === "ev" ? Promise.all([fetchEvCharging(), fetchOcmCharging(), fetchNobilCharging()]) : Promise.resolve(),
      ]);
      showNotice(`Visar ${categoryLabel(category).toLowerCase()} i aktuell kartvy`);
    } catch {
      showNotice("All parkeringsdata i kartvyn kunde inte hämtas. Sparad data visas.");
    } finally {
      setAreaLoading(false);
    }
  }, [category, fetchEvCharging, fetchNearbyOsmParking, fetchNobilCharging, fetchOcmCharging, fetchOfficialRuleParking, showNotice]);

  useEffect(() => {
    setAllParking((current) => addNearbyStreetAddresses(current));
  }, [allParking]);

  useEffect(() => {
    if (category !== "mc") {
      lastMcFitCountRef.current = 0;
      return;
    }

    const map = mapRef.current;
    const motorcyclePlaces = filteredParking.filter((place) => (place.mcSpaces ?? 0) > 0);
    if (!map || motorcyclePlaces.length < 2 || motorcyclePlaces.length <= lastMcFitCountRef.current) return;

    lastMcFitCountRef.current = motorcyclePlaces.length;
    map.fitBounds(L.latLngBounds(motorcyclePlaces.map((place) => [place.lat, place.lng])), {
      padding: [52, 52],
      maxZoom: 11,
      animate: true,
    });
  }, [category, filteredParking]);

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
    const layer = streetRuleLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!areaScope || !limitToArea) return;

    filteredParking
      .filter((place) => place.source === "stockholm-open-data" && (place.positions?.length ?? 0) >= 2)
      .forEach((place) => {
        const color = placeColor(place);
        L.polyline(place.positions!, {
          pane: "officialStreetRules",
          color: "#ffffff",
          weight: (place.disabledSpaces ?? 0) > 0 ? 8 : 7,
          opacity: 0.9,
          interactive: false,
        }).addTo(layer);
        L.polyline(place.positions!, {
          pane: "officialStreetRules",
          color,
          weight: (place.disabledSpaces ?? 0) > 0 ? 4.8 : 3.6,
          opacity: 0.92,
          interactive: true,
        })
          .bindTooltip(`${place.address} · ${placeTariffLabel(place)}`, { sticky: true, className: "street-tooltip" })
          .on("click", (event) => {
            L.DomEvent.stopPropagation(event);
            setSelectedZone(null);
            setClickedPosition(null);
            setSelectedParking(place);
          })
          .addTo(layer);
      });
  }, [areaScope, filteredParking, limitToArea]);

  useEffect(() => {
    const layer = parkingLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    const visibleBounds = mapRef.current?.getBounds().pad(0.12);
    const placesInView = visibleBounds
      ? filteredParking.filter((place) => visibleBounds.contains([place.lat, place.lng]))
      : filteredParking;
    const markerPlaces = mapZoom < 12
      ? placesInView.filter((place) => place.source === "local" || place.kind === "garage" || (place.disabledSpaces ?? 0) > 0 || (place.evSpaces ?? 0) > 0 || (place.mcSpaces ?? 0) > 0)
      : placesInView;
    markerPlaces.forEach((place) => {
      L.marker([place.lat, place.lng], {
        pane: (place.evSpaces ?? 0) > 0 && (place.disabledSpaces ?? 0) === 0 && (place.mcSpaces ?? 0) === 0 ? "charging" : "parking",
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
  }, [filteredParking, mapZoom, selectedParking, viewCenter]);

  const selectCategory = (next: Category, fit = false) => {
    setCategory(next);
    setLimitToArea(false);
    setSelectedParking(null);
    setClickedPosition(null);
    setSearchLocations([]);
    setSearchFocused(false);
    setPanelOpen(true);
    if (typeof next !== "number") {
      setQuery("");
      void loadParkingAround(next);
    } else {
      setQuery("");
      setAreaLoading(true);
      void fetchAllOfficialRuleParking(["ptillaten"])
        .catch(() => showNotice("Taxeregler kunde inte uppdateras. Sparad data visas."))
        .finally(() => setAreaLoading(false));
    }
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
    if (["handikapp", "handikapparkering", "disabled", "rörelsehindrad"].includes(normalize(value))) {
      selectCategory("disabled");
      setQuery("");
      return;
    }
    if (["elbil", "laddplats", "el", "ladda", "ev"].includes(normalize(value))) {
      selectCategory("ev");
      setQuery("");
      return;
    }
    if (["mc", "motorcykel", "mc parkering", "motorcykelparkering"].includes(normalize(value))) {
      selectCategory("mc");
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
        addressdetails: "1",
        "accept-language": "sv",
        bounded: "1",
        viewbox: "17.75,59.48,18.35,59.15",
      });
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("Sökningen misslyckades");
      const result = (await response.json()) as Array<{
        display_name: string;
        lat: string;
        lon: string;
        type: string;
        address?: {
          postcode?: string;
          city?: string;
          town?: string;
          village?: string;
          municipality?: string;
          city_district?: string;
          suburb?: string;
        };
      }>;
      const hasHouseNum = /^\s*.+\s+\d+\s*$/.test(value);
      const seen = new Set<string>();
      setSearchLocations(result.flatMap((item) => {
        const raw = item.display_name.replace(/, Sverige$/, "");
        const parts = raw.split(",").map((s) => s.trim());
        const address = item.address;
        const locality = (/^164\s?\d\d/.test(address?.postcode ?? "") ? "Kista" : undefined)
          || address?.town || address?.village || address?.city
          || address?.city_district || address?.suburb || address?.municipality
          || parts.slice(1, 3).join(", ");
        const name = hasHouseNum ? value + ", " + locality : raw;
        const key = name.toLowerCase();
        if (seen.has(key)) return [];
        seen.add(key);
        return [{ name, lat: Number(item.lat), lng: Number(item.lon), type: item.type }];
      }));
      if (result.length === 0) {
        showNotice("Ingen adress hittades i Stockholm");
      }
    } catch {
      showNotice("Adressökningen kunde inte nås just nu");
    } finally {
      setSearching(false);
    }
  };

  const chooseSearchLocation = async (location: SearchLocation) => {
    const position: LatLng = [location.lat, location.lng];
    const scope: AreaScope = { center: position, label: location.name.split(",")[0], radiusKm: AREA_SEARCH_RADIUS_KM };
    setSearchPosition(position);
    setAreaScope(scope);
    setLimitToArea(true);
    setClickedPosition(null);
    setSearchFocused(false);
    setQuery("");
    setSearchLocations([]);
    mapRef.current?.flyTo(position, 16, { duration: 1.2 });
    setAreaLoading(true);
    try {
      await Promise.all([
        fetchNearbyOsmParking(scope),
        fetchOfficialRuleParking(["ptillaten", "prorelsehindrad", "pmotorcykel"], scope),
        fetchApiParking(),
      ]);
      showNotice(`Parkeringar nära ${scope.label} har hämtats`);
    } catch {
      showNotice("Alla parkeringar i området kunde inte hämtas. Sparad data visas.");
    } finally {
      setAreaLoading(false);
    }
  };

  const updateUserLocation = useCallback((next: LatLng, accuracy: number, followRoute = false) => {
    setUserPosition(next);
    setSearchPosition(null);
    const layer = locationLayerRef.current;
    layer?.clearLayers();
    if (layer) {
      L.circle(next, {
        pane: "parking",
        radius: Math.min(accuracy, 220),
        color: "#3478f6",
        fillColor: "#3478f6",
        fillOpacity: 0.08,
        weight: 1,
      }).addTo(layer);
      L.marker(next, { pane: "parking", icon: userIcon(), title: "Din position" }).addTo(layer);
    }
    if (followRoute) mapRef.current?.panTo(next, { animate: true, duration: 0.45 });
  }, []);

  const locateUser = () => {
    if (!navigator.geolocation) {
      showNotice("Din webbläsare saknar stöd för GPS");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next: LatLng = [position.coords.latitude, position.coords.longitude];
        updateUserLocation(next, position.coords.accuracy);
        setClickedPosition(null);
        setLocating(false);
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

  const calculateRoute = useCallback(async (destination: ParkingPlace, start: LatLng, tracking: boolean) => {
    setRouteLoading(true);
    routeLayerRef.current?.clearLayers();
    const drawRoute = (positions: LatLng[], fallback: boolean, distance: number, minutes: number, steps: NavigationStep[] = []) => {
      const layer = routeLayerRef.current;
      if (!layer) return;
      L.polyline(positions, { pane: "route", color: "#ffffff", weight: 10, opacity: 0.92 }).addTo(layer);
      L.polyline(positions, { pane: "route", color: "#1266ee", weight: 6, opacity: 1, dashArray: fallback ? "7 10" : undefined }).addTo(layer);
      mapRef.current?.fitBounds(L.latLngBounds(positions), { paddingTopLeft: [420, 90], paddingBottomRight: [70, 170], maxZoom: 17 });
      setRouteInfo({ distance, minutes, fallback, destination, positions, steps, currentStep: 0, remainingMeters: distance * 1000, tracking: tracking && !fallback, arrived: false });
      setSelectedParking(null);
    };

    try {
      if (!online) throw new Error("offline");
      const url = `https://router.project-osrm.org/route/v1/driving/${start[1]},${start[0]};${destination.lng},${destination.lat}?overview=full&geometries=geojson&steps=true`;
      const response = await fetch(url);
      if (!response.ok) throw new Error("route");
      const data = (await response.json()) as {
        routes?: Array<{
          distance: number;
          duration: number;
          geometry: { coordinates: [number, number][] };
          legs?: Array<{ steps?: Array<{ distance: number; name?: string; maneuver?: { type?: string; modifier?: string; exit?: number; location?: [number, number] } }> }>;
        }>;
      };
      const route = data.routes?.[0];
      if (!route) throw new Error("route");
      const positions = route.geometry.coordinates.map(([lng, lat]) => [lat, lng] as LatLng);
      const steps = (route.legs ?? []).flatMap((leg) => leg.steps ?? []).flatMap((step): NavigationStep[] => {
        const location = step.maneuver?.location;
        if (!location || !Number.isFinite(location[0]) || !Number.isFinite(location[1])) return [];
        return [{
          instruction: navigationInstruction(step.maneuver?.type, step.maneuver?.modifier, step.name, step.maneuver?.exit),
          distance: step.distance,
          location: [location[1], location[0]],
        }];
      });
      drawRoute(positions, false, route.distance / 1000, route.duration / 60, steps);
    } catch {
      const direct = distanceKm(start, [destination.lat, destination.lng]);
      drawRoute([start, [destination.lat, destination.lng]], true, direct, (direct / 25) * 60);
      showNotice("Visar fågelvägen. Vägrutt kräver internet.");
    } finally {
      setRouteLoading(false);
    }
  }, [online, showNotice]);

  const clearRoute = () => {
    routeLayerRef.current?.clearLayers();
    setRouteInfo(null);
  };

  const buildRoute = (destination: ParkingPlace) => {
    if (userPosition) {
      void calculateRoute(destination, userPosition, true);
      return;
    }
    if (!navigator.geolocation) {
      showNotice("GPS saknas. Rutten startar från kartans mitt.");
      void calculateRoute(destination, viewCenter, false);
      return;
    }

    setRouteLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const start: LatLng = [position.coords.latitude, position.coords.longitude];
        updateUserLocation(start, position.coords.accuracy);
        void calculateRoute(destination, start, true);
      },
      () => {
        showNotice("GPS nekades. Rutten startar från kartans mitt.");
        void calculateRoute(destination, viewCenter, false);
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 10_000 },
    );
  };

  useEffect(() => {
    if (!routeInfo?.tracking || routeInfo.arrived || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const next: LatLng = [position.coords.latitude, position.coords.longitude];
        updateUserLocation(next, position.coords.accuracy, true);
        const activeRoute = routeInfoRef.current;
        if (!activeRoute?.tracking) return;

        const { nearestMeters, remainingMeters } = routeProgress(next, activeRoute.positions);
        const arrived = distanceKm(next, [activeRoute.destination.lat, activeRoute.destination.lng]) * 1000 < 35;
        let currentStep = activeRoute.currentStep;
        while (currentStep < activeRoute.steps.length - 1 && distanceKm(next, activeRoute.steps[currentStep].location) * 1000 < 35) currentStep += 1;
        setRouteInfo({ ...activeRoute, currentStep, remainingMeters, tracking: !arrived, arrived });

        if (arrived) {
          showNotice("Du är framme vid parkeringen");
          return;
        }
        if (!activeRoute.fallback && nearestMeters > 90 && Date.now() - lastRerouteRef.current > 15_000) {
          lastRerouteRef.current = Date.now();
          showNotice("Du har lämnat rutten — räknar om");
          void calculateRoute(activeRoute.destination, next, true);
        }
      },
      () => showNotice("GPS-spårning avbröts. Kontrollera platsbehörigheten."),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 5_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [calculateRoute, routeInfo?.arrived, routeInfo?.tracking, showNotice, updateUserLocation]);

  const dismissPwaInstall = () => {
    sessionStorage.setItem(PWA_INSTALL_DISMISSAL_KEY, "true");
    setPwaInstallOpen(false);
  };

  const handlePwaInstall = async () => {
    if (installPlatform === "ios") {
      setPwaInstallOpen(false);
      return;
    }

    if (manualInstallHelp) {
      setPwaInstallOpen(false);
      return;
    }

    const prompt = deferredPromptRef.current ?? ((window as any).__ipp as BeforeInstallPromptEvent | null);
    if (!prompt) {
      setManualInstallHelp(true);
      return;
    }

    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      deferredPromptRef.current = null;
      (window as any).__ipp = null;
      setCanInstall(false);
      setPwaInstallOpen(false);

      if (outcome === "accepted") {
        showNotice("Appen installerad!");
      } else {
        sessionStorage.setItem(PWA_INSTALL_DISMISSAL_KEY, "true");
      }
    } catch {
      deferredPromptRef.current = null;
      (window as any).__ipp = null;
      setManualInstallHelp(true);
    }
  };

  const saveOffline = async () => {
    if (!isStandalone && isIosDevice()) {
      setCanInstall(true);
      setInstallPlatform("ios");
      setPwaInstallOpen(true);
      return;
    }

    if (deferredPromptRef.current) {
      deferredPromptRef.current.prompt();
      const { outcome } = await deferredPromptRef.current.userChoice;
      if (outcome === "accepted") {
        showNotice("Appen installerad!");
      }
      deferredPromptRef.current = null;
      setCanInstall(false);
    } else {
      setOfflineDialogOpen(true);
    }
  };

  const startOfflineDownload = async () => {
    if (offlineProgress) return;  // Already downloading
    setOfflineDialogOpen(false);
    const map = mapRef.current;
    if (!map) return;
    const bounds = map.getBounds();
    const urls: string[] = [];
    for (let z = 10; z <= 16; z++) {
      const n = Math.pow(2, z);
      const xMin = Math.max(0, Math.floor(((bounds.getWest() + 180) / 360) * n));
      const xMax = Math.min(n - 1, Math.floor(((bounds.getEast() + 180) / 360) * n));
      if (xMax < xMin) continue;
      const latRad = (lat: number) => (lat * Math.PI) / 180;
      const yMin = Math.max(0, Math.floor((1 - Math.log(Math.tan(latRad(bounds.getNorth())) + 1 / Math.cos(latRad(bounds.getNorth()))) / Math.PI) / 2 * n));
      const yMax = Math.min(n - 1, Math.floor((1 - Math.log(Math.tan(latRad(bounds.getSouth())) + 1 / Math.cos(latRad(bounds.getSouth()))) / Math.PI) / 2 * n));
      if (yMax < yMin) continue;
      for (let x = xMin; x <= xMax; x++) {
        for (let y = yMin; y <= yMax; y++) {
          urls.push(`https://a.tile.openstreetmap.org/${z}/${x}/${y}.png`);
        }
      }
    }
    if (!urls.length) { showNotice("Kunde inte beräkna kartrutor."); return; }
    setOfflineProgress({ cached: 0, total: urls.length });
    try {
      const registration = await navigator.serviceWorker!.ready;
      const handler = (e: MessageEvent) => {
        if (e.data?.type === "OFFLINE_PROGRESS") {
          setOfflineProgress({ cached: e.data.cached, total: e.data.total });
          if (e.data.cached >= e.data.total) {
            localStorage.setItem("parksthlm-offline-ready", "true");
            setOfflineReady(true);
            setOfflineProgress(null);
            showNotice("Offline-läge klart!");
            navigator.serviceWorker.removeEventListener("message", handler);
          }
        }
      };
      navigator.serviceWorker.addEventListener("message", handler);
      registration.active?.postMessage({ type: "PREPARE_OFFLINE", urls });
    } catch {
      setOfflineProgress(null);
      showNotice("Misslyckades att starta nedladdning.");
    }
  };

  const showParking = (place: ParkingPlace) => {
    setSelectedZone(null);
    setSelectedParking(place);
    mapRef.current?.flyTo([place.lat, place.lng], Math.max(mapRef.current.getZoom(), 15), { duration: 0.8 });
  };

  const isFavorite = (place: ParkingPlace) => favorites.some((favorite) => favorite.id === place.id);

  const toggleFavorite = (place: ParkingPlace) => {
    if (isFavorite(place)) {
      setFavorites((current) => current.filter((favorite) => favorite.id !== place.id));
      showNotice("Parkeringen togs bort från favoriter");
      return;
    }
    setFavorites((current) => [...current, place]);
    showNotice("Parkeringen sparades som favorit");
  };

  const showFavorite = (place: ParkingPlace) => {
    setFavoritesOpen(false);
    setPanelOpen(false);
    showParking(place);
  };

  const shareParking = async (place: ParkingPlace) => {
    const price = place.free
      ? "Gratis"
      : isTariffId(place.tariff)
        ? `${placeTariffLabel(place)} – ${getCurrentPrice(place.tariff).label}`
        : place.priceText;
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`;
    const text = `${place.name}\n${place.address}, ${place.area}\n${price}\n${mapsUrl}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: place.name, text });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    showNotice("Parkeringsinformationen kopierades");
  };

  const parkedCarCandidate = selectedParking
    ? { lat: selectedParking.lat, lng: selectedParking.lng, address: `${selectedParking.address}, ${selectedParking.area}`, source: "parking" as const }
    : userPosition
      ? { lat: userPosition[0], lng: userPosition[1], address: "Din GPS-position", source: "gps" as const }
      : clickedPosition
        ? { lat: clickedPosition[0], lng: clickedPosition[1], address: clickedAddress || "Vald kartposition", source: "map" as const }
        : searchPosition
          ? { lat: searchPosition[0], lng: searchPosition[1], address: areaScope?.label || "Sökt position", source: "search" as const }
          : { lat: viewCenter[0], lng: viewCenter[1], address: "Kartans mittpunkt", source: "map" as const };

  const openParkedCar = (edit = !parkedCar) => {
    setParkedCarNote(parkedCar?.note ?? "");
    setParkedCarSpot(parkedCar?.spot ?? "");
    setParkedCarEditing(edit);
    setParkedCarOpen(true);
  };

  const saveParkedCar = () => {
    setParkedCar({
      ...parkedCarCandidate,
      savedAt: Date.now(),
      note: parkedCarNote.trim(),
      spot: parkedCarSpot.trim(),
    });
    setParkedCarEditing(false);
    showNotice("Bilens plats sparades");
  };

  const parkedCarAsPlace = parkedCar ? {
    id: "saved-parked-car",
    name: "Min parkerade bil",
    address: parkedCar.address,
    area: "Stockholm",
    lat: parkedCar.lat,
    lng: parkedCar.lng,
    kind: "surface" as const,
    tariff: null,
    free: false,
    priceText: "Sparad position",
    note: parkedCar.note || "Din sparade parkeringsposition.",
    source: "local" as const,
  } satisfies ParkingPlace : null;

  const returnToParkedCar = () => {
    if (!parkedCar) return;
    setParkedCarOpen(false);
    setPanelOpen(false);
    setSelectedParking(null);
    setSelectedZone(null);
    setClickedPosition(null);
    mapRef.current?.flyTo([parkedCar.lat, parkedCar.lng], 17, { duration: 0.8 });
  };

  const saveVehicleProfile = () => {
    setVehicleProfile(vehicleProfileDraft);
    localStorage.setItem(VEHICLE_PROFILE_STORAGE_KEY, JSON.stringify(vehicleProfileDraft));
    selectCategory(VEHICLE_PROFILES[vehicleProfileDraft].filter);
    setVehicleProfileOpen(false);
    showNotice(`${VEHICLE_PROFILES[vehicleProfileDraft].label} sparad – relevant filter är aktivt`);
  };

  const visibleResults = searchMatches.slice(0, query ? 30 : 20);

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
            <span><strong>ParkeraiSthlm</strong><small>Taxa, plats, klart.</small></span>
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
          <button className={category === "street" ? "active" : ""} onClick={() => selectCategory("street")} type="button"><Route size={15} /> Gata</button>
          <button className={category === "free" ? "active" : ""} onClick={() => selectCategory("free")} type="button">Gratis</button>
          <button className={category === "disabled" ? "active" : ""} onClick={() => selectCategory("disabled")} type="button">Handikapp</button>
          <button className={category === "ev" ? "active" : ""} onClick={() => selectCategory("ev")} type="button">Elbil</button>
          <button className={category === "mc" ? "active" : ""} onClick={() => selectCategory("mc")} type="button"><Bike size={15} /> MC</button>
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
              <button type="button" onClick={() => { selectCategory("disabled"); setSearchFocused(false); }} className="suggestion-item">
                <ParkingCircle size={16} className="text-blue" />
                <span>Handikapparkering</span>
              </button>
              <button type="button" onClick={() => { selectCategory("ev"); setSearchFocused(false); }} className="suggestion-item">
                <Zap size={16} className="text-blue" />
                <span>Laddplatser (elbil)</span>
              </button>
              <button type="button" onClick={() => { selectCategory("mc"); setSearchFocused(false); }} className="suggestion-item">
                <Bike size={16} className="text-gray" />
                <span>MC-parkering</span>
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
              {areaScope && limitToArea && (
                <section className="area-search-card" aria-label="Parkeringar i valt område">
                  <span className="area-search-icon"><MapPin size={18} /></span>
                  <span className="area-search-copy">
                    <strong>Parkeringar nära {areaScope.label}</strong>
                    <small>{Math.round(areaScope.radiusKm * 1000)} m radie · välj filter och hämta bara det du behöver</small>
                  </span>
                  <button type="button" onClick={() => void loadCurrentMapView()} disabled={areaLoading || !online}>
                    {areaLoading ? <RefreshCw className="spin" size={15} /> : <Search size={15} />}
                    {areaLoading ? "Hämtar" : "Hämta"}
                  </button>
                </section>
              )}
              <div className="results-heading">
                <span>{limitToArea && areaScope ? `${categoryLabel(category)} i kartvyn` : typeof category !== "number" ? `${categoryLabel(category)} i Stockholmsområdet` : query ? "Sökresultat" : categoryLabel(category)}</span>
                <button type="button" onClick={() => void loadCurrentMapView()} disabled={areaLoading || !online} title="Hämta parkeringsdata i aktuell kartvy">
                  <RefreshCw size={14} className={areaLoading ? "spin" : ""} />
                  {areaLoading ? "Hämtar" : `${filteredParking.length} platser`}
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
                    <span className="result-icon" style={{ "--place-color": placeColor(place) } as React.CSSProperties}>
                      {(place.evSpaces ?? 0) > 0 ? <Zap size={17} /> : (place.disabledSpaces ?? 0) > 0 ? <Accessibility size={17} /> : (place.mcSpaces ?? 0) > 0 ? <Bike size={17} /> : place.kind === "garage" ? <Building2 size={17} /> : <ParkingCircle size={19} />}
                    </span>
                    <span className="result-copy">
                      <strong>{place.name}</strong>
                      <small>{place.address} · {place.area}</small>
                      <span>
                        <b className={place.free ? "free" : ""}>{placeTariffLabel(place)}</b>
                        <i>{placeKindLabel(place)}</i>
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

      <div className="map-top-actions" aria-label="Snabbåtgärder">
        <button type="button" onClick={() => setPanelOpen((open) => !open)} className="list-button" aria-label={panelOpen ? "Dölj parkeringslistan" : "Visa parkeringslistan"} aria-pressed={panelOpen} title={panelOpen ? "Dölj lista" : "Visa parkeringar"} data-mobile-label="Lista">
          <ListFilter size={18} /> <span>{panelOpen ? "Dölj lista" : "Visa parkeringar"}</span>
        </button>
        <button type="button" onClick={() => void loadCurrentMapView()} className="fetch-view-button" disabled={areaLoading || !online} aria-label={areaLoading ? "Hämtar parkeringar i aktuell kartvy" : "Hämta parkeringar i aktuell kartvy"} title="Hämta kartvy" data-mobile-label={areaLoading ? "Hämtar" : "Kartvy"}>
          {areaLoading ? <RefreshCw className="spin" size={17} /> : <Search size={17} />} <span>{areaLoading ? "Hämtar..." : "Hämta kartvy"}</span>
        </button>
        <button type="button" onClick={saveOffline} className={canInstall ? "install-prompt-button" : offlineReady ? "offline-saved" : ""}>
          <Download size={17} /> <span>{isStandalone ? "Appen installerad" : canInstall ? "Ladda ner appen" : offlineProgress ? "Laddar ner..." : offlineReady ? "Offline redo" : "Spara offline"}</span>
        </button>
        <button type="button" className="utility-control favorites-control" onClick={() => setFavoritesOpen(true)} aria-label={`Favoriter, ${favorites.length} sparade`} title="Favoriter" data-mobile-label="Favoriter">
          <Heart size={17} fill={favorites.length ? "currentColor" : "none"} /> <span>Favoriter{favorites.length ? ` (${favorites.length})` : ""}</span>
        </button>
        <button type="button" className={`utility-control parked-control ${parkedCar ? "has-saved-car" : ""}`} onClick={() => parkedCar ? returnToParkedCar() : openParkedCar(true)} aria-label={parkedCar ? "Gå direkt till min parkerade bil" : "Spara var jag parkerade"} title={parkedCar ? "Gå till min bil" : "Var parkerade jag?"} data-mobile-label={parkedCar ? "Min bil" : "Spara bil"}>
          <CarFront size={17} /> <span>{parkedCar ? "Min bil" : "Spara bil"}</span>
        </button>
        <button type="button" className="utility-control profile-control" onClick={() => { setVehicleProfileDraft(vehicleProfile); setVehicleProfileOpen(true); }} aria-label={`Fordonsprofil, ${VEHICLE_PROFILES[vehicleProfile].label}`} title="Fordonsprofil" data-mobile-label="Profil">
          <Settings2 size={17} /> <span>{VEHICLE_PROFILES[vehicleProfile].label}</span>
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
              <span style={{ "--place-color": placeColor(selectedParking) } as React.CSSProperties}>
                {(selectedParking.evSpaces ?? 0) > 0 ? <Zap size={21} /> : (selectedParking.disabledSpaces ?? 0) > 0 ? <Accessibility size={21} /> : (selectedParking.mcSpaces ?? 0) > 0 ? <Bike size={21} /> : selectedParking.kind === "garage" ? <Warehouse size={21} /> : <ParkingCircle size={23} />}
              </span>
              <div>
                <small>{placeKindLabel(selectedParking)}</small>
                <h2>{selectedParking.name}</h2>
                <p>{selectedParking.address}, {selectedParking.area}</p>
                <span className="place-tariff" style={{ background: placeColor(selectedParking) }}>
                  {placeTariffLabel(selectedParking)}
                </span>
              </div>
            </div>
            <div className="place-facts">
              <div><small>Pris</small><strong>{selectedParking.free ? "Gratis" : selectedParkingTariff ? getCurrentPrice(selectedParkingTariff).label : selectedParking.priceText}</strong></div>
              <div><small>Avstånd</small><strong>{formatDistance(distanceKm(focusPosition, [selectedParking.lat, selectedParking.lng]))}</strong></div>
              {selectedParking.spaces ? <div><small>Platser</small><strong>{selectedParking.spaces}</strong></div> : null}
              {(selectedParking.disabledSpaces ?? 0) > 0 ? <div><small>Handikapp</small><strong>{selectedParking.disabledSpaces} plats{selectedParking.disabledSpaces !== 1 ? "er" : ""}</strong></div> : null}
              {(selectedParking.mcSpaces ?? 0) > 0 ? <div><small>MC</small><strong>{selectedParking.mcSpaces} plats{selectedParking.mcSpaces !== 1 ? "er" : ""}</strong></div> : null}
              {(selectedParking.evSpaces ?? 0) > 0 ? <div className="place-ev-header"><Zap size={16} /><small>Elladdning</small><strong>{selectedParking.evSpaces} plats{selectedParking.evSpaces !== 1 ? "er" : ""}</strong></div> : null}
              {selectedParking.evConnections?.map((c, i) => (
                <div key={i} className="place-ev-conn">
                  <span className="ev-qty">{c.quantity} ×</span>
                  <span className="ev-status">{c.status}</span>
                  <span className="ev-type">{c.type}</span>
                  <span className="ev-power">{c.powerKW} kW</span>
                  {c.currentType && <span className="ev-current">{c.currentType}</span>}
                  {c.amps > 0 && c.voltage > 0 && <span className="ev-av">{c.amps}A {c.voltage}V</span>}
                </div>
              ))}
              {selectedParking.evSpaces && !selectedParking.evConnections ? <span className="place-ev-missing">Ingen detaljerad information om laddkontakter finns tillgänglig för denna plats.</span> : null}
            </div>
            <p className="place-note"><CircleAlert size={15} />{selectedParkingTariff ? TARIFFS[selectedParkingTariff].hours : selectedParking.note}</p>
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
            <div className="place-utility-actions">
              <button type="button" className={isFavorite(selectedParking) ? "is-favorite" : ""} onClick={() => toggleFavorite(selectedParking)}>
                <Heart size={17} fill={isFavorite(selectedParking) ? "currentColor" : "none"} /> {isFavorite(selectedParking) ? "Sparad" : "Favorit"}
              </button>
              <button type="button" onClick={() => openParkedCar(true)}><CarFront size={17} /> Parkera här</button>
              <button type="button" onClick={() => void shareParking(selectedParking)}><Share2 size={17} /> Dela</button>
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
              <span style={{ "--place-color": placeColor(clickedPlace) } as React.CSSProperties}>
                <MapPin size={23} />
              </span>
              <div>
                <small>Vald kartposition</small>
                {clickedLoading ? (
                  <div className="loader-dots"><span></span><span></span><span></span></div>
                ) : (
                  <h2>{clickedPlace.name}</h2>
                )}
                <p>{clickedPlace.address}</p>
                <span className="place-tariff" style={{ background: placeColor(clickedPlace) }}>
                  Pris ej verifierat
                </span>
              </div>
            </div>
            <div className="place-facts">
              <div>
                <small>Pris just nu</small>
                <strong>
                  {clickedPlace.priceText}
                </strong>
              </div>
              <div>
                <small>Områdestaxa</small>
                <strong>Se skyltning</strong>
              </div>
              <div>
                <small>Avstånd</small>
                <strong>{formatDistance(distanceKm(focusPosition, [clickedPlace.lat, clickedPlace.lng]))}</strong>
              </div>
            </div>
            <p className="place-note"><CircleAlert size={15} />{clickedPlace.note}</p>
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
            <div>
              <small>{routeInfo.arrived ? "Framme" : routeInfo.fallback ? "Ungefärlig riktning" : routeInfo.tracking ? "Körläge aktivt" : "Snabbaste bilvägen"}</small>
              <strong>{routeInfo.arrived ? "Du är framme" : routeInfo.steps[routeInfo.currentStep]?.instruction ?? `${Math.max(1, Math.round(routeInfo.minutes))} min <i>·</i> ${formatDistance(routeInfo.distance)}`}</strong>
              <p>{routeInfo.arrived ? routeInfo.destination.name : `${formatRouteDistance(routeInfo.remainingMeters)} kvar · Till ${routeInfo.destination.name}`}</p>
              {!routeInfo.arrived && routeInfo.steps[routeInfo.currentStep + 1] ? <em>Nästa: {routeInfo.steps[routeInfo.currentStep + 1].instruction}</em> : null}
            </div>
            <button type="button" onClick={clearRoute} aria-label="Avsluta körläge"><X size={18} /></button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {favoritesOpen && (
          <motion.div className="modal-backdrop feature-modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setFavoritesOpen(false)}>
            <motion.section className="info-modal feature-modal" role="dialog" aria-modal="true" aria-labelledby="favorites-title" initial={{ opacity: 0, y: 28, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 18 }} onClick={(event) => event.stopPropagation()}>
              <button className="sheet-close" type="button" onClick={() => setFavoritesOpen(false)} aria-label="Stäng"><X size={19} /></button>
              <span className="info-icon favorite-icon"><Heart size={23} fill="currentColor" /></span>
              <h2 id="favorites-title">Favoritparkeringar</h2>
              <p>Dina sparade platser finns kvar på den här enheten.</p>
              {favorites.length ? (
                <div className="saved-place-list">
                  {favorites.map((favorite) => (
                    <div className="saved-place-row" key={favorite.id}>
                      <button type="button" className="saved-place-main" onClick={() => showFavorite(favorite)}>
                        <span style={{ "--place-color": placeColor(favorite) } as React.CSSProperties}><ParkingCircle size={17} /></span>
                        <span><strong>{favorite.name}</strong><small>{favorite.address} · {placeTariffLabel(favorite)}</small></span>
                        <Navigation size={16} />
                      </button>
                      <button type="button" className="saved-place-remove" onClick={() => toggleFavorite(favorite)} aria-label={`Ta bort ${favorite.name}`}><Trash2 size={16} /></button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="feature-empty"><Heart size={27} /><strong>Inga favoriter ännu</strong><span>Öppna en parkering och tryck på Favorit.</span></div>
              )}
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {parkedCarOpen && (
          <motion.div className="modal-backdrop feature-modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setParkedCarOpen(false)}>
            <motion.section className="info-modal feature-modal parked-car-modal" role="dialog" aria-modal="true" aria-labelledby="parked-car-title" initial={{ opacity: 0, y: 28, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 18 }} onClick={(event) => event.stopPropagation()}>
              <button className="sheet-close" type="button" onClick={() => setParkedCarOpen(false)} aria-label="Stäng"><X size={19} /></button>
              <span className="info-icon parked-car-icon"><CarFront size={24} /></span>
              <h2 id="parked-car-title">Var parkerade jag?</h2>
              {parkedCar && !parkedCarEditing ? (
                <>
                  <p className="saved-car-status"><Clock3 size={15} /> Sparad {new Date(parkedCar.savedAt).toLocaleString("sv-SE", { dateStyle: "medium", timeStyle: "short" })}</p>
                  <div className="parked-car-details">
                    <div><small>Plats</small><strong>{parkedCar.address}</strong><span>{parkedCar.lat.toFixed(5)}, {parkedCar.lng.toFixed(5)}</span></div>
                    {parkedCar.spot && <div><small>Våning / plats</small><strong>{parkedCar.spot}</strong></div>}
                    {parkedCar.note && <div><small>Anteckning</small><strong>{parkedCar.note}</strong></div>}
                  </div>
                  <div className="feature-action-grid">
                    <button type="button" className="modal-action" onClick={returnToParkedCar}><MapPin size={17} /> Visa på kartan</button>
                    <button type="button" onClick={() => parkedCarAsPlace && void buildRoute(parkedCarAsPlace)}><Navigation size={17} /> Navigera</button>
                    <button type="button" onClick={() => setParkedCarEditing(true)}><Save size={17} /> Uppdatera</button>
                    <button type="button" className="danger-action" onClick={() => { setParkedCar(null); setParkedCarOpen(false); showNotice("Den sparade bilplatsen raderades"); }}><Trash2 size={17} /> Radera</button>
                  </div>
                </>
              ) : (
                <>
                  <p>Platsen väljs i ordningen: vald parkering, GPS, vald kartposition, sökt plats och sist kartans mittpunkt.</p>
                  <div className="candidate-location"><MapPin size={18} /><span><small>Sparas från {parkedCarCandidate.source === "parking" ? "vald parkering" : parkedCarCandidate.source === "gps" ? "GPS" : parkedCarCandidate.source === "search" ? "sökning" : "kartan"}</small><strong>{parkedCarCandidate.address}</strong></span></div>
                  <div className="feature-form">
                    <label><span>Våning eller plats <small>valfritt</small></span><input value={parkedCarSpot} onChange={(event) => setParkedCarSpot(event.target.value)} maxLength={40} placeholder="T.ex. plan 2, plats 48" /></label>
                    <label><span>Anteckning <small>valfritt</small></span><input value={parkedCarNote} onChange={(event) => setParkedCarNote(event.target.value)} maxLength={80} placeholder="T.ex. nära den blå entrén" /></label>
                  </div>
                  <div className="modal-actions feature-form-actions">
                    <button type="button" className="modal-action" onClick={saveParkedCar}><Save size={17} /> Spara bilens plats</button>
                    {parkedCar && <button type="button" onClick={() => setParkedCarEditing(false)}>Avbryt</button>}
                  </div>
                </>
              )}
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {vehicleProfileOpen && (
          <motion.div className="modal-backdrop feature-modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setVehicleProfileOpen(false)}>
            <motion.section className="info-modal feature-modal" role="dialog" aria-modal="true" aria-labelledby="vehicle-profile-title" initial={{ opacity: 0, y: 28, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 18 }} onClick={(event) => event.stopPropagation()}>
              <button className="sheet-close" type="button" onClick={() => setVehicleProfileOpen(false)} aria-label="Stäng"><X size={19} /></button>
              <span className="info-icon"><Settings2 size={24} /></span>
              <h2 id="vehicle-profile-title">Fordonsprofil</h2>
              <p>Profilen sparas på enheten. Filtret ändras först när du trycker på Spara och använd.</p>
              <div className="vehicle-profile-grid">
                {(Object.keys(VEHICLE_PROFILES) as VehicleProfile[]).map((profile) => {
                  const option = VEHICLE_PROFILES[profile];
                  return (
                    <button type="button" key={profile} className={vehicleProfileDraft === profile ? "active" : ""} onClick={() => setVehicleProfileDraft(profile)}>
                      <span>{profile === "ev" ? <Zap size={20} /> : profile === "mc" ? <Bike size={20} /> : profile === "disabled" ? <Accessibility size={20} /> : <CarFront size={20} />}</span>
                      <strong>{option.label}</strong><small>{option.description}</small>
                    </button>
                  );
                })}
              </div>
              <button type="button" className="modal-action" onClick={saveVehicleProfile}><Settings2 size={17} /> Spara och använd {VEHICLE_PROFILES[vehicleProfileDraft].label}</button>
            </motion.section>
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
              <button type="button" className="modal-action" onClick={() => { void saveOffline(); setInfoOpen(false); }}><Download size={17} /> {offlineReady ? "Offline-data är sparad" : offlineProgress ? "Laddar ner..." : "Gör appen redo offline"}</button>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>

      {offlineDialogOpen && (
        <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOfflineDialogOpen(false)}>
          <motion.section className="info-modal" initial={{ opacity: 0, y: 28, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 18 }} onClick={(e) => e.stopPropagation()}>
            <button className="sheet-close" type="button" onClick={() => setOfflineDialogOpen(false)} aria-label="Stäng"><X size={19} /></button>
            <span className="info-icon"><Download size={24} /></span>
            <h2>Ladda ner offline-karta?</h2>
            <p>Kartrutor för det aktuella området (zoom 10–16) laddas ner och sparas i telefonen. Efter nedladdning fungerar kartan, GPS:en och parkeringsdatan utan internet (även i flygplansläge).<br /><br /><strong>Uppskattad storlek:</strong> ~2–10 MB beroende på kartvy.<br /><strong>Adressökning och vägrutt</strong> kräver fortfarande internet.</p>
            <div className="modal-actions">
              <button type="button" className="modal-action" onClick={startOfflineDownload}><Download size={17} /> Starta nedladdning</button>
              <button type="button" onClick={() => setOfflineDialogOpen(false)}>Avbryt</button>
            </div>
          </motion.section>
        </motion.div>
      )}

      <AnimatePresence>
        {pwaInstallOpen && installPlatform && (
          <motion.div
            className="modal-backdrop pwa-install-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={dismissPwaInstall}
          >
            <motion.section
              className="info-modal pwa-install-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="pwa-install-title"
              initial={{ opacity: 0, y: 28, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 18, scale: 0.98 }}
              onClick={(event) => event.stopPropagation()}
            >
              <span className="info-icon pwa-install-icon"><Download size={24} /></span>
              <p className="pwa-install-eyebrow">PARKERA I STHLM</p>
              <h2 id="pwa-install-title">{manualInstallHelp ? "Installera via Chrome-menyn" : "Ha kartan nära till hands"}</h2>
              {installPlatform === "android" && manualInstallHelp ? (
                <>
                  <p>Chrome har inte lämnat något automatiskt installationsanrop. Installera istället direkt från Chrome:</p>
                  <ol className="pwa-install-steps">
                    <li><span>1</span><div>Tryck på <strong>⋮</strong> uppe till höger i Chrome.</div></li>
                    <li><span>2</span><div>Välj <strong>Lägg till på startskärmen</strong> eller <strong>Installera app</strong>.</div></li>
                    <li><span>3</span><div>Välj <strong>Installera</strong>, inte Skapa genväg.</div></li>
                  </ol>
                </>
              ) : installPlatform === "android" ? (
                <>
                  <p>Installera Parkera i Sthlm som en riktig webbapp, inte som en vanlig genväg.</p>
                  <ol className="pwa-install-steps">
                    <li><span>1</span><div>Tryck på <strong>Installera appen</strong> nedan.</div></li>
                    <li><span>2</span><div>Om ingen ruta öppnas: välj webbläsarens meny och sedan <strong>Installera app</strong>.</div></li>
                  </ol>
                </>
              ) : (
                <>
                  <p>Du kan lägga till Parkera i Sthlm på hemskärmen och öppna den som en vanlig app.</p>
                  <ol className="pwa-install-steps">
                    <li><span>1</span><div>Tryck på <strong>Dela</strong> i Safari.</div></li>
                    <li><span>2</span><div>Välj <strong>Lägg till på hemskärmen</strong>.</div></li>
                    <li><span>3</span><div>Kontrollera att <strong>Öppna som webbapp</strong> är aktiverat och tryck på Lägg till.</div></li>
                  </ol>
                </>
              )}
              <div className="modal-actions pwa-install-actions">
                <button ref={installActionRef} type="button" className="modal-action" onClick={() => void handlePwaInstall()}>
                  <Download size={17} /> {manualInstallHelp ? "Fortsätt via Chrome-menyn" : installPlatform === "android" ? "Installera appen" : "Jag förstår"}
                </button>
                <button type="button" onClick={dismissPwaInstall}>Inte nu</button>
              </div>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>

      {offlineProgress && (
        <motion.div className="toast" initial={{ opacity: 0, y: 18, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 14 }}>
          <div className="offline-progress">
            <RefreshCw className="spin" size={16} />
            <span>Laddar ner kartdata... {offlineProgress.cached}/{offlineProgress.total} rutor</span>
          </div>
          <div className="offline-progress-bar">
            <div className="offline-progress-fill" style={{ width: `${(offlineProgress.cached / offlineProgress.total) * 100}%` }} />
          </div>
        </motion.div>
      )}

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
