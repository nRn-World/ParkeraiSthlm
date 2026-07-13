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
  Zap,
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
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const OVERPASS_ENDPOINTS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];
const OVERPASS_ENDPOINT = OVERPASS_ENDPOINTS[0];
const STOCKHOLM_BOUNDS = { south: 59.2, west: 17.75, north: 59.43, east: 18.3 };
const PWA_INSTALL_DISMISSAL_KEY = "parksthlm-pwa-install-dismissed-at";
const PWA_INSTALL_DISMISSAL_MS = 14 * 24 * 60 * 60 * 1000;

function isIosDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isMobileDevice() {
  return isIosDevice() || /Android/i.test(navigator.userAgent);
}

function hasRecentPwaInstallDismissal() {
  const dismissedAt = Number(localStorage.getItem(PWA_INSTALL_DISMISSAL_KEY));
  return Number.isFinite(dismissedAt) && Date.now() - dismissedAt < PWA_INSTALL_DISMISSAL_MS;
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
  Adress?: string;
  AdressLatitud?: number;
  AdressLongitud?: number;
  Anlaggningstyp?: string;
  AntalBesokPlatser?: number;
  AntalBesokPlatserRorelsehindrad?: number;
  AntalBesokPlatserMc?: number;
  AntalLaddplatserBesokBil?: number;
  AntalLaddplatserBesokMc?: number;
  Omrade?: string;
  BesokstaxaCollection?: Array<{ Galler?: string; Taxa?: number; Tidsenhet?: string; ParkeringsTypNamn?: string }>;
};

function parseApiParking(payload: unknown): ParkingPlace[] {
  if (!Array.isArray(payload)) return [];
  return (payload as ApiFacility[]).flatMap((f): ParkingPlace[] => {
    if (!f.AdressLatitud || !f.AdressLongitud || !f.Name) return [];
    const lat = Number(f.AdressLatitud);
    const lng = Number(f.AdressLongitud);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];

    const totalSpots = f.AntalBesokPlatser ?? 0;
    const kind = f.Anlaggningstyp === "Garage" ? "garage" : "surface";
    const tax = f.BesokstaxaCollection?.find((t) => t.Taxa != null);
    const free = tax?.Taxa === 0;
    const priceText = free ? "Avgiftsfri enligt Stockholm Parkering" : tax ? `${tax.Taxa} kr/${tax.Tidsenhet?.toLowerCase() ?? "timme"}` : "Pris ej rapporterat";

    return [{
      id: `api-${f.Name.replace(/\s+/g, "-")}`,
      name: f.Name,
      address: f.Adress || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      area: f.Omrade || "Stockholm",
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
const OFFICIAL_RULES: OfficialRule[] = ["pmotorcykel", "prorelsehindrad", "ptillaten"];

function officialCoordinates(value: unknown): LatLng | null {
  if (!Array.isArray(value)) return null;
  if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
    const [lng, lat] = value.map(Number);
    return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null;
  }
  for (const child of value) {
    const point = officialCoordinates(child);
    if (point) return point;
  }
  return null;
}

function officialProperty(properties: Record<string, unknown>, ...names: string[]): string | undefined {
  const matchingName = Object.keys(properties).find((key) =>
    names.some((name) => key.toLowerCase() === name.toLowerCase()),
  );
  const value = matchingName ? properties[matchingName] : undefined;
  return typeof value === "string" || typeof value === "number" ? String(value).trim() || undefined : undefined;
}

function parseOfficialRuleParking(payload: unknown, rule: OfficialRule): ParkingPlace[] {
  const container = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const features = Array.isArray(payload)
    ? payload
    : Array.isArray(container.features)
      ? container.features
      : Object.values(container).find(Array.isArray) ?? [];
  if (!Array.isArray(features)) return [];

  const isMotorcycle = rule === "pmotorcykel";
  const isDisabled = rule === "prorelsehindrad";
  return (features as OfficialFeature[]).flatMap((feature, index): ParkingPlace[] => {
    const properties = feature.properties ?? feature as Record<string, unknown>;
    const geometry = feature.geometry ?? properties.geometry as OfficialFeature["geometry"];
    const point = officialCoordinates(geometry?.coordinates ?? properties.coordinates ?? properties.koordinater);
    if (!point) return [];
    const [lat, lng] = point;
    const streetName = officialProperty(properties, "street_name", "gata", "street", "gatunamn");
    const addressValue = officialProperty(properties, "address", "adress");
    const address = addressValue && !/^<.*saknas>$/i.test(addressValue) ? addressValue : streetName;
    const citation = officialProperty(properties, "citation", "föreskrift", "foreskrift");
    const otherInfo = officialProperty(properties, "other_info", "beskrivning", "description");
    const tariff = officialProperty(properties, "parking_rate", "avgift", "taxa");
    const placeType = officialProperty(properties, "vf_plats_typ");
    const isFree = /^avgiftsfri\b/i.test(tariff ?? "");
    const identifier = String(feature.id ?? officialProperty(properties, "id", "objectid", "feature_object_id", "fid") ?? `${lat}-${lng}-${index}`);
    return [{
      id: `stockholm-open-data-${rule}-${identifier}`,
      name: isMotorcycle ? "MC-parkering" : isDisabled ? "Parkering för rörelsehindrade" : placeType || "Gatuparkering",
      address: address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      area: "Stockholms stad",
      lat,
      lng,
      kind: "street",
      tariff: null,
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

function parkingTileQueries() {
  const latSteps = [59.2, 59.28, 59.36, 59.43];
  const lngSteps = [17.75, 17.89, 18.03, 18.17, 18.3];
  const queries: string[] = [];
  for (let latIndex = 0; latIndex < latSteps.length - 1; latIndex += 1) {
    for (let lngIndex = 0; lngIndex < lngSteps.length - 1; lngIndex += 1) {
      queries.push(`[out:json][timeout:55];nwr["amenity"="parking"](${latSteps[latIndex]},${lngSteps[lngIndex]},${latSteps[latIndex + 1]},${lngSteps[lngIndex + 1]});out center tags;`);
    }
  }
  return queries;
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

function App() {
  const mapNodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const parkingLayerRef = useRef<LayerGroup | null>(null);
  const locationLayerRef = useRef<LayerGroup | null>(null);
  const routeLayerRef = useRef<LayerGroup | null>(null);
  const clickLayerRef = useRef<LayerGroup | null>(null);
  const lastGeocodeRef = useRef(0);
  const lastMcFitCountRef = useRef(0);
  const officialRuleParkingRef = useRef<Partial<Record<OfficialRule, ParkingPlace[]>>>({});
  const routeInfoRef = useRef<RouteInfo | null>(null);
  const lastRerouteRef = useRef(0);
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const installActionRef = useRef<HTMLButtonElement>(null);

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
  const [offlineDialogOpen, setOfflineDialogOpen] = useState(false);
  const [offlineProgress, setOfflineProgress] = useState<{ cached: number; total: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [pwaInstallOpen, setPwaInstallOpen] = useState(false);
  const [installPlatform, setInstallPlatform] = useState<InstallPlatform | null>(null);

  // Nya states för Dark Mode, Kartklick och Sökförslag
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("parksthlm-dark") === "true");
  const [clickedPosition, setClickedPosition] = useState<LatLng | null>(null);
  const [clickedAddress, setClickedAddress] = useState<string | null>(null);
  const [clickedLoading, setClickedLoading] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);

  useEffect(() => {
    routeInfoRef.current = routeInfo;
  }, [routeInfo]);

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

  const fetchOsmParking = useCallback(async (force = false) => {
    const CACHE_VERSION = 6;
    const cachedRaw = localStorage.getItem("parksthlm-osm");
    if (cachedRaw && !force) {
      try {
        const cached = JSON.parse(cachedRaw) as { timestamp: number; places: ParkingPlace[]; version?: number };
        if (cached.version !== CACHE_VERSION) throw new Error("cache-version-mismatch");
        if (Array.isArray(cached.places)) setAllParking((prev) => replaceSource(prev, "osm", cached.places));
        if (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000 || !navigator.onLine) return;
      } catch {
        localStorage.removeItem("parksthlm-osm");
      }
    }
    if (!navigator.onLine) return;

    setDataLoading(true);
    try {
      const payloads: unknown[] = [];
      const queries = parkingTileQueries();
      for (let index = 0; index < queries.length; index += 3) {
        const batch = await Promise.allSettled(queries.slice(index, index + 3).map(fetchOverpass));
        payloads.push(...batch.flatMap((result) => result.status === "fulfilled" ? [result.value] : []));
      }
      if (payloads.length === 0) throw new Error("Kunde inte hämta parkeringsdata");
      const byId = new Map<string, ParkingPlace>();
      payloads.flatMap(parseOsmParking).forEach((place) => byId.set(place.id, place));
      const places = [...byId.values()];
      localStorage.setItem("parksthlm-osm", JSON.stringify({ timestamp: Date.now(), version: CACHE_VERSION, places }));
      setAllParking((prev) => replaceSource(prev, "osm", places));
      if (force) showNotice(`${places.length} parkeringsplatser uppdaterades`);
    } catch {
      if (force) showNotice("Live-data kunde inte nås. Sparad data används.");
    } finally {
      setDataLoading(false);
    }
  }, [showNotice]);

  const fetchApiParking = useCallback(async (force = false) => {
    const CACHE_KEY = "parksthlm-api";
    const cachedRaw = localStorage.getItem(CACHE_KEY);
    if (cachedRaw && !force) {
      try {
        const cached = JSON.parse(cachedRaw) as { timestamp: number; places: ParkingPlace[]; version?: number };
        if (cached.version !== 2) throw new Error("cache-version");
        if (Array.isArray(cached.places)) setAllParking((prev) => replaceSource(prev, "api", cached.places));
        if (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000 || !navigator.onLine) return;
      } catch {
        localStorage.removeItem(CACHE_KEY);
      }
    }
    if (!navigator.onLine) return;
    try {
      const response = await fetch("/api/stockholm-parking");
      if (!response.ok) throw new Error("Kunde inte hämta infartsparkeringar");
      const places = parseApiParking(await response.json());
      localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), version: 2, places }));
      setAllParking((prev) => replaceSource(prev, "api", places));
      if (force) showNotice(places.length + " infartsparkeringar uppdaterades");
    } catch {
      if (force) showNotice("Infartsparkeringar kunde inte nås. Sparad data används.");
    }
  }, [showNotice]);

  const fetchDisabledParking = useCallback(async () => {
    if (!navigator.onLine) return;
    const key = "parksthlm-disabled";
    const cachedRaw = localStorage.getItem(key);
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw) as { timestamp: number; places: ParkingPlace[]; version?: number };
        if (cached.version === 2 && Array.isArray(cached.places)) {
          setAllParking((prev) => {
            const existingIds = new Set(prev.filter((p) => p.source !== "osm-disabled").map((p) => p.id));
            return [...prev.filter((p) => p.source !== "osm-disabled"), ...cached.places.filter((p) => !existingIds.has(p.id))];
          });
          if (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) return;
        }
      } catch { localStorage.removeItem(key); }
    }
    try {
      const q = "[out:json][timeout:55];area[\"name\"=\"Stockholm\"][\"admin_level\"=\"7\"]->.s;(nwr[\"amenity\"=\"parking_space\"][\"disabled\"=\"yes\"](area.s);nwr[\"amenity\"=\"parking\"][\"capacity:disabled\"](area.s);nwr[\"amenity\"=\"parking\"][\"disabled:capacity\"](area.s);nwr[\"amenity\"=\"parking\"][\"disabled\"](area.s);nwr[\"amenity\"=\"parking\"][~\"^.*disabled.*$\"~\".\"](area.s););out center tags(3000);";
      const res = await fetch(OVERPASS_ENDPOINT + "?data=" + encodeURIComponent(q));
      if (!res.ok) return;
      const places = parseOsmParking(await res.json()).filter((p) => (p.disabledSpaces ?? 0) > 0).slice(0, 3000);
      localStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), version: 2, places }));
      setAllParking((prev) => {
        const existingIds = new Set(prev.filter((p) => p.source !== "osm-disabled").map((p) => p.id));
        return [...prev.filter((p) => p.source !== "osm-disabled"), ...places.filter((p) => !existingIds.has(p.id))];
      });
    } catch { /* silent */ }
  }, []);

  const fetchVerifiedRuleParking = useCallback(async () => {
    if (!navigator.onLine) return;
    const key = "parksthlm-verified-rules";
    const cachedRaw = localStorage.getItem(key);
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw) as { timestamp: number; places: ParkingPlace[]; version?: number };
        if (cached.version === 2 && Array.isArray(cached.places)) {
          setAllParking((prev) => {
            const existingIds = new Set(prev.map((place) => place.id));
            return [...prev, ...cached.places.filter((place) => !existingIds.has(place.id))];
          });
          if (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) return;
        }
      } catch {
        localStorage.removeItem(key);
      }
    }

    const bounds = `${STOCKHOLM_BOUNDS.south},${STOCKHOLM_BOUNDS.west},${STOCKHOLM_BOUNDS.north},${STOCKHOLM_BOUNDS.east}`;
    const queries = [
      `[out:json][timeout:60];nwr["amenity"="parking"]["fee"="no"](${bounds});out center tags;`,
      `[out:json][timeout:60];(nwr["amenity"="parking_space"]["disabled"](${bounds});nwr["amenity"="parking"]["capacity:disabled"](${bounds});nwr["amenity"="parking"]["disabled:capacity"](${bounds}););out center tags;`,
    ];

    try {
      const payloads = await Promise.all(queries.map(fetchOverpass));
      const byId = new Map<string, ParkingPlace>();
      payloads.flatMap(parseOsmParking).forEach((place) => byId.set(place.id, place));
      const places = [...byId.values()];
      localStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), version: 1, places }));
      setAllParking((prev) => {
        const existingIds = new Set(prev.map((place) => place.id));
        return [...prev, ...places.filter((place) => !existingIds.has(place.id))];
      });
    } catch {
      // The map retains any cached rule data when Overpass is temporarily unavailable.
    }
  }, []);

  const fetchOfficialRuleParking = useCallback(async () => {
    if (!navigator.onLine) return;
    const cacheKey = "parksthlm-stockholm-open-data";
    const replaceOfficialData = () => {
      const places = OFFICIAL_RULES.flatMap((rule) => officialRuleParkingRef.current[rule] ?? []);
      localStorage.setItem(cacheKey, JSON.stringify({ timestamp: Date.now(), version: 3, places }));
      setAllParking((prev) => replaceSource(prev, "stockholm-open-data", places));
    };

    const cachedRaw = localStorage.getItem(cacheKey);
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw) as { timestamp: number; places: ParkingPlace[]; version?: number };
        if (cached.version === 3 && Array.isArray(cached.places)) {
          OFFICIAL_RULES.forEach((rule) => {
            officialRuleParkingRef.current[rule] = cached.places.filter((place) => place.id.startsWith(`stockholm-open-data-${rule}-`));
          });
          setAllParking((prev) => replaceSource(prev, "stockholm-open-data", cached.places));
          if (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) return;
        }
      } catch {
        localStorage.removeItem(cacheKey);
      }
    }

    await Promise.all(OFFICIAL_RULES.map(async (rule) => {
      try {
        const response = await fetch(`/api/stockholm-open-data/${rule}`);
        if (!response.ok) return;
        officialRuleParkingRef.current[rule] = parseOfficialRuleParking(await response.json(), rule);
        replaceOfficialData();
      } catch {
        // A slow or unavailable rule layer must not hide successfully loaded MC parking.
      }
    }));
  }, []);

  const fetchEvCharging = useCallback(async () => {
    if (!navigator.onLine) return;
    const key = "parksthlm-ev";
    const cachedRaw = localStorage.getItem(key);
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw) as { timestamp: number; places: ParkingPlace[]; version?: number };
        if (cached.version === 2 && Array.isArray(cached.places)) {
          setAllParking((prev) => {
            const existingIds = new Set(prev.filter((p) => p.source !== "osm-ev").map((p) => p.id));
            return [...prev.filter((p) => p.source !== "osm-ev"), ...cached.places.filter((p) => !existingIds.has(p.id))];
          });
          if (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) return;
        }
      } catch { localStorage.removeItem(key); }
    }
    try {
      const q = "[out:json][timeout:55];area[\"name\"=\"Stockholm\"][\"admin_level\"=\"7\"]->.s;nwr[\"amenity\"=\"charging_station\"](area.s);out center tags(3000);";
      const res = await fetch(OVERPASS_ENDPOINT + "?data=" + encodeURIComponent(q));
      if (!res.ok) return;
      const places = parseOsmParking(await res.json()).filter((p) => (p.evSpaces ?? 0) > 0).slice(0, 3000);
      localStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), version: 1, places }));
      setAllParking((prev) => {
        const existingIds = new Set(prev.filter((p) => p.source !== "osm-ev").map((p) => p.id));
        return [...prev.filter((p) => p.source !== "osm-ev"), ...places.filter((p) => !existingIds.has(p.id))];
      });
    } catch { /* silent */ }
  }, []);

  const fetchOcmCharging = useCallback(async () => {
    if (!navigator.onLine) return;
    const key = "parksthlm-ocm";
    const cachedRaw = localStorage.getItem(key);
    let ocmPlaces: ParkingPlace[] | null = null;
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw) as { timestamp: number; places: ParkingPlace[]; version?: number };
        if (cached.version === 2 && Array.isArray(cached.places)) {
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
      const res = await fetch("/api/open-charge-map");
      if (!res.ok) return;
      ocmPlaces = parseOcmParking(await res.json());
      localStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), version: 2, places: ocmPlaces }));
      setAllParking((prev) => {
        const injected = prev.map((p) => {
          if ((p.evSpaces ?? 0) === 0 || (p.evConnections ?? []).length > 0) return p;
          const match = ocmPlaces!.find((o) => (o.evConnections ?? []).length > 0 && distanceKm([p.lat, p.lng], [o.lat, o.lng]) < 0.05);
          return match ? { ...p, evConnections: match.evConnections } : p;
        });
        const ocmIds = new Set(prev.map((p) => p.id));
        return [...injected, ...ocmPlaces!.filter((o) => !ocmIds.has(o.id))];
      });
    } catch { /* silent */ }
  }, []);

  const fetchNobilCharging = useCallback(async () => {
    if (!navigator.onLine) return;
    const key = "parksthlm-nobil";
    const cachedRaw = localStorage.getItem(key);
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw) as { timestamp: number; places: ParkingPlace[]; version?: number };
        if (cached.version === 1 && Array.isArray(cached.places)) {
          setAllParking((prev) => replaceSource(prev, "nobil", cached.places));
          if (Date.now() - cached.timestamp < 60 * 60 * 1000) return;
        }
      } catch {
        localStorage.removeItem(key);
      }
    }

    try {
      const response = await fetch("/api/nobil", { method: "POST" });
      if (!response.ok) return;
      const places = parseNobilParking(await response.json());
      localStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), version: 1, places }));
      setAllParking((prev) => replaceSource(prev, "nobil", places));
    } catch {
      // Cached NOBIL data is retained if the provider cannot be reached.
    }
  }, []);

  useEffect(() => {
    void fetchOsmParking();
    void fetchApiParking();
    void fetchDisabledParking();
    void fetchVerifiedRuleParking();
    void fetchOfficialRuleParking();
    void fetchEvCharging();
    void fetchOcmCharging();
    void fetchNobilCharging();
  }, [fetchOsmParking, fetchApiParking, fetchDisabledParking, fetchVerifiedRuleParking, fetchOfficialRuleParking, fetchEvCharging, fetchOcmCharging, fetchNobilCharging]);

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      void fetchOsmParking();
      void fetchApiParking();
      void fetchDisabledParking();
      void fetchVerifiedRuleParking();
      void fetchOfficialRuleParking();
      void fetchEvCharging();
      void fetchOcmCharging();
      void fetchNobilCharging();
    };
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [fetchOsmParking, fetchApiParking, fetchDisabledParking, fetchVerifiedRuleParking, fetchOfficialRuleParking, fetchEvCharging, fetchOcmCharging, fetchNobilCharging]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("sw.js").catch(() => undefined);
  }, []);

  useEffect(() => {
    const isStandaloneMode = window.matchMedia("(display-mode: standalone)").matches ||
                          (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    setIsStandalone(isStandaloneMode);

    const shouldOfferInstall = isMobileDevice() && !isStandaloneMode && !hasRecentPwaInstallDismissal();
    if (shouldOfferInstall && isIosDevice()) {
      setInstallPlatform("ios");
      setPwaInstallOpen(true);
    }

    // Check if inline script already captured the event before React mounted
    if ((window as any).__ipp) {
      deferredPromptRef.current = (window as any).__ipp as BeforeInstallPromptEvent;
      setCanInstall(true);
      if (shouldOfferInstall && !isIosDevice()) {
        setInstallPlatform("android");
        setPwaInstallOpen(true);
      }
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      deferredPromptRef.current = e as BeforeInstallPromptEvent;
      setCanInstall(true);
      if (shouldOfferInstall && !isIosDevice()) {
        setInstallPlatform("android");
        setPwaInstallOpen(true);
      }
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
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
    map.createPane("charging");
    map.getPane("charging")!.style.zIndex = "470";
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
    if (category === "free") return place.free && (place.evSpaces ?? 0) === 0;
    if (category === "garage") return place.kind === "garage";
    if (category === "street") return place.kind === "street" || place.kind === "surface";
    if (category === "disabled") return (place.disabledSpaces ?? 0) > 0;
    if (category === "ev") return (place.evSpaces ?? 0) > 0;
    if (category === "mc") return (place.mcSpaces ?? 0) > 0;
    return place.tariff === category;
  }, [category]);

  const filteredParking = useMemo(() => allParking.filter(matchesCategory), [allParking, matchesCategory]);
  const focusPosition = userPosition || searchPosition || viewCenter;
  const selectedParkingTariff = selectedParking && isTariffId(selectedParking.tariff) ? selectedParking.tariff : null;

  useEffect(() => {
    if (category !== "mc") {
      lastMcFitCountRef.current = 0;
      return;
    }

    const map = mapRef.current;
    const motorcyclePlaces = allParking.filter((place) => (place.mcSpaces ?? 0) > 0);
    if (!map || motorcyclePlaces.length < 2 || motorcyclePlaces.length <= lastMcFitCountRef.current) return;

    lastMcFitCountRef.current = motorcyclePlaces.length;
    map.fitBounds(L.latLngBounds(motorcyclePlaces.map((place) => [place.lat, place.lng])), {
      padding: [52, 52],
      maxZoom: 11,
      animate: true,
    });
  }, [allParking, category]);

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
        bounded: "1",
        viewbox: "17.75,59.48,18.35,59.15",
      });
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("Sökningen misslyckades");
      const result = (await response.json()) as Array<{ display_name: string; lat: string; lon: string; type: string }>;
      const hasHouseNum = /^\s*.+\s+\d+\s*$/.test(value);
      const seen = new Set<string>();
      setSearchLocations(result.flatMap((item) => {
        const raw = item.display_name.replace(/, Sverige$/, "");
        const parts = raw.split(",").map((s) => s.trim());
        const street = parts[0];
        const area = parts.slice(1, 3).join(", ");
        const name = hasHouseNum ? value + ", " + area : raw;
        const key = name.toLowerCase();
        if (seen.has(key)) return [];
        seen.add(key);
        return [{ name, lat: Number(item.lat), lng: Number(item.lon), type: item.type }];
      }));
      if (result.length === 0 && hasHouseNum) {
        setSearchLocations([{ name: value + ", Stockholm", lat: 59.3293, lng: 18.0686, type: "address" }]);
      } else if (result.length === 0) {
        showNotice("Ingen adress hittades i Stockholm");
      }
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
    localStorage.setItem(PWA_INSTALL_DISMISSAL_KEY, String(Date.now()));
    setPwaInstallOpen(false);
  };

  const handlePwaInstall = async () => {
    if (installPlatform === "ios") {
      setPwaInstallOpen(false);
      return;
    }

    const prompt = deferredPromptRef.current;
    if (!prompt) return;

    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    deferredPromptRef.current = null;
    setCanInstall(false);
    setPwaInstallOpen(false);

    if (outcome === "accepted") {
      showNotice("Appen installerad!");
    } else {
      localStorage.setItem(PWA_INSTALL_DISMISSAL_KEY, String(Date.now()));
    }
  };

  const saveOffline = async () => {
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

      <div className="map-top-actions">
        <button type="button" onClick={() => setPanelOpen((open) => !open)} className="list-button">
          <ListFilter size={18} /> <span>{panelOpen ? "Dölj lista" : "Visa parkeringar"}</span>
        </button>
        <button type="button" onClick={saveOffline} className={canInstall ? "install-prompt-button" : offlineReady ? "offline-saved" : ""}>
          <Download size={17} /> <span>{isStandalone ? "Appen installerad" : canInstall ? "Ladda ner appen" : offlineProgress ? "Laddar ner..." : offlineReady ? "Offline redo" : "Spara offline"}</span>
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
              <h2 id="pwa-install-title">Ha kartan nära till hands</h2>
              {installPlatform === "android" ? (
                <p>Installera Parkera i Sthlm på hemskärmen för snabb åtkomst till kartan, även när uppkopplingen är svag.</p>
              ) : (
                <>
                  <p>Du kan lägga till Parkera i Sthlm på hemskärmen och öppna den som en vanlig app.</p>
                  <ol className="pwa-install-steps">
                    <li><span>1</span><div>Tryck på <strong>Dela</strong> i Safari.</div></li>
                    <li><span>2</span><div>Välj <strong>Lägg till på hemskärmen</strong>.</div></li>
                  </ol>
                </>
              )}
              <div className="modal-actions pwa-install-actions">
                <button ref={installActionRef} type="button" className="modal-action" onClick={() => void handlePwaInstall()}>
                  <Download size={17} /> {installPlatform === "android" ? "Installera appen" : "Jag förstår"}
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
