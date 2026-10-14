import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Map as MapLibreMap, Marker as MapLibreMarker, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type { Feature as GeoFeature, FeatureCollection as GeoFeatureCollection } from "geojson";
import { ensureIdbVersion, idbDel, idbGet, idbSet } from "./idb-cache";
import { trackEvent } from "./analytics";
import { downloadTiles, nativeTileRequestTransform } from "./tile-cache";
import {
  getCurrentLocation,
  initNativeShell,
  isNativeApp,
  openExternalUrl as openNativeUrl,
  requestNotificationPermission,
  setNativeStatusBar,
  showNotification,
  watchLocation,
} from "./native";
import {
  DRIVING_PITCH,
  OSM_RASTER_STYLE,
  applyMap3dInteractions,
  boundsOf,
  circlePolygon,
  emptyFeatureCollection,
  makeMarkerElement,
  readMap3dEnabled,
  removeAllMarkers,
  syncMarkers,
  toLatLng,
  toLngLat,
  writeMap3dEnabled,
} from "./maplibre-map";

setWorkerUrl(workerUrl);
import { AnimatePresence, motion } from "framer-motion";
import {
  Accessibility,
  Bell,
  BellOff,
  BellRing,
  Bike,
  Box as BoxIcon,
  Building2,
  CarFront,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Crosshair,
  Download,
  ExternalLink,
  Heart,
  Info,
  ListFilter,
  LocateFixed,
  Map as MapIcon,
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
  Timer as TimerIcon,
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

type Category = "all" | "free" | "garage" | "street" | "disabled" | "ev" | "mc" | "resident" | TariffId;
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
type ResultSort = "distance" | "price" | "free" | "power";
type EvConnectorFilter = "all" | "type2" | "ccs" | "chademo" | "tesla";
type ReminderLeadMinutes = 15 | 30;
type DiscTimer = { endsAt: number; minutes: number; placeId: string; placeName: string };
// En notis kan erbjuda en åtgärd, t.ex. Ångra efter ett misstag.
type NoticeAction = { label: string; run: () => void };
const DISC_TIMER_STORAGE_KEY = "parksthlm-disc-timer-v1";
const DISC_PRESETS = [30, 60, 120, 180];
const DISC_WARN_MINUTES = 10;
// P-skivan är ett tillval: den går att stänga av helt så att platskorten inte tjatar
// om timern. Valet sparas på enheten.
const DISC_ENABLED_STORAGE_KEY = "parksthlm-disc-enabled";
const readDiscEnabled = () => localStorage.getItem(DISC_ENABLED_STORAGE_KEY) !== "false";
type ParkedCar = {
  lat: number;
  lng: number;
  address: string;
  savedAt: number;
  note: string;
  spot: string;
  source: "parking" | "gps" | "search" | "map";
  // Taxeläget sparas vid parkeringstillfället. Äldre sparade bilar saknar fälten,
  // så de läses som null och appen visar då bara platsen.
  tariff: TariffId | null;
  tariffLabel: string | null;
  reminder: boolean;
  reminderLead?: ReminderLeadMinutes;
  // Regnr-snapshot från profilen vid parkeringstillfället (valfritt).
  reg: string | null;
};
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

// Publika Overpass-instanser. Den kanoniska instansen först och en spegling som reserv.
// Varje försök har en tidsgräns så att en långsam instans inte kan låsa gränssnittet.
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
];
const OVERPASS_TIMEOUT_MS = 15_000;
const MAX_AREA_RADIUS_KM = 5;
const MAX_VISIBLE_MARKERS = 600;
const STOCKHOLM_DATA_BBOX = "59.15,17.70,59.50,18.35";
const NON_PUBLIC_OSM_ACCESS = new Set(["private", "no", "permit", "employees"]);
const PWA_INSTALL_DISMISSAL_KEY = "parksthlm-pwa-install-dismissed-v4";
const AREA_SEARCH_RADIUS_KM = 1.15;
const FAVORITES_STORAGE_KEY = "parksthlm-favorites-v1";
const PARKED_CAR_STORAGE_KEY = "parksthlm-parked-car-v1";
const VEHICLE_PROFILE_STORAGE_KEY = "parksthlm-vehicle-profile-v1";
const VEHICLE_REG_STORAGE_KEY = "parksthlm-vehicle-reg-v1";

// Svenskt regnr: versaler + siffror, max 7 tecken (ABC123 / ABC12X). Tomt = valfritt.
function normalizeReg(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7);
}
// Listan visar en sida i taget – annars går resten av de tusentals platserna inte att nå.
const RESULTS_PAGE_SIZE = 20;
const RESULT_SORTS: { value: ResultSort; label: string }[] = [
  { value: "distance", label: "Närmast" },
  { value: "price", label: "Billigast" },
  { value: "free", label: "Gratis nu" },
];
const EV_RESULT_SORTS: { value: ResultSort; label: string }[] = [
  ...RESULT_SORTS,
  { value: "power", label: "Starkast" },
];
const REMINDER_LEAD_OPTIONS: ReminderLeadMinutes[] = [15, 30];
// Sparade bilar från äldre versioner saknar vald framförhållning. Femton minuter
// är samma beteende som tidigare och används därför som standard.  // Höjs när tolkningen av Trafikkontorets föreskrifter ändras – då måste gamla cachade
  // poster läsas om i stället för att ligga kvar utan nya fält.
  const OFFICIAL_DATA_CACHE_VERSION = 6;
const OFFLINE_MIN_ZOOM = 10;
const OFFLINE_MAX_ZOOM = 16;
// Tak för offline-nedladdningen: skyddar telefonens lagring och OpenStreetMaps tileservrar.
const MAX_OFFLINE_TILES = 2500;
// Genomsnittlig OSM-tile är ca 25 kB.
const OFFLINE_TILE_KB = 25;

function offlineTileSizeLabel(tileCount: number) {
  return `${Math.max(1, Math.round((tileCount * OFFLINE_TILE_KB) / 1024))} MB`;
}

function collectOfflineTileUrls(bounds: { north: number; south: number; east: number; west: number }) {
  const urls: string[] = [];
  for (let zoom = OFFLINE_MIN_ZOOM; zoom <= OFFLINE_MAX_ZOOM; zoom += 1) {
    const tiles = 2 ** zoom;
    const xMin = Math.max(0, Math.floor(((bounds.west + 180) / 360) * tiles));
    const xMax = Math.min(tiles - 1, Math.floor(((bounds.east + 180) / 360) * tiles));
    if (xMax < xMin) continue;
    const latRad = (lat: number) => (lat * Math.PI) / 180;
    const yMin = Math.max(0, Math.floor((1 - Math.log(Math.tan(latRad(bounds.north)) + 1 / Math.cos(latRad(bounds.north))) / Math.PI) / 2 * tiles));
    const yMax = Math.min(tiles - 1, Math.floor((1 - Math.log(Math.tan(latRad(bounds.south)) + 1 / Math.cos(latRad(bounds.south))) / Math.PI) / 2 * tiles));
    if (yMax < yMin) continue;
    for (let x = xMin; x <= xMax; x += 1) {
      for (let y = yMin; y <= yMax; y += 1) {
        urls.push(`https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`);
        // Avbryt tidigt i stället för att bygga en orimligt stor lista.
        if (urls.length > MAX_OFFLINE_TILES) return urls;
      }
    }
  }
  return urls;
}

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

// Stora JSON-cachar (parkeringsdata, föreskrifter) ligger i IndexedDB – localStorage
// slår i taket vid ~5–10 MB. Gamla localStorage-poster läses en sista gång och
// flyttas över automatiskt. Små inställningar stannar i localStorage.
async function readJsonCache<T>(key: string): Promise<T | null> {
  const fromIdb = await idbGet<T>(key);
  if (fromIdb) return fromIdb;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as T;
    void idbSet(key, parsed);
    localStorage.removeItem(key);
    return parsed;
  } catch {
    try {
      localStorage.removeItem(key);
    } catch {
      // Cachen är valfri – ett misslyckat borttag stör inte appen.
    }
    return null;
  }
}

async function writeJsonCache(key: string, value: unknown): Promise<void> {
  if (await idbSet(key, value)) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    try {
      localStorage.removeItem(key);
    } catch {
      // Cachen är valfri – full lagring ska inte krascha appen.
    }
  }
}

async function deleteJsonCache(key: string): Promise<void> {
  await idbDel(key);
  try {
    localStorage.removeItem(key);
  } catch {
    // Cachen är valfri – ett misslyckat borttag stör inte appen.
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

function reminderLeadOf(parked: ParkedCar | null | undefined): ReminderLeadMinutes {
  return parked?.reminderLead === 30 ? 30 : 15;
}

function normalizeParkedCar(value: ParkedCar | null): ParkedCar | null {
  if (!value) return null;
  return { ...value, reminderLead: reminderLeadOf(value) };
}

type ServiceSeason = { startMonth: number; startDay: number; endMonth: number; endDay: number };
type ServiceScheduleException = { parity?: "even" | "odd"; range?: ServiceSeason };
type ServiceScheduleRule = {
  weekday: number;
  startMinutes: number;
  endMinutes: number;
  requiredRange?: ServiceSeason;
  requiredParity?: "even" | "odd";
  exceptions: ServiceScheduleException[];
};
type ServiceOccurrence = { start: Date; end: Date };
type ResidentPermitInfo = { monthly: number | null; daily: number | null; unavailable: boolean; tariff: TariffId | null };
type TariffFeeSegment = { start: Date; end: Date; amount: number };
type TariffFeeCalculation = { total: number; segments: TariffFeeSegment[]; capped: boolean };
type ParkingPaymentProvider = { id: string; label: string; url: string; note: string };
type EvOperator = { id: string; label: string; ios: string; android: string; site: string };

const SERVICE_WEEKDAYS = ["sondag", "mandag", "tisdag", "onsdag", "torsdag", "fredag", "lordag"];
const SERVICE_MONTHS: Record<string, number> = {
  januari: 1, februari: 2, mars: 3, april: 4, maj: 5, juni: 6,
  juli: 7, augusti: 8, september: 9, oktober: 10, november: 11, december: 12,
};
const SERVICE_SCHEDULE_CACHE = new Map<string, ServiceScheduleRule | null>();
const SERVICE_TONIGHT_HOURS = 24;
const SERVICE_WARNING_HOURS = 48;
const MAX_FEE_CALCULATION_DAYS = 31;

// Stockholm Parkering visar betalningsappar per anläggning. Appen länkar därför till
// de officiella betalningsguiderna i stället för att gissa djupplänkar eller zonkoder.
const PARKING_PAYMENT_PROVIDERS: ParkingPaymentProvider[] = [
  { id: "easypark", label: "EasyPark", url: "https://www.easypark.com/sv-se/sa-fungerar-det", note: "Välj område i appen eller ange områdeskoden från skylten." },
  { id: "parkster", label: "Parkster", url: "https://www.parkster.com/se/sv/sa-fungerar-det/", note: "Välj parkeringszon och sluttid i appen. Express kan fungera utan konto." },
  { id: "stockholm-parkering", label: "Stockholm Parkering", url: "https://www.stockholmparkering.se/parkeringar/betala-parkering/", note: "Se vilka appar och SMS-betalningar som gäller för anläggningen." },
];
const PARKING_PAYMENT_APP_URLS: Record<string, { ios: string; android: string }> = {
  easypark: {
    ios: "https://apps.apple.com/se/app/easypark-din-parkeringsapp/id449594317",
    android: "https://play.google.com/store/apps/details?id=net.easypark.android",
  },
  parkster: {
    ios: "https://apps.apple.com/se/app/parkster-smidig-parkering/id533140250",
    android: "https://play.google.com/store/apps/details?id=se.parkster.client.android&hl=sv",
  },

};

// Operatörslänkarna identifierades mot officiella appbutiker och operatörssidor.
// De visas bara när platsens eget namn gör operatören trolig.
const EV_OPERATOR_APPS: Record<string, EvOperator> = {
  incharge: {
    id: "incharge",
    label: "Vattenfall InCharge",
    ios: "https://apps.apple.com/se/app/vattenfall-incharge/id885790133",
    android: "https://play.google.com/store/apps/details?id=nl.nuon.laadpunten&hl=en_US",
    site: "https://incharge.vattenfall.se/ladda-pa-vagen/hitta-laddstationer",
  },
  mer: {
    id: "mer",
    label: "Mer",
    ios: "https://apps.apple.com/se/app/mer-connect/id6468959214",
    android: "https://play.google.com/store/apps/details?id=eco.mer.connect.app&hl=en_US",
    site: "https://se.mer.eco/en/public-ev-charging/charging-map/",
  },
  recharge: {
    id: "recharge",
    label: "Recharge",
    ios: "https://apps.apple.com/se/app/recharge/id6472725802",
    android: "https://play.google.com/store/apps/details?id=no.recharge.app&hl=en_US",
    site: "https://rechargeinfra.com/charging-map/",
  },
  edri: {
    id: "edri",
    label: "E.ON Drive Public",
    ios: "https://apps.apple.com/se/app/e-on-drive-public/id6754163845",
    android: "https://play.google.com/store/apps/details?id=com.edri.dk",
    site: "https://www.edri.com/where-to-charge",
  },
  circlek: {
    id: "circlek",
    label: "Circle K Charge",
    ios: "https://apps.apple.com/se/app/circle-k-charge/id1495777592",
    android: "https://play.google.com/store/apps/details?id=com.circlek.ev",
    site: "https://www.circlek.se/laddning/laddkarta",
  },
  okq8: {
    id: "okq8",
    label: "OKQ8 Elbilsladdning",
    ios: "https://apps.apple.com/se/app/okq8-elbilsladdning/id1484918898",
    android: "https://play.google.com/store/apps/details?id=com.okq8.elbilsladdning",
    site: "https://www.okq8.se/elbilsladdning/ladda-pa-vagen/",
  },
  tesla: {
    id: "tesla",
    label: "Tesla",
    ios: "https://apps.apple.com/us/app/tesla/id582007913",
    android: "https://play.google.com/store/apps/details?id=com.teslamotors.tesla",
    site: "https://www.tesla.com/findus/list/superchargers/Sweden",
  },
  ionity: {
    id: "ionity",
    label: "Ionity",
    ios: "https://apps.apple.com/us/app/ionity/id1551448692",
    android: "https://play.google.com/store/apps/details?id=com.cleevio.ionity.android.app",
    site: "https://www.ionity.eu/network",
  },
  fastned: {
    id: "fastned",
    label: "Fastned",
    ios: "https://apps.apple.com/us/app/fastned-ev-charging-app/id1485702761",
    android: "https://play.google.com/store/apps/details?id=nl.fastned.my",
    site: "https://www.fastnedcharging.com/en/locations",
  },
};

function serviceDateInSeason(date: Date, season: ServiceSeason) {
  const value = (date.getMonth() + 1) * 100 + date.getDate();
  const start = season.startMonth * 100 + season.startDay;
  const end = season.endMonth * 100 + season.endDay;
  return start <= end ? value >= start && value <= end : value >= start || value <= end;
}

function isoWeekParity(date: Date): "even" | "odd" {
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = (target.getDay() + 6) % 7;
  target.setDate(target.getDate() - day + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const firstDay = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDay + 3);
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return week % 2 === 0 ? "even" : "odd";
}

function parseServiceSchedule(text: string): ServiceScheduleRule | null {
  const cleaned = text.replace(/\s+/g, " ").replace(/[–—]/g, "-").trim();
  if (!cleaned) return null;
  const lower = normalize(cleaned);
  const weekday = SERVICE_WEEKDAYS.findIndex((day) => lower.includes(day));
  if (weekday < 0) return null;
  const timeMatch = lower.match(/(\d{1,2})[.:](\d{2})\s*(?:-|till)\s*(\d{1,2})[.:](\d{2})/);
  if (!timeMatch) return null;
  const startHour = Number(timeMatch[1]);
  const startMinute = Number(timeMatch[2]);
  const endHour = Number(timeMatch[3]);
  const endMinute = Number(timeMatch[4]);
  if (startHour > 24 || endHour > 24 || startMinute > 59 || endMinute > 59) return null;
  const rangePattern = /(\d{1,2})(?::e)?\s+([a-z]+)\s*(?:-|till)\s*(\d{1,2})(?::e)?\s+([a-z]+)/g;
  let requiredRange: ServiceSeason | undefined;
  let requiredParity: "even" | "odd" | undefined;
  const exceptions: ServiceScheduleException[] = [];
  let match: RegExpExecArray | null;
  while ((match = rangePattern.exec(lower)) !== null) {
    const startMonth = SERVICE_MONTHS[match[2]];
    const endMonth = SERVICE_MONTHS[match[4]];
    const startDay = Number(match[1]);
    const endDay = Number(match[3]);
    if (!startMonth || !endMonth || startDay < 1 || startDay > 31 || endDay < 1 || endDay > 31) continue;
    const range = { startMonth, startDay, endMonth, endDay };
    const contextStart = Math.max(0, match.index - 80);
    const context = lower.slice(contextStart, match.index + match[0].length + 20);
    const excluded = /\butom\b/.test(lower.slice(contextStart, match.index));
    const even = /\bjamna veck/.test(context);
    const odd = /\budda veck/.test(context);
    const parity = even === odd ? undefined : even ? "even" : "odd";
    if (excluded) {
      exceptions.push(parity ? { parity, range } : { range });
    } else if (!requiredRange) {
      requiredRange = range;
      requiredParity = parity;
    }
  }
  return {
    weekday,
    startMinutes: startHour * 60 + startMinute,
    endMinutes: endHour * 60 + endMinute,
    requiredRange,
    requiredParity,
    exceptions,
  };
}

function getServiceSchedule(text?: string | null): ServiceScheduleRule | null {
  if (!text) return null;
  const cached = SERVICE_SCHEDULE_CACHE.get(text);
  if (cached !== undefined) return cached;
  const parsed = parseServiceSchedule(text);
  SERVICE_SCHEDULE_CACHE.set(text, parsed);
  return parsed;
}

function serviceDateIsActive(rule: ServiceScheduleRule, date: Date) {
  if (rule.requiredRange && !serviceDateInSeason(date, rule.requiredRange)) return false;
  if (rule.requiredParity && isoWeekParity(date) !== rule.requiredParity) return false;
  return !rule.exceptions.some((exception) => {
    if (exception.parity && isoWeekParity(date) !== exception.parity) return false;
    if (exception.range && !serviceDateInSeason(date, exception.range)) return false;
    return true;
  });
}

function nextServiceOccurrence(text: string | null | undefined, from: Date, horizonHours = SERVICE_WARNING_HOURS): ServiceOccurrence | null {
  const rule = getServiceSchedule(text);
  if (!rule) return null;
  const horizonMs = horizonHours * 60 * 60 * 1000;
  const horizonEnd = from.getTime() + horizonMs;
  const lastOffset = Math.max(2, Math.ceil(horizonHours / 24) + 1);
  for (let offset = -1; offset <= lastOffset; offset += 1) {
    const day = new Date(from);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() + offset);
    if (day.getDay() !== rule.weekday || !serviceDateIsActive(rule, day)) continue;
    const start = new Date(day);
    start.setHours(Math.floor(rule.startMinutes / 60), rule.startMinutes % 60, 0, 0);
    const end = new Date(day);
    end.setHours(Math.floor(rule.endMinutes / 60), rule.endMinutes % 60, 0, 0);
    if (end.getTime() <= start.getTime()) end.setDate(end.getDate() + 1);
    if (end.getTime() > from.getTime() && start.getTime() <= horizonEnd) return { start, end };
  }
  return null;
}

function findServiceWarningNear(places: ParkingPlace[], lat: number, lng: number, from: Date, horizonHours = SERVICE_WARNING_HOURS, maxKm = 0.075): { place: ParkingPlace; occurrence: ServiceOccurrence } | null {
  let best: { place: ParkingPlace; occurrence: ServiceOccurrence } | null = null;
  places.forEach((place) => {
    if (!place.serviceText) return;
    if (distanceKm([lat, lng], [place.lat, place.lng]) > maxKm) return;
    const occurrence = nextServiceOccurrence(place.serviceText, from, horizonHours);
    if (!occurrence) return;
    if (!best || occurrence.start.getTime() < best.occurrence.start.getTime()) best = { place, occurrence };
  });
  return best;
}

function formatServiceOccurrence(occurrence: ServiceOccurrence, now: Date) {
  const time = `${formatClock(occurrence.start)}–${formatClock(occurrence.end)}`;
  if (occurrence.start.getTime() <= now.getTime() && occurrence.end.getTime() > now.getTime()) {
    return `Pågår nu till ${formatClock(occurrence.end)}`;
  }
  const startDay = new Date(occurrence.start);
  startDay.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (startDay.getTime() === today.getTime()) return `Idag ${time}`;
  if (startDay.getTime() === tomorrow.getTime()) return `I morgon ${time}`;
  return `${occurrence.start.toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "long" })} ${time}`;
}

function residentPermitOf(text: string | null | undefined): ResidentPermitInfo | null {
  if (!text) return null;
  const lower = normalize(text);
  const tariffMatch = lower.match(/\btaxa\s*([1-5])(?!\d)/);
  const unavailable = /boende:\s*ingen/.test(lower);
  const monthlyMatch = lower.match(/boende:\s*([\d\s]+)\s*kr\/manad/);
  const dailyMatch = lower.match(/boende:\s*[\d\s]+\s*kr\/manad\s*eller\s*([\d\s]+)\s*kr\/dygn/);
  const monthly = monthlyMatch ? Number(monthlyMatch[1].replace(/\s+/g, "")) : null;
  const daily = dailyMatch ? Number(dailyMatch[1].replace(/\s+/g, "")) : null;
  if (unavailable || (monthly !== null && Number.isFinite(monthly)) || (daily !== null && Number.isFinite(daily)) || tariffMatch) {
    return {
      monthly: monthly !== null && Number.isFinite(monthly) ? monthly : null,
      daily: daily !== null && Number.isFinite(daily) ? daily : null,
      unavailable,
      tariff: tariffMatch ? Number(tariffMatch[1]) as TariffId : null,
    };
  }
  return null;
}

function isResidentPermitPlace(place: ParkingPlace) {
  const permit = residentPermitOf(place.priceText);
  return !!permit && !permit.unavailable;
}

function officialDistrictOf(place: ParkingPlace) {
  return place.area.replace(/^stockholms stad\s*·\s*/i, "").trim() || place.area;
}

function formatFeeAmount(total: number) {
  const rounded = Math.round(total * 100) / 100;
  return `${rounded.toLocaleString("sv-SE", {
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
    maximumFractionDigits: 2,
  })} kr`;
}

function calculateTariffFee(tariff: TariffId, start: Date, end: Date): TariffFeeCalculation | null {
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end.getTime() <= start.getTime()) return null;
  const maxMs = MAX_FEE_CALCULATION_DAYS * 24 * 60 * 60 * 1000;
  const capped = end.getTime() - start.getTime() > maxMs;
  const cappedEnd = new Date(capped ? start.getTime() + maxMs : end.getTime());
  const stepMs = 5 * 60 * 1000;
  const segments: TariffFeeSegment[] = [];
  let total = 0;
  let cursor = new Date(start.getTime());
  while (cursor.getTime() < cappedEnd.getTime()) {
    const next = new Date(Math.min(cursor.getTime() + stepMs, cappedEnd.getTime()));
    const amount = getCurrentPrice(tariff, cursor).amount;
    total += (amount * (next.getTime() - cursor.getTime())) / (60 * 60 * 1000);
    const last = segments[segments.length - 1];
    if (last && last.amount === amount && last.end.getTime() === cursor.getTime()) {
      last.end = next;
    } else {
      segments.push({ start: new Date(cursor.getTime()), end: next, amount });
    }
    cursor = next;
  }
  return { total, segments, capped };
}

function toLocalDateTimeInput(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function navigationLinks(lat: number, lng: number) {
  const destination = encodeURIComponent(`${lat},${lng}`);
  return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving&dir_action=navigate`,
    apple: `https://maps.apple.com/?daddr=${destination}&dirflg=d`,
    waze: `https://waze.com/ul?ll=${destination}&navigate=yes`,
  };
}

function openExternalUrl(url: string) {
  // På webben en ny flik, i den inbyggda appen systemets webbläsare – så att appens
  // eget fönster inte kappas av Google Maps, Apple Maps eller Waze.
  void openNativeUrl(url);
}

function evConnectionGroups(type: string): EvConnectorFilter[] {
  const text = normalize(type);
  const groups = new Set<EvConnectorFilter>();
  if (text.includes("type 2")) groups.add("type2");
  if (text.includes("ccs")) groups.add("ccs");
  if (text.includes("chademo")) groups.add("chademo");
  if (text.includes("tesla")) groups.add("tesla");
  return [...groups];
}

function evMaxPower(place: ParkingPlace) {
  return (place.evConnections ?? []).reduce((max, connection) => Math.max(max, connection.powerKW || 0), 0);
}

function evOperatorForName(name: string): EvOperator | null {
  const text = normalize(name);
  if (text.includes("vattenfall") || text.includes("incharge")) return EV_OPERATOR_APPS.incharge;
  if (/(^|[^a-z])(e\.?on|edri)([^a-z]|$)/.test(text)) return EV_OPERATOR_APPS.edri;
  if (text.includes("circle k") || text.includes("circlek")) return EV_OPERATOR_APPS.circlek;
  if (/(^|[^a-z0-9])okq8([^a-z0-9]|$)/.test(text)) return EV_OPERATOR_APPS.okq8;
  if (/\brecharge\b/.test(text)) return EV_OPERATOR_APPS.recharge;
  if (/(^|[^a-z0-9])mer([^a-z0-9]|$)/.test(text)) return EV_OPERATOR_APPS.mer;
  if (text.includes("tesla")) return EV_OPERATOR_APPS.tesla;
  if (text.includes("ionity")) return EV_OPERATOR_APPS.ionity;
  if (text.includes("fastned")) return EV_OPERATOR_APPS.fastned;
  return null;
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

// Föreskrivna taxor beskrivs ibland med en hel mening i källan, t.ex.
// "Taxa enligt Stockholms stad: taxa 11: Vardagar utom vardag före sön- och helgdag … 13,75 kr/tim."
// I en listrad behövs bara beloppet, så det första kr/tim-priset plockas ut. Hela föreskriften
// står kvar oförkortad i platskortet.
const PRICE_IN_TEXT = /(\d{1,3}(?:[.,]\d{1,2})?)\s*kr\s*\/\s*tim/i;

function compactPriceText(text: string) {
  const price = PRICE_IN_TEXT.exec(text);
  if (price) return `${price[1]} kr/tim`;
  return text.length > 40 ? "Taxa enligt föreskrift" : text;
}

function placeTariffLabel(place: ParkingPlace) {
  if (place.free) return "Avgiftsfri";
  if (isTariffId(place.tariff)) return `Taxa ${place.tariff}`;
  return compactPriceText(place.priceText);
}

// Etiketten beskriver i första hand vad platsen är. Ett garage med laddstolpar är
// fortfarande ett garage – laddningen visas som ett tillägg i stället.
function placeKindLabel(place: ParkingPlace) {
  const amenity = (place.evSpaces ?? 0) > 0
    ? "Laddplats"
    : (place.disabledSpaces ?? 0) > 0
      ? "Rörelsehindrade"
      : (place.mcSpaces ?? 0) > 0
        ? "MC-parkering"
        : null;
  if (place.kind === "garage") return amenity ? `Parkeringsgarage · ${amenity}` : "Parkeringsgarage";
  if (amenity) return amenity;
  if (place.kind === "surface") return "Markparkering";
  return "Gatuparkering";
}

// Rubrik och underrad i listor. För gatuföreskrifter är gatunamnet det användaren söker –
// föreskriftstypen ("P-avgift endast besök") hör hemma på den mindre raden i stället
// för att tränga undan gatunamnet som rubrik.
function placeListCopy(place: ParkingPlace) {
  const street = place.address.trim();
  const isStreetAddress = street.length > 0 && !/^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(street);
  const isOfficialRule = place.source === "stockholm-open-data";
  if (isStreetAddress && (isOfficialRule || place.name === street)) {
    return {
      heading: street,
      detail: place.typeLabel ?? (isOfficialRule ? place.area : `${place.address} · ${place.area}`),
    };
  }
  return { heading: place.name, detail: `${place.address} · ${place.area}` };
}

function formatClock(date: Date) {
  return date.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(ms: number) {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} tim`;
  return `${hours} tim ${minutes} min`;
}

// Nästa gång priset för en taxa ändras. Skiftena ligger på hela klockslag (07:00, 19:00 …),
// så stegen läggs på absoluta 5-minutersgränser och träffar därför skiftena exakt – annars
// skulle nedräkningen kunna peka några minuter fel.
function nextPriceChange(tariff: TariffId, from: Date) {
  if (tariff === 1) return null;
  const stepMs = 5 * 60 * 1000;
  const startAmount = getCurrentPrice(tariff, from).amount;
  const end = from.getTime() + 72 * 60 * 60 * 1000;
  for (let time = Math.floor(from.getTime() / stepMs) * stepMs + stepMs; time <= end; time += stepMs) {
    const moment = new Date(time);
    const amount = getCurrentPrice(tariff, moment).amount;
    if (amount !== startAmount) return { at: moment, amount };
  }
  return null;
}

// Nästa gång avgiftsläget skiftar mellan gratis och avgift. Det är de skiftena som
// betyder något för en parkerad bil – att priset går från 20 till 31 kr/tim är ingen
// anledning att flytta den. Söker åtta dagar framåt så att helgdygn hinns med.
function nextFreeBoundary(tariff: TariffId, from: Date): { at: Date; amount: number; freeBefore: boolean } | null {
  const stepMs = 5 * 60 * 1000;
  const end = from.getTime() + 8 * 24 * 60 * 60 * 1000;
  let previous = getCurrentPrice(tariff, from).amount;
  for (let time = Math.floor(from.getTime() / stepMs) * stepMs + stepMs; time <= end; time += stepMs) {
    const moment = new Date(time);
    const amount = getCurrentPrice(tariff, moment).amount;
    if (amount === previous) continue;
    if (amount === 0 || previous === 0) return { at: moment, amount, freeBefore: previous === 0 };
    previous = amount;
  }
  return null;
}

// Gratis just nu = uttryckligen avgiftsfri, eller en taxa som kostar 0 kr vid den här tiden.
function isFreeNow(place: ParkingPlace, priceByTariff: Map<TariffId, number>) {
  if (place.free) return true;
  return isTariffId(place.tariff) && priceByTariff.get(place.tariff) === 0;
}

// Svensk parkeringsskiva som ikon: blå skiva med ankomstfönster och P. En klocka säger
// "tid", men skivan är den symbol föraren känner igen vid P-skiveknappen.
function ParkingDiscIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="4.4" y="1.4" width="15.2" height="21.2" rx="2.6" fill="#1d64c4" />
      <path d="M10 2.7h4l-2 4z" fill="#ffffff" />
      <path d="M7.4 13a4.6 4.6 0 0 1 9.2 0z" fill="#f4f7fb" />
      <circle cx="12" cy="11.4" r="0.9" fill="#1d64c4" />
      <rect x="7.6" y="15" width="8.8" height="6" rx="1.5" fill="#ffffff" />
      <text x="12" y="19.9" textAnchor="middle" fontSize="6.1" fontWeight="700" fill="#1d64c4" fontFamily="Verdana, Arial, sans-serif">P</text>
    </svg>
  );
}

function parkingIcon(place: ParkingPlace, selected: boolean) {
  const isEv = (place.evSpaces ?? 0) > 0;
  const isDisabled = (place.disabledSpaces ?? 0) > 0;
  const isMc = (place.mcSpaces ?? 0) > 0;
  const color = placeColor(place);
  const letter = isEv ? "E" : isDisabled ? "H" : isMc ? "M" : place.free ? "G" : place.kind === "garage" ? "G" : "P";
  // MapLibre-markör: samma HTML som förut, elementet byggs av anroparen.
  return {
    className: "parking-marker-wrap",
    html: `<div class="parking-marker${selected ? " is-selected" : ""}" style="--marker-color:${color}"><span>${letter}</span></div>`,
  };
}

const GENERIC_PLACE_NAMES = new Set([
  "parkering", "markparkering", "gatuparkering", "parkeringsgarage", "laddstation",
  "mc-parkering", "parkering for rorelsehindrade", "parkering för rörelsehindrade",
]);

// Lägre siffra = viktigare markör. Används för att begränsa antalet markörer när
// källorna bidrar med tusentals anonyma gatuparkeringsrader.
function markerPriority(place: ParkingPlace) {
  if (place.source === "local") return 0;
  if (place.kind === "garage") return 1;
  // Enskilda föreskriftsrader beskriver korta gatusnuttar och blir för många att visa
  // i utzoomat läge – de är fullt synliga från zoom 14 och i alla aktiva filter.
  if (place.source !== "stockholm-open-data" && !GENERIC_PLACE_NAMES.has(normalize(place.name)) && place.name.length > 3) return 2;
  return 3;
}

function userIcon() {
  return {
    className: "user-marker-wrap",
    html: '<div class="user-marker"><div></div></div>',
  };
}

// Körlägets zoom ("höjden") sparas så att den ligger kvar tills användaren ändrar den själv.
const DRIVING_ZOOM_KEY = "parksthlm-driving-zoom";
const DEFAULT_DRIVING_ZOOM = 17;

function readDrivingZoom() {
  const stored = Number(localStorage.getItem(DRIVING_ZOOM_KEY));
  return Number.isFinite(stored) && stored >= 10 && stored <= 19 ? stored : DEFAULT_DRIVING_ZOOM;
}

// Bäring i grader (0 = norr, medurs) mellan två positioner. Används när GPS:en inte
// rapporterar någon heading – då räknas riktningen fram från rörelsen i stället.
function bearingBetween(from: LatLng, to: LatLng) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const toDeg = (value: number) => (value * 180) / Math.PI;
  const dLng = toRad(to[1] - from[1]);
  const lat1 = toRad(from[0]);
  const lat2 = toRad(to[0]);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Modern bilmarkör för körläget: en blå badge med vit bil i fågelperspektiv som pekar
// uppåt, roterad med --car-heading så nosen alltid visar färdriktningen. Hela märket
// roteras (inte bara bilen) så att även noskilen följer med.
const DRIVING_CAR_GLYPH = `<svg class="driving-car-glyph" viewBox="0 0 32 48" aria-hidden="true"><g fill="currentColor"><rect x="6" y="3" width="20" height="42" rx="7"/><rect x="6" y="3" width="20" height="42" rx="7" fill="none" stroke="rgba(0,0,0,0.18)" stroke-width="1"/></g><g fill="#1266ee"><rect x="10" y="14" width="12" height="7" rx="2"/><rect x="10.5" y="26" width="11" height="6" rx="2"/></g><g fill="#0b3f9e" opacity="0.55"><rect x="10" y="14" width="12" height="2.4" rx="1.2"/></g></svg>`;

function drivingCarIcon(heading: number) {
  const safeHeading = Number.isFinite(heading) ? ((heading % 360) + 360) % 360 : 0;
  return {
    className: "driving-car-wrap",
    html: `<div class="driving-car-marker" style="--car-heading:${safeHeading.toFixed(1)}deg"><span class="driving-car-halo"></span><span class="driving-car-nose"></span><span class="driving-car-body">${DRIVING_CAR_GLYPH}</span></div>`,
  };
}

function formatDistance(km: number) {
  if (km < 1) return `${Math.max(20, Math.round((km * 1000) / 10) * 10)} m`;
  return `${km.toFixed(1).replace(".", ",")} km`;
}

// Bilen ritas som en riktig bil (lucides "car", samma form som ikonerna i gränssnittet)
// i stället för en emoji – emojin blev en vit klump när den färgades om i liten storlek.
const PARKED_CAR_GLYPH = `<svg class="parked-car-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>`;

// Den parkerade bilen ska gå att hitta direkt i ett hav av blå P-markörer. Därför egen
// färg (amber) i stället för kartans blå, större ring, mjuk glöd runt om och en etikett
// med avståndet från dig. Se .parked-car-marker i index.css – storlek och ankarpunkt
// (nålen längst ner) hänger ihop med måtten där.
function parkedCarIcon(distanceLabel?: string) {
  return {
    className: "parked-car-marker-wrap",
    html: `<div class="parked-car-marker">
      <span class="parked-car-glow"></span>
      <span class="parked-car-pin">${PARKED_CAR_GLYPH}</span>
      <b>MIN BIL${distanceLabel ? `<em>${distanceLabel}</em>` : ""}</b>
    </div>`,
  };
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
      maxMinutes: parseOsmMaxstay(tags.maxstay),
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

function pointInPolygon(point: LatLng, polygon: LatLng[]) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [latCurrent, lngCurrent] = polygon[index];
    const [latPrevious, lngPrevious] = polygon[previous];
    const crossesRay = (lngCurrent > point[1]) !== (lngPrevious > point[1])
      && point[0] < ((latPrevious - latCurrent) * (point[1] - lngCurrent)) / (lngPrevious - lngCurrent) + latCurrent;
    if (crossesRay) inside = !inside;
  }
  return inside;
}

// Shoelace i lokala meter – används endast för att välja det mest specifika taxeområdet vid överlapp.
function polygonAreaM2(polygon: LatLng[]) {
  const metersPerDegree = 111_320;
  const lngScale = Math.cos((STOCKHOLM_CENTER[0] * Math.PI) / 180) * metersPerDegree;
  let total = 0;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const xPrevious = polygon[previous][1] * lngScale;
    const yPrevious = polygon[previous][0] * metersPerDegree;
    const xCurrent = polygon[index][1] * lngScale;
    const yCurrent = polygon[index][0] * metersPerDegree;
    total += xPrevious * yCurrent - xCurrent * yPrevious;
  }
  return Math.abs(total / 2);
}

function segmentDistanceKm(point: LatLng, start: LatLng, end: LatLng) {
  const steps = Math.max(2, Math.min(80, Math.ceil(distanceKm(start, end) / 0.02)));
  let nearest = Number.POSITIVE_INFINITY;
  for (let step = 0; step <= steps; step += 1) {
    const progress = step / steps;
    const sample: LatLng = [
      start[0] + (end[0] - start[0]) * progress,
      start[1] + (end[1] - start[1]) * progress,
    ];
    nearest = Math.min(nearest, distanceKm(point, sample));
  }
  return nearest;
}

// Taxan för en valfri punkt: gatumarkeringar (0–60 m) väger tyngre än områdespolygonerna,
// och vid överlappande områden väljs den minsta (mest specifika) polygonen.
function tariffAtPosition(point: LatLng): { tariff: TariffId; street?: string } | null {
  const streetMatch = TAX_STREETS.reduce<{ tariff: TariffId; name: string; distance: number } | null>((closest, segment) => {
    let nearest = Number.POSITIVE_INFINITY;
    for (let index = 0; index < segment.positions.length - 1; index += 1) {
      nearest = Math.min(nearest, segmentDistanceKm(point, segment.positions[index], segment.positions[index + 1]));
    }
    if (nearest > 0.06) return closest;
    if (closest && closest.distance <= nearest) return closest;
    return { tariff: segment.tariff, name: segment.name, distance: nearest };
  }, null);
  if (streetMatch) return { tariff: streetMatch.tariff, street: streetMatch.name };

  const areaMatch = TAX_AREAS
    .filter((area) => pointInPolygon(point, area.positions))
    .map((area) => ({ tariff: area.tariff, area: polygonAreaM2(area.positions) }))
    .sort((first, second) => first.area - second.area)[0];
  return areaMatch ? { tariff: areaMatch.tariff } : null;
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

// Maxtid från Trafikkontorets föreskrifter (max_minutes prioriteras, annars max_hours).
function officialMaxMinutes(properties: Record<string, unknown>): number | undefined {
  const minutes = Number(String(officialProperty(properties, "max_minutes") ?? "").replace(",", "."));
  if (Number.isFinite(minutes) && minutes > 0 && minutes <= 24 * 60) return Math.round(minutes);
  const hours = Number(String(officialProperty(properties, "max_hours") ?? "").replace(",", "."));
  if (Number.isFinite(hours) && hours > 0 && hours <= 24) return Math.round(hours * 60);
  return undefined;
}

// OSM maxstay skrivs som "2 hours", "90 minutes" eller "30 min".
// Bart "m" tolkas inte (kan betyda månad) – minuter kräver minst "min".
function parseOsmMaxstay(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.match(/([\d.,]+)\s*(minuter|minut|mins|minute|minutes|min|timmar|timme|hours|hour|hrs|hr|tim|h)/i);
  if (!match) return undefined;
  const amount = Number(match[1].replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  const unit = match[2].toLowerCase();
  const isMinute = /^(min|mins|minute|minutes|minut|minuter)$/.test(unit);
  const minutes = isMinute ? amount : amount * 60;
  return minutes > 0 && minutes <= 24 * 60 ? Math.round(minutes) : undefined;
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
    const serviceText = officialProperty(properties, "other_info", "beskrivning", "description");
    const tariff = officialProperty(properties, "parking_rate", "avgift", "taxa");
    const placeType = officialProperty(properties, "vf_plats_typ");
    const vehicle = officialProperty(properties, "vehicle", "fordon");
    const district = officialProperty(properties, "city_district", "stadsdel");
    const normalizedPlaceType = normalize(placeType ?? "");
    const normalizedVehicle = normalize(vehicle ?? "");
    const isMotorcycle = rule === "pmotorcykel" || normalizedPlaceType.includes("motorcykel") || normalizedVehicle.includes("motorcykel");
    const isDisabled = rule === "prorelsehindrad" || normalizedPlaceType.includes("rorelsehindrad") || normalizedVehicle.includes("rorelsehindrad");
    // Platser som är reserverade för särskilda fordon (beskickningsbilar, cyklar m.m.)
    // får inte användas av allmänheten och ska därför inte visas som ledig parkering.
    const isReservedForOthers = !isMotorcycle && !isDisabled
      && (normalizedPlaceType.includes("reserverad") || normalizedPlaceType.includes("beskickning"));
    if (isReservedForOthers) return [];
    const isFree = /^avgiftsfri\b/i.test(tariff ?? "");
    const tariffMatch = normalize(tariff ?? "").match(/\btaxa\s*([1-5])\b/);
    const tariffId = tariffMatch ? Number(tariffMatch[1]) as TariffId : null;
    const restrictionDetails = officialRuleDetails(properties);
    const maxMinutes = officialMaxMinutes(properties);
    const otherInfo = restrictionDetails.join(" · ") || undefined;
    const identifier = String(feature.id ?? officialProperty(properties, "id", "objectid", "feature_object_id", "fid") ?? `${lat}-${lng}-${index}`);
    // En del poster har en kod (t.ex. "7") i stället för en platsbeteckning – visa då gatunamnet.
    const readableName = placeType && placeType.length >= 4 && !/^[\d\s-]+$/.test(placeType) ? placeType : streetName;
    return [{
      id: `stockholm-open-data-${rule}-${identifier}`,
      name: isMotorcycle ? "MC-parkering" : isDisabled ? "Parkering för rörelsehindrade" : readableName || "Gatuparkering",
      typeLabel: readableName && readableName !== streetName ? readableName : undefined,
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
      serviceText,
      maxMinutes,
      disabledSpaces: isDisabled ? 1 : undefined,
      mcSpaces: isMotorcycle ? 1 : undefined,
      source: "stockholm-open-data",
    }];
  });
}

async function fetchOverpass(query: string) {
  let lastError: Error | undefined;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
    try {
      const response = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`Overpass svarade ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Overpass kunde inte nås");
    } finally {
      window.clearTimeout(timeout);
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
  if (category === "resident") return "Boende";
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
        .replace(/[^a-z0-9]+/g, " ")
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

// Flera källposter kan beskriva samma gatusnutt med identiskt namn och adress
// (t.ex. två föreskriftsrader på samma gata). I listan visas de som en rad.
function collapseIdenticalEntries(places: ParkingPlace[]) {
  const result: ParkingPlace[] = [];
  const seenIndexes = new Map<string, number>();

  places.forEach((place) => {
    const key = `${normalize(place.name)}|${normalize(place.address)}`;
    const existingIndex = seenIndexes.get(key);
    if (existingIndex == null) {
      seenIndexes.set(key, result.length);
      result.push(place);
      return;
    }
    const existing = result[existingIndex];
    if (distanceKm([existing.lat, existing.lng], [place.lat, place.lng]) > 0.06) {
      result.push(place);
      return;
    }
    result[existingIndex] = mergeDuplicateParking(existing, place);
  });

  return result;
}

const STREET_RULE_CELL_DEGREES = 0.002; // ca 220 m – större än sökradien nedan
const STREET_RULE_MATCH_KM = 0.08;

// Kopplar OSM-poster utan adress till närmaste gatu-föreskrift. Föreskrifterna läggs i ett
// rutnät så att varje post bara jämförs med gatorna i sin närhet – annars blir det
// hundra miljoner avståndsberäkningar när hela datasetet är laddat.
function addNearbyStreetAddresses(places: ParkingPlace[]): ParkingPlace[] {
  const streetRules = places.filter((place) => place.source === "stockholm-open-data" && place.kind === "street" && !/^[-\d.]+,\s*[-\d.]+$/.test(place.address));
  if (streetRules.length === 0) return places;

  const ruleCells = new Map<string, ParkingPlace[]>();
  streetRules.forEach((rule) => {
    const key = `${Math.floor(rule.lat / STREET_RULE_CELL_DEGREES)}:${Math.floor(rule.lng / STREET_RULE_CELL_DEGREES)}`;
    const bucket = ruleCells.get(key);
    if (bucket) bucket.push(rule);
    else ruleCells.set(key, [rule]);
  });

  let changed = false;
  const enriched = places.map((place) => {
    if (place.source !== "osm" || !/^[-\d.]+,\s*[-\d.]+$/.test(place.address)) return place;
    const centreLat = Math.floor(place.lat / STREET_RULE_CELL_DEGREES);
    const centreLng = Math.floor(place.lng / STREET_RULE_CELL_DEGREES);
    let nearestStreet: ParkingPlace | undefined;
    let nearestKm = Number.POSITIVE_INFINITY;

    for (let latOffset = -1; latOffset <= 1; latOffset += 1) {
      for (let lngOffset = -1; lngOffset <= 1; lngOffset += 1) {
        const bucket = ruleCells.get(`${centreLat + latOffset}:${centreLng + lngOffset}`);
        if (!bucket) continue;
        bucket.forEach((rule) => {
          const km = distanceKm([place.lat, place.lng], [rule.lat, rule.lng]);
          if (km < nearestKm) {
            nearestKm = km;
            nearestStreet = rule;
          }
        });
      }
    }

    if (!nearestStreet || nearestKm > STREET_RULE_MATCH_KM) return place;
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
  const mapRef = useRef<MapLibreMap | null>(null);
  const mapReadyRef = useRef(false);
  // HTML-markörer per lager – synkas mot önskat tillstånd utan att flimra.
  const parkingMarkersRef = useRef(new Map<string, MapLibreMarker>());
  const placeByIdRef = useRef(new Map<string, ParkingPlace>());
  const streetPlaceByIdRef = useRef(new Map<string, ParkingPlace>());
  const clickMarkerRef = useRef<MapLibreMarker | null>(null);
  const searchMarkerRef = useRef<MapLibreMarker | null>(null);
  const parkedCarMarkerRef = useRef<MapLibreMarker | null>(null);
  const userMarkerRef = useRef<MapLibreMarker | null>(null);
  const lastGeocodeRef = useRef(0);
  const lastMcFitCountRef = useRef(0);
  const routeInfoRef = useRef<RouteInfo | null>(null);
  const lastRerouteRef = useRef(0);
  const lastPosRef = useRef<LatLng | null>(null);
  const headingRef = useRef(0);
  const drivingZoomRef = useRef<number>(readDrivingZoom());
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const installActionRef = useRef<HTMLButtonElement>(null);
  const loadedGlobalRulesRef = useRef(new Set<OfficialRule>());
  const globalRuleCountsRef = useRef(new Map<OfficialRule, number>());
  const loadedGlobalOsmRef = useRef(new Set<"garage" | "free">());

  const [allParking, setAllParking] = useState<ParkingPlace[]>(LOCAL_PARKING);
  const [category, setCategory] = useState<Category>("all");
  const [query, setQuery] = useState("");
  const [serviceTonightOnly, setServiceTonightOnly] = useState(false);
  const [residentDistrict, setResidentDistrict] = useState("all");
  const [evMinPower, setEvMinPower] = useState(0);
  const [evConnector, setEvConnector] = useState<EvConnectorFilter>("all");
  const [calcTariff, setCalcTariff] = useState<TariffId>(3);
  const [calcStartInput, setCalcStartInput] = useState(() => toLocalDateTimeInput(new Date()));
  const [calcEndInput, setCalcEndInput] = useState(() => toLocalDateTimeInput(new Date(Date.now() + 3 * 60 * 60 * 1000)));
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
  const [mapReady, setMapReady] = useState(false);
  // 3D-perspektiv som Google Maps/Waze i körläge. Kan stängas av till platt 2D i Profil.
  const [map3dEnabled, setMap3dEnabled] = useState(() => readMap3dEnabled());
  const map3dRef = useRef(map3dEnabled);
  const [locating, setLocating] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [panelOpen, setPanelOpen] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [offlineReady, setOfflineReady] = useState(localStorage.getItem("parksthlm-offline-ready") === "true");
  const [offlineDialogOpen, setOfflineDialogOpen] = useState(false);
  const [offlineTiles, setOfflineTiles] = useState<string[]>([]);
  const [offlineProgress, setOfflineProgress] = useState<{ cached: number; total: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeAction, setNoticeAction] = useState<NoticeAction | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [pwaInstallOpen, setPwaInstallOpen] = useState(false);
  const [installPlatform, setInstallPlatform] = useState<InstallPlatform | null>(null);
  const [manualInstallHelp, setManualInstallHelp] = useState(false);
  const [favorites, setFavorites] = useState<ParkingPlace[]>(() => readLocalStorage(FAVORITES_STORAGE_KEY, []));
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  // P-skiva: nedräkning som överlever omladdning. Varning 10 min innan, notis när tiden går ut.
  const [discTimer, setDiscTimer] = useState<DiscTimer | null>(() => readLocalStorage<DiscTimer | null>(DISC_TIMER_STORAGE_KEY, null));
  const [discEnabled, setDiscEnabled] = useState(readDiscEnabled);
  const [discMinutes, setDiscMinutes] = useState(120);
  // Rutan är ihopfälld tills man trycker på P-skiveknappen. En pågående nedräkning
  // visas ändå, så att tiden inte kan glömmas bort i en stängd ruta.
  const [discOpen, setDiscOpen] = useState(false);
  const discWarnedRef = useRef<number | null>(null);
  const discFiredRef = useRef<number | null>(null);
  const [parkedCar, setParkedCar] = useState<ParkedCar | null>(() => normalizeParkedCar(readLocalStorage<ParkedCar | null>(PARKED_CAR_STORAGE_KEY, null)));
  const [parkedCarOpen, setParkedCarOpen] = useState(false);
  const [parkedCarEditing, setParkedCarEditing] = useState(false);
  const [parkedCarNote, setParkedCarNote] = useState("");
  const [parkedCarSpot, setParkedCarSpot] = useState("");
  const [vehicleProfile, setVehicleProfile] = useState<VehicleProfile>(() => readLocalStorage(VEHICLE_PROFILE_STORAGE_KEY, "car"));
  const [vehicleProfileDraft, setVehicleProfileDraft] = useState<VehicleProfile>(() => readLocalStorage(VEHICLE_PROFILE_STORAGE_KEY, "car"));
  const [vehicleProfileOpen, setVehicleProfileOpen] = useState(false);
  const [vehicleReg, setVehicleReg] = useState(() => readLocalStorage(VEHICLE_REG_STORAGE_KEY, ""));
  const [vehicleRegDraft, setVehicleRegDraft] = useState(() => readLocalStorage(VEHICLE_REG_STORAGE_KEY, ""));

  // Nya states för Dark Mode, Kartklick och Sökförslag
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("parksthlm-dark") === "true");
  const [clickedPosition, setClickedPosition] = useState<LatLng | null>(null);
  const [clickedAddress, setClickedAddress] = useState<string | null>(null);
  const [clickedLoading, setClickedLoading] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [resultSort, setResultSort] = useState<ResultSort>("distance");
  const [resultWindow, setResultWindow] = useState({ key: "", limit: RESULTS_PAGE_SIZE });
  // Tickar medan en bil är sparad så att nedräkningen och påminnelsen följer klockan.
  const [clock, setClock] = useState(() => Date.now());
  const parkingReminderFiredRef = useRef<number | null>(null);
  const serviceReminderFiredRef = useRef<number | null>(null);

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

  useEffect(() => {
    if (discTimer) localStorage.setItem(DISC_TIMER_STORAGE_KEY, JSON.stringify(discTimer));
    else localStorage.removeItem(DISC_TIMER_STORAGE_KEY);
  }, [discTimer]);

  // Vald P-skivetid följer platsens maxtid när ett nytt platskort öppnas.
  useEffect(() => {
    if (selectedParking) setDiscMinutes(selectedParking.maxMinutes ?? 120);
    setDiscOpen(false);
  }, [selectedParking?.id]);

  // Klockan som nedräkningen, påminnelsen och Städnatt-filtret räknar mot.
  // Utan sparad bil tickar den glesare – då behövs bara dagsaktuella servicetider.
  useEffect(() => {
    const intervalMs = parkedCar || discTimer ? 20_000 : serviceTonightOnly ? 60_000 : 0;
    if (!intervalMs) return;
    const timer = window.setInterval(() => setClock(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [parkedCar, discTimer, serviceTonightOnly]);

  // Poster från äldre tolkningar av föreskriftsdatan läses aldrig mer men tar lagring –
  // rensa dem en gång per start i stället för att låta dem ligga kvar. Detsamma gäller
  // IndexedDB-lagrets formatversion (stora JSON-cachar bor där, inte i localStorage).
  useEffect(() => {
    void ensureIdbVersion();
    const prefix = "parksthlm-stockholm-open-data-";
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(prefix)) continue;
      const versionInKey = Number(key.match(/-all-v(\d+)$/)?.[1] ?? Number.NaN);
      if (Number.isFinite(versionInKey)) {
        if (versionInKey !== OFFICIAL_DATA_CACHE_VERSION) localStorage.removeItem(key);
        continue;
      }
      try {
        const parsed = JSON.parse(localStorage.getItem(key) ?? "") as { version?: number };
        if (parsed.version !== OFFICIAL_DATA_CACHE_VERSION) localStorage.removeItem(key);
      } catch {
        localStorage.removeItem(key);
      }
    }
  }, []);

  const parkedCarTariff = parkedCar && isTariffId(parkedCar.tariff) ? parkedCar.tariff : null;
  const parkedCarMoment = useMemo(() => new Date(clock), [clock]);
  const parkedCarPrice = useMemo(
    () => (parkedCarTariff ? getCurrentPrice(parkedCarTariff, parkedCarMoment) : null),
    [parkedCarMoment, parkedCarTariff],
  );
  const parkedCarChange = useMemo(
    () => (parkedCarTariff ? nextPriceChange(parkedCarTariff, parkedCarMoment) : null),
    [parkedCarMoment, parkedCarTariff],
  );
  // Bara taxor med en gratisperiod har något att påminna om.
  const parkedCarFreeBoundary = useMemo(
    () => (parkedCarTariff ? nextFreeBoundary(parkedCarTariff, parkedCarMoment) : null),
    [parkedCarMoment, parkedCarTariff],
  );
  const parkedCarStatus = useMemo(() => {
    if (!parkedCar) return null;
    if (!parkedCarPrice) return "Taxan är inte karterad här – kontrollera skyltningen på gatan.";
    if (!parkedCarChange) return "Samma avgift dygnet runt.";
    const when = `${formatClock(parkedCarChange.at)} om ${formatDuration(parkedCarChange.at.getTime() - clock)}`;
    if (parkedCarPrice.amount === 0) return `Avgift ${parkedCarChange.amount} kr/tim börjar ${when}.`;
    if (parkedCarChange.amount === 0) return `Gratis parkering från ${when}.`;
    return `Avgiften ändras till ${parkedCarChange.amount} kr/tim ${when}.`;
  }, [clock, parkedCar, parkedCarChange, parkedCarPrice]);

  // Synka Dark Mode i DOM:en
  useEffect(() => {
    localStorage.setItem("parksthlm-dark", String(darkMode));
    if (darkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    // Håll webbläsarens/telefonens färg överens med appens tema.
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", darkMode ? "#0b1119" : "#1266ee");
  }, [darkMode]);

  // Den inbyggda appens statusrad: ljus text ovanpå appens egen yta.
  useEffect(() => {
    void setNativeStatusBar();
  }, []);

  // Skalet runt webbvyn i den inbyggda appen: startbilden tas bort när appen är redo.
  useEffect(() => {
    void initNativeShell();
  }, []);

  // Skapa virtuell parkeringsplats för klickad koordinat för rutt/navigering
  const clickedPlace = useMemo<ParkingPlace | null>(() => {
    if (!clickedPosition) return null;
    const tariffLookup = tariffAtPosition(clickedPosition);
    return {
      id: "clicked-pos",
      name: clickedAddress || "Vald kartposition",
      address: clickedAddress ? `${clickedPosition[0].toFixed(5)}, ${clickedPosition[1].toFixed(5)}` : "Position på kartan",
      area: tariffLookup ? `Stockholm · Taxa ${tariffLookup.tariff}` : "Stockholm",
      lat: clickedPosition[0],
      lng: clickedPosition[1],
      kind: "street",
      tariff: tariffLookup?.tariff ?? null,
      free: false,
      priceText: tariffLookup ? getCurrentPrice(tariffLookup.tariff).label : "Pris ej verifierat",
      note: tariffLookup
        ? tariffLookup.street
          ? `Taxa ${tariffLookup.tariff} enligt gatumarkeringen för ${tariffLookup.street}. Kontrollera alltid skylten på plats.`
          : `Taxa ${tariffLookup.tariff} enligt Stockholms stads taxeområde för den här punkten. Kontrollera alltid skylten på plats.`
        : "Punkten ligger utanför de karterade taxeområdena. Kontrollera alltid skyltar och betalningsapp på plats.",
      source: "local"
    };
  }, [clickedPosition, clickedAddress]);
  const clickedNavigation = clickedPlace ? navigationLinks(clickedPlace.lat, clickedPlace.lng) : null;
  const clickedTariff = clickedPlace?.tariff ?? null;

  const showNotice = useCallback((message: string, action: NoticeAction | null = null) => {
    setNotice(message);
    setNoticeAction(action);
    // En notis med åtgärd ligger kvar lite längre, så att Ångra hinns med.
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(null);
      setNoticeAction(null);
      noticeTimerRef.current = null;
    }, action ? 6500 : 3600);
  }, []);

  // Det finns ingen serverbaserad push i den här versionen, så påminnelsen skapas medan
  // appen körs. På webben blir den en webbläsarnotis, i den inbyggda appen en riktig
  // systemnotis från iOS (se src/native.ts).
  const notifyParkedCar = useCallback((message: string, tag: string) => {
    showNotice(message);
    void showNotification("Din parkerade bil", message, tag);
  }, [showNotice]);

  // Påminnelse: avgiftsändringar som rör gratis parkering är de som betyder något –
  // antingen att gratisperioden tar slut eller att den börjar.
  useEffect(() => {
    if (!parkedCar?.reminder || !parkedCarTariff) return;
    const lead = reminderLeadOf(parkedCar);
    const now = new Date(clock);
    const boundary = nextFreeBoundary(parkedCarTariff, now);
    if (!boundary) return;
    const minutesLeft = (boundary.at.getTime() - now.getTime()) / 60_000;
    if (minutesLeft > lead || minutesLeft < 0) return;
    if (parkingReminderFiredRef.current === boundary.at.getTime()) return;
    parkingReminderFiredRef.current = boundary.at.getTime();
    const message = boundary.amount === 0
      ? `Gratis parkering från ${formatClock(boundary.at)}.`
      : `Avgiften börjar ${formatClock(boundary.at)} med ${boundary.amount} kr/tim – flytta bilen eller betala.`;
    notifyParkedCar(message, "parksthlm-parked-car");
  }, [clock, notifyParkedCar, parkedCar, parkedCarTariff]);

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
    const cached = await readJsonCache<{ timestamp: number; places: ParkingPlace[] }>(cacheKey);
    if (cached && Array.isArray(cached.places) && Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
      setAllParking((previous) => mergePlacesById(previous, cached.places));
      loadedGlobalOsmRef.current.add(dataset);
      return cached.places.length;
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
    void writeJsonCache(cacheKey, { timestamp: Date.now(), places });
    return places.length;
  }, []);

  const fetchApiParking = useCallback(async (force = false) => {
    const CACHE_KEY = "parksthlm-api-v4";
    if (!force) {
      const cached = await readJsonCache<{ timestamp: number; places: ParkingPlace[]; version?: number }>(CACHE_KEY);
      if (cached) {
        if (cached.version !== 4) {
          void deleteJsonCache(CACHE_KEY);
        } else {
          if (Array.isArray(cached.places)) setAllParking((prev) => replaceSource(prev, "api", cached.places));
          if (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000 || !navigator.onLine) return;
        }
      }
    }
    if (!navigator.onLine) return;
    try {
      const payload = await fetchJsonWithBundledFallback("/api/stockholm-parking", "stockholm-parking.json");
      const places = parseApiParking(payload);
      setAllParking((prev) => replaceSource(prev, "api", places));
      void writeJsonCache(CACHE_KEY, { timestamp: Date.now(), version: 4, places });
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
      const cached = await readJsonCache<{ timestamp: number; places: ParkingPlace[]; version?: number }>(cacheKey);
      // Versionen höjs när tolkningen av föreskrifterna ändras, så att gamla cachade poster rensas.
      if (cached?.version === OFFICIAL_DATA_CACHE_VERSION && Array.isArray(cached.places) && Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
        return cached.places;
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
        void writeJsonCache(cacheKey, { timestamp: Date.now(), version: OFFICIAL_DATA_CACHE_VERSION, places });
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
      const cacheKey = `parksthlm-stockholm-open-data-${rule}-all-v${OFFICIAL_DATA_CACHE_VERSION}`;
      const cached = await readJsonCache<{ timestamp: number; places: ParkingPlace[] }>(cacheKey);
      if (cached && Array.isArray(cached.places) && Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
        loadedGlobalRulesRef.current.add(rule);
        globalRuleCountsRef.current.set(rule, cached.places.length);
        return cached.places;
      }

      const payload = await fetchJsonWithBundledFallback(
        `/api/stockholm-open-data/${rule}?all=true`,
        `${rule}.json`,
      );
      const places = parseOfficialRuleParking(payload, rule);
      loadedGlobalRulesRef.current.add(rule);
      globalRuleCountsRef.current.set(rule, places.length);
      void writeJsonCache(cacheKey, { timestamp: Date.now(), places });
      return places;
    }));
    const places = results.flat();
    setAllParking((previous) => replaceOfficialRules(previous, missingRules, places));
    return rules.reduce((sum, rule) => sum + (globalRuleCountsRef.current.get(rule) ?? 0), 0);
  }, []);

  const fetchEvCharging = useCallback(async () => {
    if (!navigator.onLine) return;
    const key = "parksthlm-ev-v3";
    const cached = await readJsonCache<{ timestamp: number; places: ParkingPlace[]; version?: number }>(key);
    if (cached?.version === 2 && Array.isArray(cached.places)) {
      setAllParking((prev) => replaceSource(prev, "osm-ev", cached.places));
      if (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) return;
    }
    try {
      const q = `[out:json][timeout:120];nwr["amenity"="charging_station"](${STOCKHOLM_DATA_BBOX});out center tags;`;
      const payload = await fetchOverpass(q);
      const places = parseOsmParking(payload)
        .filter((place) => (place.evSpaces ?? 0) > 0)
        .map((place): ParkingPlace => ({ ...place, source: "osm-ev" }));
      void writeJsonCache(key, { timestamp: Date.now(), version: 2, places });
      setAllParking((prev) => replaceSource(prev, "osm-ev", places));
    } catch { /* silent */ }
  }, []);

  const fetchOcmCharging = useCallback(async () => {
    if (!navigator.onLine) return;
    const key = "parksthlm-ocm-v2";
    const cached = await readJsonCache<{ timestamp: number; places: ParkingPlace[]; version?: number }>(key);
    let ocmPlaces: ParkingPlace[] | null = null;
    if (cached?.version === 3 && Array.isArray(cached.places)) {
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
      void writeJsonCache(key, { timestamp: Date.now(), version: 3, places: ocmPlaces });
    } catch { /* silent */ }
  }, []);

  const fetchNobilCharging = useCallback(async () => {
    if (!navigator.onLine) return;
    const key = "parksthlm-nobil-v2";
    const cached = await readJsonCache<{ timestamp: number; places: ParkingPlace[]; version?: number }>(key);
    if (cached?.version === 2 && Array.isArray(cached.places)) {
      setAllParking((prev) => replaceSource(prev, "nobil", cached.places));
      if (Date.now() - cached.timestamp < 60 * 60 * 1000) return;
    }

    try {
      const payload = await fetchJsonWithBundledFallback("/api/nobil", "nobil.json", { method: "POST" });
      const places = parseNobilParking(payload);
      setAllParking((prev) => replaceSource(prev, "nobil", places));
      void writeJsonCache(key, { timestamp: Date.now(), version: 2, places });
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
    // Den inbyggda appen är redan installerad – den ska aldrig be om att bli tillagd på
    // hemmaskärmen, och dess yta räknas som standalone.
    const nativeApp = isNativeApp();
    setIsStandalone(isStandaloneMode || nativeApp);

    const shouldOfferInstall = !nativeApp && isMobileDevice() && !isStandaloneMode && !hasRecentPwaInstallDismissal();
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
    let cancelled = false;

    const map = new MapLibreMap({
      container: mapNodeRef.current,
      style: OSM_RASTER_STYLE,
      center: toLngLat(STOCKHOLM_CENTER),
      zoom: 13,
      minZoom: 10,
      maxZoom: 19,
      maxPitch: 60,
      pitch: 0,
      bearing: 0,
      attributionControl: { compact: true },
      fadeDuration: 0,
      // På webben undefined (service workern sköter offline-kartan), i den inbyggda appen
      // en krok som läser sparade kartrutor från telefonens IndexedDB.
      transformRequest: nativeTileRequestTransform(),
    });
    mapRef.current = map;
    applyMap3dInteractions(map, map3dRef.current);

    map.on("load", () => {
      if (cancelled) return;
      // Basvägar som syns även offline under de cachade kartrutorna.
      const baseFeatures: GeoFeature[] = OFFLINE_BASE_ROADS.map((positions) => ({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: positions.map(toLngLat) },
      }));
      map.addSource("offline-base", { type: "geojson", data: { type: "FeatureCollection", features: baseFeatures } });
      map.addLayer({ id: "offline-base-wide", type: "line", source: "offline-base", paint: { "line-color": "#c7d0d1", "line-width": 5, "line-opacity": 0.55 } });
      map.addLayer({ id: "offline-base-inner", type: "line", source: "offline-base", paint: { "line-color": "#f8faf9", "line-width": 2, "line-opacity": 0.95 } });

      // Taxeområdena ritas som rena bakgrundslager. Polygontäcken ligger ovanpå nästan hela
      // innerstaden, så om de fångade klick gick det inte att sätta den röda kartmarkören där.
      // Reglerna för ett område nås i stället via taxemärket i kortet för vald kartposition.
      const taxFeatures: GeoFeature[] = [...TAX_AREAS].sort((a, b) => b.tariff - a.tariff).map((area) => ({
        type: "Feature",
        properties: { color: TARIFFS[area.tariff].color },
        geometry: {
          type: "Polygon",
          coordinates: [[...area.positions.map(toLngLat), toLngLat(area.positions[0])]],
        },
      }));
      map.addSource("tax-areas", { type: "geojson", data: { type: "FeatureCollection", features: taxFeatures } });
      map.addLayer({ id: "tax-fill", type: "fill", source: "tax-areas", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.24 } });
      map.addLayer({ id: "tax-line", type: "line", source: "tax-areas", paint: { "line-color": ["get", "color"], "line-width": 1.8, "line-opacity": 0.88 } });

      // Föreskriftslinjer (gatusträckor) – datan fylls på av effekten nedan.
      map.addSource("street-rules", { type: "geojson", data: emptyFeatureCollection() });
      map.addLayer({ id: "street-casing", type: "line", source: "street-rules", paint: { "line-color": "#ffffff", "line-width": ["case", [">", ["get", "wide"], 0], 8, 7], "line-opacity": 0.9 } });
      map.addLayer({ id: "street-main", type: "line", source: "street-rules", paint: { "line-color": ["get", "color"], "line-width": ["case", [">", ["get", "wide"], 0], 4.8, 3.6], "line-opacity": 0.92 } });

      // GPS-noggrannhet som fylld cirkel runt positionen.
      map.addSource("accuracy", { type: "geojson", data: emptyFeatureCollection() });
      map.addLayer({ id: "accuracy-fill", type: "fill", source: "accuracy", paint: { "fill-color": "#3478f6", "fill-opacity": 0.08 } });

      // Rutten ritas ovanpå allt annat kartinnehåll.
      map.addSource("route", { type: "geojson", data: emptyFeatureCollection() });
      map.addLayer({ id: "route-casing", type: "line", source: "route", paint: { "line-color": "#ffffff", "line-width": 10, "line-opacity": 0.92 } });
      map.addLayer({ id: "route-line", type: "line", source: "route", paint: { "line-color": "#1266ee", "line-width": 6, "line-opacity": 1 } });

      mapReadyRef.current = true;
      setMapReady(true);
    });

    // Klick på en föreskriftslinje öppnar platsen – linjerna ligger över taxepolygonerna.
    map.on("click", "street-main", (event) => {
      const id = (event.features?.[0]?.properties as { id?: string } | undefined)?.id;
      const place = id ? streetPlaceByIdRef.current.get(id) : undefined;
      if (!place) return;
      setSelectedZone(null);
      setClickedPosition(null);
      setSelectedParking(place);
    });

    map.on("click", (event) => {
      const pos: LatLng = toLatLng(event.lngLat);
      
      setSelectedZone(null);
      setSelectedParking(null);
      setClickedPosition(pos);
      setClickedAddress(null);
      setSearchFocused(false);
      
      if (window.navigator.onLine) {
        setClickedLoading(true);
        fetch(`https://nominatim.openstreetmap.org/reverse?lat=${pos[0]}&lon=${pos[1]}&format=jsonv2&zoom=18&accept-language=sv`)
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
      setViewCenter(toLatLng(map.getCenter()));
      setMapZoom(map.getZoom());
    });

    // Körlägets zoom ("höjden") ska ligga kvar tills användaren ändrar den själv –
    // spara den så att nästa körning startar på samma höjd.
    map.on("zoomend", () => {
      if (routeInfoRef.current?.tracking) {
        const zoom = map.getZoom();
        drivingZoomRef.current = zoom;
        try {
          localStorage.setItem(DRIVING_ZOOM_KEY, String(zoom));
        } catch {
          /* lagring saknas – kör vidare utan att spara */
        }
      }
    });

    window.setTimeout(() => map.resize(), 100);
    return () => {
      cancelled = true;
      map.remove();
      mapRef.current = null;
      mapReadyRef.current = false;
      removeAllMarkers(parkingMarkersRef.current);
      clickMarkerRef.current?.remove();
      clickMarkerRef.current = null;
      searchMarkerRef.current?.remove();
      searchMarkerRef.current = null;
      parkedCarMarkerRef.current?.remove();
      parkedCarMarkerRef.current = null;
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      setMapReady(false);
    };
  }, []);

  // 2D/3D-läge: slå på/av rotation och lutning med gester. Stängs 3D av rätas
  // kartan upp direkt – nästa GPS-uppdatering i körläge håller den sedan platt.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map3dRef.current = map3dEnabled;
    applyMap3dInteractions(map, map3dEnabled);
    if (!map3dEnabled) map.easeTo({ pitch: 0, bearing: 0, duration: 300 });
  }, [map3dEnabled, mapReady]);

  const setMap3d = (enabled: boolean) => {
    setMap3dEnabled(enabled);
    writeMap3dEnabled(enabled);
    showNotice(enabled ? "3D-karta på – körläget lutas som Google Maps" : "2D-karta på – platt karta norr-upp");
  };

  // Hantera klickad markör på kartan reaktivt
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    clickMarkerRef.current?.remove();
    clickMarkerRef.current = null;
    if (clickedPosition) {
      const element = makeMarkerElement("click-marker-wrap", '<div class="click-marker"></div>');
      clickMarkerRef.current = new MapLibreMarker({ element, anchor: "bottom" })
        .setLngLat(toLngLat(clickedPosition))
        .addTo(map);
    }
  }, [clickedPosition, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    searchMarkerRef.current?.remove();
    searchMarkerRef.current = null;
    if (!searchPosition) return;
    const element = makeMarkerElement("search-marker-wrap", '<div class="search-marker" aria-label="Sökt adress"></div>');
    searchMarkerRef.current = new MapLibreMarker({ element, anchor: "bottom" })
      .setLngLat(toLngLat(searchPosition))
      .addTo(map);
  }, [searchPosition, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    parkedCarMarkerRef.current?.remove();
    parkedCarMarkerRef.current = null;
    if (!parkedCar) return;
    // Avståndet står på markören bara när vi vet var användaren är – annars vore det en gissning.
    const distanceLabel = userPosition
      ? formatDistance(distanceKm(userPosition, [parkedCar.lat, parkedCar.lng]))
      : undefined;
    const { className, html } = parkedCarIcon(distanceLabel);
    const element = makeMarkerElement(className, html);
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      setParkedCarOpen(true);
    });
    // Nålen längst ner på markören (se .parked-car-marker) ska peka på bilen.
    parkedCarMarkerRef.current = new MapLibreMarker({ element, anchor: "bottom", offset: [0, 6] })
      .setLngLat(toLngLat([parkedCar.lat, parkedCar.lng]))
      .addTo(map);
  }, [parkedCar, userPosition, mapReady]);

  const matchesCategory = useCallback((place: ParkingPlace) => {
    if (category === "all") return true;
    if (category === "free") return place.free && (place.evSpaces ?? 0) === 0;
    if (category === "garage") return place.kind === "garage" || (place.kind === "surface" && place.name !== "Parkering" && (place.evSpaces ?? 0) === 0 && !place.free && place.priceText !== "Pris ej verifierat");
    if (category === "street") return place.kind === "street" || place.kind === "surface";
    if (category === "disabled") return (place.disabledSpaces ?? 0) > 0;
    if (category === "ev") {
      if ((place.evSpaces ?? 0) <= 0) return false;
      if (evMinPower > 0) {
        const connections = place.evConnections ?? [];
        if (connections.length === 0 || evMaxPower(place) < evMinPower) return false;
      }
      if (evConnector !== "all") {
        const connections = place.evConnections ?? [];
        if (connections.length === 0) return false;
        if (!connections.some((connection) => evConnectionGroups(connection.type).includes(evConnector))) return false;
      }
      return true;
    }
    if (category === "mc") return (place.mcSpaces ?? 0) > 0;
    if (category === "resident") return isResidentPermitPlace(place);
    return place.tariff === category;
  }, [category, evConnector, evMinPower]);

  const focusPosition = userPosition || searchPosition || viewCenter;
  const hasOfficialStreetData = allParking.some((place) => place.id.startsWith("stockholm-open-data-ptillaten-"));
  // Adressberikningen görs i en memo i stället för i en effekt som skriver tillbaka till
  // samma state – annars renderas hela trädet två gånger per datamängdsändring.
  const displayParking = useMemo(() => addNearbyStreetAddresses(allParking), [allParking]);
  const serviceTonightByPlace = useMemo(() => {
    if (!serviceTonightOnly) return null;
    const now = new Date(clock);
    const occurrences = new Map<string, ServiceOccurrence>();
    displayParking.forEach((place) => {
      if (!place.serviceText) return;
      const occurrence = nextServiceOccurrence(place.serviceText, now, SERVICE_TONIGHT_HOURS);
      if (occurrence) occurrences.set(place.id, occurrence);
    });
    return occurrences;
  }, [clock, displayParking, serviceTonightOnly]);
  const residentDistricts = useMemo(() => {
    const districts = new Set<string>();
    displayParking.forEach((place) => {
      if (isResidentPermitPlace(place)) districts.add(officialDistrictOf(place));
    });
    return [...districts].sort((first, second) => first.localeCompare(second, "sv"));
  }, [displayParking]);
  const filteredParking = useMemo(
    () => dedupeDisplayParking(
      displayParking.filter((place) =>
        !(hasOfficialStreetData && place.source === "local" && place.kind === "street")
        && (!limitToArea || !areaScope || isWithinArea(place, areaScope))
        && matchesCategory(place)
        && (category !== "resident" || residentDistrict === "all" || officialDistrictOf(place) === residentDistrict)
        && (!serviceTonightOnly || serviceTonightByPlace?.has(place.id)),
      ),
      category,
    ),
    [areaScope, category, displayParking, hasOfficialStreetData, limitToArea, matchesCategory, residentDistrict, serviceTonightByPlace, serviceTonightOnly],
  );
  const feeCalculation = useMemo(() => {
    const start = new Date(calcStartInput);
    const end = new Date(calcEndInput);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
      return { calculation: null as TariffFeeCalculation | null, error: "Välj både start och sluttid." };
    }
    if (end.getTime() <= start.getTime()) {
      return { calculation: null as TariffFeeCalculation | null, error: "Sluttiden måste vara efter starttiden." };
    }
    return { calculation: calculateTariffFee(calcTariff, start, end), error: null as string | null };
  }, [calcEndInput, calcStartInput, calcTariff]);
  const parkedCarServiceWarning = useMemo(() => {
    if (!parkedCar) return null;
    return findServiceWarningNear(displayParking, parkedCar.lat, parkedCar.lng, new Date(clock), SERVICE_WARNING_HOURS);
  }, [clock, displayParking, parkedCar]);

  useEffect(() => {
    if (!parkedCar?.reminder || !parkedCarServiceWarning) return;
    const leadMs = reminderLeadOf(parkedCar) * 60 * 1000;
    const msLeft = parkedCarServiceWarning.occurrence.start.getTime() - clock;
    if (msLeft < 0 || msLeft > leadMs) return;
    if (serviceReminderFiredRef.current === parkedCarServiceWarning.occurrence.start.getTime()) return;
    serviceReminderFiredRef.current = parkedCarServiceWarning.occurrence.start.getTime();
    notifyParkedCar(
      `Servicetid ${formatServiceOccurrence(parkedCarServiceWarning.occurrence, new Date(clock))}: ${parkedCarServiceWarning.place.address}. Flytta bilen i tid.`,
      "parksthlm-service-warning",
    );
  }, [clock, notifyParkedCar, parkedCar, parkedCarServiceWarning]);
  const selectedParkingTariff = selectedParking && isTariffId(selectedParking.tariff) ? selectedParking.tariff : null;
  const selectedParkingCopy = selectedParking ? placeListCopy(selectedParking) : null;
  // Föreskrivna taxor utanför appens taxa 1–5 (taxa 11–14 m.m.) beskrivs med en hel
  // mening i källan. Beloppet får plats i faktarutan, men hela skrivningen behöver en
  // egen rad – annars blir "Pris" en textvägg i en smal kolumn.
  const selectedParkingOfficialRate = selectedParking && !selectedParking.free && !selectedParkingTariff
    && selectedParking.priceText.length > 40
    ? selectedParking.priceText
    : null;
  // P-skivepanelen visas när man öppnat den, eller när en nedräkning redan räknar ner
  // på just den här platsen.
  const discPanelPinned = selectedParking != null && discTimer != null && discTimer.placeId === selectedParking.id;
  const discPanelOpen = discEnabled && (discOpen || discPanelPinned);
  const selectedNavigation = selectedParking ? navigationLinks(selectedParking.lat, selectedParking.lng) : null;
  const selectedResidentPermit = selectedParking ? residentPermitOf(selectedParking.priceText) : null;
  const selectedServiceOccurrence = selectedParking?.serviceText
    ? nextServiceOccurrence(selectedParking.serviceText, new Date(clock), 7 * 24)
    : null;
  const selectedEvOperator = selectedParking && (selectedParking.evSpaces ?? 0) > 0
    ? evOperatorForName(selectedParking.name)
    : null;

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
        } else if (nextCategory === "resident") {
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
    const center = toLatLng(map.getCenter());
    const mapBounds = map.getBounds();
    const bounds = {
      north: mapBounds.getNorth(),
      south: mapBounds.getSouth(),
      east: mapBounds.getEast(),
      west: mapBounds.getWest(),
    };
    // Kartvyn kan vara större än vad datakällorna klarar. Vi hämtar då den största
    // tillåtna radien i stället för att neka – knappen ska alltid göra något.
    const visibleRadiusKm = distanceKm(center, [bounds.north, bounds.east]);
    const clampedToMaxRadius = visibleRadiusKm > MAX_AREA_RADIUS_KM;
    const scope: AreaScope = {
      center,
      label: clampedToMaxRadius ? `kartans mitt (max ${MAX_AREA_RADIUS_KM} km)` : "aktuell kartvy",
      radiusKm: Math.min(MAX_AREA_RADIUS_KM, Math.max(AREA_SEARCH_RADIUS_KM, visibleRadiusKm)),
    };
    setAreaScope(scope);
    setLimitToArea(true);
    setAreaLoading(true);
    const officialRules: OfficialRule[] = category === "mc"
      ? ["pmotorcykel"]
      : category === "disabled"
        ? ["prorelsehindrad"]
        : category === "all" || category === "street" || category === "free" || category === "resident" || typeof category === "number"
          ? ["ptillaten"]
          : [];
    try {
      await Promise.all([
        fetchNearbyOsmParking(scope),
        officialRules.length > 0 ? fetchOfficialRuleParking(officialRules, scope) : Promise.resolve(),
        category === "ev" ? Promise.all([fetchEvCharging(), fetchOcmCharging(), fetchNobilCharging()]) : Promise.resolve(),
      ]);
      showNotice(clampedToMaxRadius
        ? `Kartvyn täcker mer än ${MAX_AREA_RADIUS_KM} km. Visar ${categoryLabel(category).toLowerCase()} inom ${Math.round(scope.radiusKm)} km från mitten – zooma in för fler platser.`
        : `Visar ${categoryLabel(category).toLowerCase()} i aktuell kartvy`);
    } catch {
      showNotice("All parkeringsdata i kartvyn kunde inte hämtas. Sparad data visas.");
    } finally {
      setAreaLoading(false);
    }
  }, [category, fetchEvCharging, fetchNearbyOsmParking, fetchNobilCharging, fetchOcmCharging, fetchOfficialRuleParking, showNotice]);


  useEffect(() => {
    if (category !== "mc") {
      lastMcFitCountRef.current = 0;
      return;
    }

    const map = mapRef.current;
    const motorcyclePlaces = filteredParking.filter((place) => (place.mcSpaces ?? 0) > 0);
    if (!map || motorcyclePlaces.length < 2 || motorcyclePlaces.length <= lastMcFitCountRef.current) return;

    lastMcFitCountRef.current = motorcyclePlaces.length;
    map.fitBounds(boundsOf(motorcyclePlaces.map((place) => [place.lat, place.lng] as LatLng)), {
      padding: 52,
      maxZoom: 11,
    });
  }, [category, filteredParking]);

  const searchMatches = useMemo(() => {
    const needle = normalize(query);
    const places = filteredParking.filter((place) => {
      if (!needle) return true;
      return normalize(`${place.name} ${place.address} ${place.area} ${place.kind} ${place.tariff ? `taxa ${place.tariff}` : "gratis"}`).includes(needle);
    });
    return collapseIdenticalEntries(places)
      .map((place) => ({ place, distance: distanceKm(focusPosition, [place.lat, place.lng] as LatLng) }))
      .sort((a, b) => a.distance - b.distance);
  }, [filteredParking, focusPosition, query]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const source = map.getSource("street-rules") as unknown as { setData: (data: GeoFeatureCollection) => void } | undefined;
    if (!source) return;
    if (!areaScope || !limitToArea) {
      streetPlaceByIdRef.current = new Map();
      source.setData(emptyFeatureCollection());
      return;
    }

    const matches = filteredParking.filter((place) => place.source === "stockholm-open-data" && (place.positions?.length ?? 0) >= 2);
    streetPlaceByIdRef.current = new Map(matches.map((place) => [place.id, place]));
    // Klick på linjen öppnar platsen direkt (hanteras i kartinitieringen) –
    // hover-texterna från Leaflet är borttagna, all info finns i kortet.
    const features: GeoFeature[] = matches.map((place) => ({
      type: "Feature",
      properties: { id: place.id, color: placeColor(place), wide: (place.disabledSpaces ?? 0) > 0 ? 1 : 0 },
      geometry: { type: "LineString", coordinates: place.positions!.map(toLngLat) },
    }));
    source.setData({ type: "FeatureCollection", features });
  }, [areaScope, filteredParking, limitToArea, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const bounds = map.getBounds();
    const southWest = bounds.getSouthWest();
    const northEast = bounds.getNorthEast();
    const latPad = (northEast.lat - southWest.lat) * 0.12;
    const lngPad = (northEast.lng - southWest.lng) * 0.12;
    const south = southWest.lat - latPad;
    const north = northEast.lat + latPad;
    const west = southWest.lng - lngPad;
    const east = northEast.lng + lngPad;
    const placesInView = filteredParking.filter(
      (place) => place.lat >= south && place.lat <= north && place.lng >= west && place.lng <= east,
    );
    // När kartan är utzoomad och inget filter är valt visas bara namngivna platser,
    // garage och den lokala listan – annars dränks kartan av anonyma gatuparkeringsrader.
    // Väljer användaren ett filter (t.ex. handikapp) visas alltid hela urvalet.
    const showEverySource = mapZoom >= 14 || category !== "all";
    let markerPlaces = showEverySource
      ? placesInView
      : placesInView.filter((place) => markerPriority(place) <= 2);
    // Stora datamängder skulle ge tusentals DOM-markörer och hackig karta. När antalet
    // överstiger taket behålls en markör per rutnät (ca 280 m) så att markörerna sprids
    // jämnt över kartvyn i stället för att klumpa ihop sig – resten syns när man zoomar in.
    if (markerPlaces.length > MAX_VISIBLE_MARKERS) {
      const cellSize = 0.0025;
      const usedCells = new Set<string>();
      markerPlaces = [...markerPlaces]
        .sort((first, second) => {
          if (serviceTonightOnly && serviceTonightByPlace) {
            const serviceOrder = Number(!serviceTonightByPlace.has(first.id)) - Number(!serviceTonightByPlace.has(second.id));
            if (serviceOrder !== 0) return serviceOrder;
          }
          return markerPriority(first) - markerPriority(second)
            || distanceKm(viewCenter, [first.lat, first.lng]) - distanceKm(viewCenter, [second.lat, second.lng]);
        })
        .filter((place) => {
          const cell = `${Math.floor(place.lat / cellSize)}:${Math.floor(place.lng / cellSize)}`;
          if (usedCells.has(cell)) return false;
          usedCells.add(cell);
          return true;
        })
        .slice(0, MAX_VISIBLE_MARKERS);
    }
    placeByIdRef.current = new Map(markerPlaces.map((place) => [place.id, place]));
    syncMarkers(parkingMarkersRef.current, map, (id) => {
      const place = placeByIdRef.current.get(id);
      if (!place) return null;
      const { className, html } = parkingIcon(place, selectedParking?.id === id);
      const element = makeMarkerElement(className, html);
      element.title = place.name;
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        const current = placeByIdRef.current.get(id);
        if (!current) return;
        setSelectedZone(null);
        setClickedPosition(null);
        setSearchFocused(false);
        setSelectedParking(current);
      });
      return { element, lngLat: toLngLat([place.lat, place.lng]), anchor: "bottom" };
    }, markerPlaces.map((place) => place.id));
    // Vald markör växer – uppdatera markeringen utan att bygga om alla markörer.
    for (const [id, marker] of parkingMarkersRef.current) {
      marker.getElement().firstElementChild?.classList.toggle("is-selected", selectedParking?.id === id);
    }
  }, [category, filteredParking, mapZoom, selectedParking, serviceTonightByPlace, serviceTonightOnly, viewCenter, mapReady]);

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
      if (points.length) mapRef.current.fitBounds(boundsOf(points), { padding: 70, maxZoom: 13 });
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
    if (["boende", "boendeparkering", "resident"].includes(normalize(value))) {
      selectCategory("resident");
      setQuery("");
      return;
    }
    if (["stadnatt", "servicetid", "servicedag", "service"].includes(normalize(value))) {
      setServiceTonightOnly(true);
      setPanelOpen(true);
      setQuery("");
      showNotice("Visar gator med tolkad servicetid inom det närmaste dygnet");
      return;
    }

    if (searchMatches.length > 0) {
      const closest = searchMatches[0].place;
      mapRef.current?.flyTo({ center: toLngLat([closest.lat, closest.lng]), zoom: 16, duration: 1150 });
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
    mapRef.current?.flyTo({ center: toLngLat(position), zoom: 16, duration: 1200 });
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

  const updateUserLocation = useCallback((next: LatLng, accuracy: number, followRoute = false, gpsHeading?: number | null) => {
    setUserPosition(next);
    setSearchPosition(null);
    // Riktning: GPS-heading i första hand, annars bäring från förra punkten när bilen
    // rört sig, annars bäring mot nästa ruttpunkt. Behåll senaste riktningen vid stillastående.
    if (followRoute) {
      let heading = headingRef.current;
      const movedFromLast = lastPosRef.current ? distanceKm(lastPosRef.current, next) * 1000 : Number.POSITIVE_INFINITY;
      if (gpsHeading != null && Number.isFinite(gpsHeading) && (movedFromLast > 5 || lastPosRef.current == null)) {
        heading = ((gpsHeading % 360) + 360) % 360;
      } else if (lastPosRef.current) {
        const movedMeters = distanceKm(lastPosRef.current, next) * 1000;
        if (movedMeters > 6) heading = bearingBetween(lastPosRef.current, next);
        else {
          const activeRoute = routeInfoRef.current;
          if (activeRoute?.positions?.length) {
            const { nearestMeters } = routeProgress(next, activeRoute.positions);
            if (nearestMeters < 200) {
              let nearestIndex = 0;
              let best = Number.POSITIVE_INFINITY;
              activeRoute.positions.forEach((routePosition, index) => {
                const meters = distanceKm(next, routePosition) * 1000;
                if (meters < best) {
                  best = meters;
                  nearestIndex = index;
                }
              });
              const ahead = activeRoute.positions[Math.min(nearestIndex + 2, activeRoute.positions.length - 1)];
              if (ahead && distanceKm(next, ahead) * 1000 > 8) heading = bearingBetween(next, ahead);
            }
          }
        }
      }
      headingRef.current = heading;
    }
    lastPosRef.current = next;
    const map = mapRef.current;
    if (map && mapReadyRef.current) {
      const accuracySource = map.getSource("accuracy") as unknown as { setData: (data: GeoFeatureCollection) => void } | undefined;
      accuracySource?.setData({
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          properties: {},
          geometry: { type: "Polygon", coordinates: circlePolygon(next, Math.min(accuracy, 220)) },
        }],
      });
      // I körläge: modern bil med nos i färdriktningen. Annars: vanlig blå prick.
      const { className, html } = followRoute ? drivingCarIcon(headingRef.current) : userIcon();
      const element = makeMarkerElement(className, html);
      element.title = followRoute ? "Din bil – körläge" : "Din position";
      userMarkerRef.current?.remove();
      userMarkerRef.current = new MapLibreMarker({ element }).setLngLat(toLngLat(next)).addTo(map);
    }
    // Följ bilen men rör aldrig zoomen här – höjden bestämmer du själv med +/– och den
    // ligger kvar tills du ändrar den igen. I 3D-läge lutas kartan och vrids efter
    // färdriktningen som i Google Maps/Waze; i 2D-läge hålls den platt och norr-upp.
    if (followRoute && map) {
      if (map3dRef.current) {
        map.easeTo({ center: toLngLat(next), bearing: headingRef.current, pitch: DRIVING_PITCH, duration: 500 });
      } else {
        map.easeTo({ center: toLngLat(next), bearing: 0, pitch: 0, duration: 500 });
      }
    }
  }, []);

  const locateUser = () => {
    setLocating(true);
    void getCurrentLocation().then(
      (position) => {
        const next: LatLng = [position.lat, position.lng];
        updateUserLocation(next, position.accuracy);
        setClickedPosition(null);
        setLocating(false);
        mapRef.current?.flyTo({ center: toLngLat(next), zoom: 16, duration: 1200 });
        showNotice("GPS-position hittad");
      },
      (error: unknown) => {
        setLocating(false);
        showNotice(error instanceof Error && error.message === "geolocation-missing"
          ? "Din webbläsare saknar stöd för GPS"
          : "Kunde inte läsa din position. Kontrollera platsbehörigheten.");
      },
    );
  };

  const calculateRoute = useCallback(async (destination: ParkingPlace, start: LatLng, tracking: boolean) => {
    setRouteLoading(true);
    const map = mapRef.current;
    const routeSource = map?.getSource("route") as unknown as { setData: (data: GeoFeatureCollection) => void } | undefined;
    routeSource?.setData(emptyFeatureCollection());
    const drawRoute = (positions: LatLng[], fallback: boolean, distance: number, minutes: number, steps: NavigationStep[] = []) => {
      routeSource?.setData({
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: positions.map(toLngLat) },
        }],
      });
      // Streckad linje när bara fågelvägen kan visas (offline).
      // Heldragen linje normalt ([1, 0] = streck utan mellanrum), streckad för fågelvägen.
      map?.setPaintProperty("route-line", "line-dasharray", fallback ? [2, 2.2] : [1, 0]);
      const willTrack = tracking && !fallback;
      if (willTrack) {
        // Körläge: starta på din sparade höjd i stället för att zooma ut till hela rutten.
        // Omdirigeringar under körning rör inte zoomen alls.
        const isReroute = routeInfoRef.current?.tracking === true;
        if (!isReroute) {
          map?.flyTo({
            center: toLngLat(positions[0]),
            zoom: drivingZoomRef.current,
            bearing: map3dRef.current ? headingRef.current : 0,
            pitch: map3dRef.current ? DRIVING_PITCH : 0,
            duration: 1000,
          });
        }
      } else {
        map?.fitBounds(boundsOf(positions), { padding: { top: 90, bottom: 170, left: 420, right: 70 }, maxZoom: 17 });
      }
      setRouteInfo({ distance, minutes, fallback, destination, positions, steps, currentStep: 0, remainingMeters: distance * 1000, tracking: willTrack, arrived: false });
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
    const map = mapRef.current;
    const wasTracking = routeInfoRef.current?.tracking === true;
    (map?.getSource("route") as unknown as { setData: (data: GeoFeatureCollection) => void } | undefined)?.setData(emptyFeatureCollection());
    // Räta upp kartan igen efter körläget – men bara om vi faktiskt körde, så att en
    // manuellt lutad/vriden karta i normalläge lämnas orörd.
    if (wasTracking) map?.easeTo({ pitch: 0, bearing: 0, duration: 500 });
    setRouteInfo(null);
  };

  const buildRoute = (destination: ParkingPlace) => {
    if (userPosition) {
      void calculateRoute(destination, userPosition, true);
      return;
    }
    setRouteLoading(true);
    void getCurrentLocation().then(
      (position) => {
        const start: LatLng = [position.lat, position.lng];
        updateUserLocation(start, position.accuracy);
        void calculateRoute(destination, start, true);
      },
      () => {
        showNotice("GPS nekades. Rutten startar från kartans mitt.");
        void calculateRoute(destination, viewCenter, false);
      },
    );
  };

  useEffect(() => {
    if (!routeInfo?.tracking || routeInfo.arrived) return;
    const stopWatching = watchLocation(
      (position) => {
        const next: LatLng = [position.lat, position.lng];
        updateUserLocation(next, position.accuracy, true, position.heading);
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
    );
    return stopWatching;
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
    trackEvent(isStandalone ? "Offline-data sparad" : "Spara offline");
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
      const map = mapRef.current;
      setOfflineTiles(map ? collectOfflineTileUrls({
        north: map.getBounds().getNorth(),
        south: map.getBounds().getSouth(),
        east: map.getBounds().getEast(),
        west: map.getBounds().getWest(),
      }) : []);
      setOfflineDialogOpen(true);
    }
  };

  const startOfflineDownload = async () => {
    if (offlineProgress) return;  // Already downloading
    setOfflineDialogOpen(false);
    const urls = offlineTiles;
    if (!urls.length) { showNotice("Kunde inte beräkna kartrutor."); return; }
    if (urls.length > MAX_OFFLINE_TILES) {
      showNotice(`Området är för stort för offline-nedladdning. Zooma in och försök igen (max ${MAX_OFFLINE_TILES} rutor).`);
      return;
    }
    setOfflineProgress({ cached: 0, total: urls.length });
    const finishOffline = () => {
      localStorage.setItem("parksthlm-offline-ready", "true");
      setOfflineReady(true);
      setOfflineProgress(null);
      showNotice("Offline-läge klart!");
    };

    // Den inbyggda appen körs på capacitor:// och har ingen service worker. Där sparas
    // kartrutorna i telefonens IndexedDB i stället och läses tillbaka via
    // transformRequest (se src/tile-cache.ts) – offline-läget fungerar likadant.
    if (isNativeApp()) {
      try {
        await downloadTiles(urls, (cached, total) => setOfflineProgress({ cached, total }));
        finishOffline();
      } catch {
        setOfflineProgress(null);
        showNotice("Misslyckades att starta nedladdning.");
      }
      return;
    }

    try {
      const registration = await navigator.serviceWorker!.ready;
      const handler = (e: MessageEvent) => {
        if (e.data?.type === "OFFLINE_PROGRESS") {
          setOfflineProgress({ cached: e.data.cached, total: e.data.total });
          if (e.data.cached >= e.data.total) {
            navigator.serviceWorker.removeEventListener("message", handler);
            finishOffline();
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
    mapRef.current?.flyTo({ center: toLngLat([place.lat, place.lng]), zoom: Math.max(mapRef.current?.getZoom() ?? 15, 15), duration: 800 });
  };

  const isFavorite = (place: ParkingPlace) => favorites.some((favorite) => favorite.id === place.id);

  const toggleFavorite = (place: ParkingPlace) => {
    if (isFavorite(place)) {
      setFavorites((current) => current.filter((favorite) => favorite.id !== place.id));
      showNotice("Parkeringen togs bort från favoriter");
      return;
    }
    setFavorites((current) => [...current, place]);
    trackEvent("Favorit sparad");
    showNotice("Parkeringen sparades som favorit");
  };

  const showFavorite = (place: ParkingPlace) => {
    setFavoritesOpen(false);
    setPanelOpen(false);
    showParking(place);
  };

  // Delbar länk till en parkering: ?spot=<id>&lat=...&lng=...&title=...
  // Id:t öppnar exakt plats i appen, koordinaterna är reserv om datan saknas.
  const shareUrlFor = (place: ParkingPlace) => {
    const params = new URLSearchParams({
      spot: place.id,
      lat: place.lat.toFixed(5),
      lng: place.lng.toFixed(5),
      title: place.name,
    });
    return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
  };

  const shareParking = async (place: ParkingPlace) => {
    const price = place.free
      ? "Gratis"
      : isTariffId(place.tariff)
        ? `${placeTariffLabel(place)} – ${getCurrentPrice(place.tariff).label}`
        : place.priceText;
    const text = `${place.name}\n${place.address}, ${place.area}\n${price}\n${shareUrlFor(place)}`;
    trackEvent("Delade parkering");
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

  // Delad parkering via URL (?spot=<id>&lat=..&lng=..&title=..). Id:t pekar ut exakt
  // plats när datan finns, koordinaterna är reserv så att länken alltid fungerar.
  const [sharedSpot] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const spot = params.get("spot") || undefined;
      const latParam = params.get("lat");
      const lngParam = params.get("lng");
      const lat = Number(latParam);
      const lng = Number(lngParam);
      // Utan parametrar blir Number(null) = 0, vilket såg ut som en delad plats i
      // nollpunkten i Atlanten. Koordinater kräver därför att båda parametrarna finns.
      const hasCoords = latParam !== null && lngParam !== null
        && Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);
      if (!spot && !hasCoords) return null;
      return { spot, lat, lng, hasCoords, title: params.get("title")?.trim() || "Delad parkering" };
    } catch {
      return null;
    }
  });
  // En delad plats läggs till som en vanlig plats i kartan och listan i stället för att
  // dyka upp som ett öppet kort. Användaren väljer själv när platsen ska öppnas, parkeras
  // på eller delas vidare med dela-knappen.
  const sharedAddedRef = useRef(false);
  useEffect(() => {
    if (!sharedSpot || sharedAddedRef.current || !mapReady) return;
    const byId = sharedSpot.spot ? allParking.find((place) => place.id === sharedSpot.spot) : undefined;
    // Id utan koordinater som ännu inte finns i datan: vänta på fler dataladdningar.
    if (!byId && !sharedSpot.hasCoords) return;
    sharedAddedRef.current = true;
    trackEvent("Öppnade delad länk", { kanda: Boolean(byId) });
    if (byId) {
      setAllParking((current) => current.some((place) => place.id === byId.id) ? current : [...current, byId]);
      showNotice(`Delad parkering finns i listan: ${byId.name}`);
    } else {
      const place: ParkingPlace = {
        id: sharedSpot.spot ?? `shared-${sharedSpot.lat.toFixed(5)}-${sharedSpot.lng.toFixed(5)}`,
        name: sharedSpot.title,
        address: `${sharedSpot.lat.toFixed(5)}, ${sharedSpot.lng.toFixed(5)}`,
        area: "Stockholm",
        lat: sharedSpot.lat,
        lng: sharedSpot.lng,
        kind: "surface",
        tariff: null,
        free: false,
        priceText: "Delad plats",
        note: "Platsen delades via länk. Kontrollera skyltningen på plats.",
        source: "local",
      };
      setAllParking((current) => current.some((item) => item.id === place.id) ? current : [...current, place]);
      showNotice(`Delad parkering tillagd i kartan och listan: ${place.name}`);
    }
    try {
      window.history.replaceState(null, "", window.location.pathname);
    } catch {
      // Historik saknas – lämna URL:en orörd.
    }
  }, [allParking, mapReady, sharedSpot, showNotice]);

  // Delade platser och kartpunkter har bara koordinater som adress – visa namnet först
  // så att platsen går att känna igen även i bilkortet.
  const coordOnlyAddress = selectedParking ? /^[-\d.]+,\s*[-\d.]+$/.test(selectedParking.address) : false;
  const parkedCarCandidate = selectedParking
    ? {
      lat: selectedParking.lat,
      lng: selectedParking.lng,
      address: coordOnlyAddress
        ? `${selectedParking.name} · ${selectedParking.address}`
        : `${selectedParking.address}, ${selectedParking.area}`,
      source: "parking" as const,
    }
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

  // Taxan på den plats som sparas: den valda parkeringen om det finns en, annars
  // taxekartan/gatumarkeringarna vid positionen. Snapshoten gör att nedräkningen
  // fungerar även efter att data hämtats på nytt eller telefonen varit offline.
  const parkedCarCandidateTariff = useMemo(() => {
    if (parkedCarCandidate.source === "parking" && selectedParking) {
      return isTariffId(selectedParking.tariff) ? selectedParking.tariff : null;
    }
    return tariffAtPosition([parkedCarCandidate.lat, parkedCarCandidate.lng])?.tariff ?? null;
  }, [parkedCarCandidate.lat, parkedCarCandidate.lng, parkedCarCandidate.source, selectedParking]);

  const parkedCarCandidateLabel = useMemo(() => {
    if (parkedCarCandidateTariff === null) return null;
    if (parkedCarCandidate.source === "parking" && selectedParking) return `Taxa ${parkedCarCandidateTariff} enligt kartan`;
    const point = tariffAtPosition([parkedCarCandidate.lat, parkedCarCandidate.lng]);
    return point?.street ? `Taxa ${parkedCarCandidateTariff} · ${point.street}` : `Taxa ${parkedCarCandidateTariff} enligt taxekartan`;
  }, [parkedCarCandidate.lat, parkedCarCandidate.lng, parkedCarCandidate.source, parkedCarCandidateTariff, selectedParking]);

  const saveParkedCar = () => {
    const savedAt = Date.now();
    const candidateWarning = findServiceWarningNear(
      displayParking,
      parkedCarCandidate.lat,
      parkedCarCandidate.lng,
      new Date(savedAt),
      SERVICE_WARNING_HOURS,
    );
    setParkedCar({
      ...parkedCarCandidate,
      savedAt,
      note: parkedCarNote.trim(),
      spot: parkedCarSpot.trim(),
      tariff: parkedCarCandidateTariff,
      tariffLabel: parkedCarCandidateLabel,
      // Påminnelsevalet följer med mellan parkeringar – den som vill ha påminnelse vill ha det varje gång.
      reminder: parkedCar?.reminder ?? false,
      reminderLead: reminderLeadOf(parkedCar),
      reg: vehicleReg || null,
    });
    setParkedCarEditing(false);
    trackEvent("Bilens plats sparad", { kalla: parkedCarCandidate.source });
    const savedMessage = parkedCarCandidateTariff
      ? `Bilens plats sparades · ${getCurrentPrice(parkedCarCandidateTariff).label}`
      : "Bilens plats sparades";
    showNotice(candidateWarning
      ? `${savedMessage} · Servicetid ${formatServiceOccurrence(candidateWarning.occurrence, new Date(savedAt))}: ${candidateWarning.place.address}`
      : savedMessage);
  };

  const toggleParkingReminder = () => {
    if (!parkedCar) return;
    const next = !parkedCar.reminder;
    setParkedCar({ ...parkedCar, reminder: next, reminderLead: reminderLeadOf(parkedCar) });
    if (!next) {
      showNotice("Påminnelsen är avstängd");
      return;
    }
    // Behörigheten frågas bara om när påminnelsen faktiskt slås på: webbläsarnotis på
    // webben, riktig systemnotis i den inbyggda appen.
    void requestNotificationPermission();
    showNotice(`Påminnelse på · ${reminderLeadOf(parkedCar)} min innan avgiften ändras eller servicetiden börjar`);
  };

  const startDiscTimer = () => {
    if (!selectedParking) return;
    setDiscTimer({
      endsAt: Date.now() + discMinutes * 60_000,
      minutes: discMinutes,
      placeId: selectedParking.id,
      placeName: selectedParking.name,
    });
    discWarnedRef.current = null;
    discFiredRef.current = null;
    trackEvent("P-skiva startad", { minuter: discMinutes });
    // Behörigheten frågas bara om när påminnelsen faktiskt slås på: webbläsarnotis på
    // webben, riktig systemnotis i den inbyggda appen.
    void requestNotificationPermission();
    showNotice(`P-skiva startad · ${formatDuration(discMinutes * 60_000)} – du får en notis när tiden går ut`);
  };

  const cancelDiscTimer = () => {
    setDiscTimer(null);
    // Ingen nedräkning kvar att visa – fäll ihop rutan igen så att kortet blir kompakt.
    setDiscOpen(false);
    showNotice("P-skivan avbröts");
  };

  // Stänger av eller slår på P-skivan. Avstängd betyder att blocket med maxtid och timer
  // försvinner från alla platskort och att en pågående nedräkning tas bort, så att inga
  // P-skivepåminnelser kommer.
  const setDiscTimerEnabled = (enabled: boolean) => {
    setDiscEnabled(enabled);
    localStorage.setItem(DISC_ENABLED_STORAGE_KEY, enabled ? "true" : "false");
    if (enabled) {
      // Tillbaka till den kompakta knappen, inte en utfälld ruta.
      setDiscOpen(false);
      showNotice("P-skiva påslagen – P-skiveknappen visas på platskorten");
      return;
    }
    if (discTimer) setDiscTimer(null);
    trackEvent("P-skiva avstängd");
    // Ett misstryck ska gå att ångra direkt, annars ligger inställningen kvar under Bil.
    showNotice("P-skiva avstängd – slå på igen under Bil", {
      label: "Ångra",
      run: () => setDiscTimerEnabled(true),
    });
  };

  // P-skiva: varna 10 min innan och notifiera när tiden går ut. Appen måste vara öppen.
  useEffect(() => {
    if (!discTimer) return;
    const msLeft = discTimer.endsAt - clock;
    if (msLeft <= 0) {
      if (discFiredRef.current === discTimer.endsAt) return;
      discFiredRef.current = discTimer.endsAt;
      notifyParkedCar(`P-skivan har gått ut (${discTimer.placeName}). Flytta bilen.`, "parksthlm-disc");
      return;
    }
    if (msLeft <= DISC_WARN_MINUTES * 60_000 && discWarnedRef.current !== discTimer.endsAt) {
      discWarnedRef.current = discTimer.endsAt;
      notifyParkedCar(`${DISC_WARN_MINUTES} min kvar på P-skivan (${discTimer.placeName}).`, "parksthlm-disc-warn");
    }
  }, [clock, discTimer, notifyParkedCar]);

  const setReminderLead = (lead: ReminderLeadMinutes) => {
    if (!parkedCar) return;
    setParkedCar({ ...parkedCar, reminder: true, reminderLead: lead });
    parkingReminderFiredRef.current = null;
    serviceReminderFiredRef.current = null;
    showNotice(`Påminnelse ${lead} min innan avgiften ändras eller servicetiden börjar`);
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
    mapRef.current?.flyTo({ center: toLngLat([parkedCar.lat, parkedCar.lng]), zoom: 17, duration: 800 });
  };

  const saveVehicleProfile = () => {
    const reg = normalizeReg(vehicleRegDraft);
    setVehicleProfile(vehicleProfileDraft);
    localStorage.setItem(VEHICLE_PROFILE_STORAGE_KEY, JSON.stringify(vehicleProfileDraft));
    setVehicleReg(reg);
    localStorage.setItem(VEHICLE_REG_STORAGE_KEY, JSON.stringify(reg));
    selectCategory(VEHICLE_PROFILES[vehicleProfileDraft].filter);
    setVehicleProfileOpen(false);
    showNotice(`${VEHICLE_PROFILES[vehicleProfileDraft].label} sparad${reg ? ` · ${reg}` : ""} – relevant filter är aktivt`);
  };

  // Escape stänger det översta öppna lagret (modal, kort eller körläge) i den ordning
  // användaren förväntar sig – samma sak som att trycka på stäng-knappen.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (offlineDialogOpen) setOfflineDialogOpen(false);
      else if (pwaInstallOpen) dismissPwaInstall();
      else if (vehicleProfileOpen) setVehicleProfileOpen(false);
      else if (parkedCarOpen) setParkedCarOpen(false);
      else if (favoritesOpen) setFavoritesOpen(false);
      else if (infoOpen) setInfoOpen(false);
      else if (selectedParking) setSelectedParking(null);
      else if (clickedPosition) setClickedPosition(null);
      else if (selectedZone) setSelectedZone(null);
      else if (routeInfo) clearRoute();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clickedPosition, dismissPwaInstall, favoritesOpen, infoOpen, offlineDialogOpen, parkedCarOpen, pwaInstallOpen, routeInfo, selectedParking, selectedZone, vehicleProfileOpen]);

  // Flytta in fokus i dialogen när den öppnas och tillbaka till knappen som öppnade den.
  const anyDialogOpen = favoritesOpen || parkedCarOpen || vehicleProfileOpen || infoOpen || offlineDialogOpen || pwaInstallOpen;
  useEffect(() => {
    if (!anyDialogOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
      const dialog = dialogs[dialogs.length - 1];
      const target = dialog?.querySelector<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])');
      (target ?? dialog)?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      previousFocus?.focus();
    };
  }, [anyDialogOpen]);

  // Prisbilden just nu är gemensam för hela listan – räkna den en gång per sortering.
  const priceNowByTariff = useMemo(() => {
    const now = new Date();
    const amounts = new Map<TariffId, number>();
    ([1, 2, 3, 4, 5] as TariffId[]).forEach((tariffId) => amounts.set(tariffId, getCurrentPrice(tariffId, now).amount));
    return amounts;
  }, [clock, resultSort]);

  const sortOptions = category === "ev" ? EV_RESULT_SORTS : RESULT_SORTS;

  useEffect(() => {
    if (category !== "ev" && resultSort === "power") setResultSort("distance");
  }, [category, resultSort]);

  const sortedResults = useMemo(() => {
    if (resultSort === "distance") return searchMatches;
    if (resultSort === "power") {
      return [...searchMatches].sort((first, second) => evMaxPower(second.place) - evMaxPower(first.place) || first.distance - second.distance);
    }
    const amountOf = (place: ParkingPlace) => {
      if (place.free) return 0;
      // Okarterad taxa sorteras sist i stället för att hamna överst som "0 kr".
      return isTariffId(place.tariff) ? priceNowByTariff.get(place.tariff)! : Number.POSITIVE_INFINITY;
    };
    const sorted = [...searchMatches];
    if (resultSort === "price") {
      sorted.sort((first, second) => amountOf(first.place) - amountOf(second.place) || first.distance - second.distance);
    } else {
      sorted.sort((first, second) => (isFreeNow(second.place, priceNowByTariff) ? 1 : 0) - (isFreeNow(first.place, priceNowByTariff) ? 1 : 0) || first.distance - second.distance);
    }
    return sorted;
  }, [priceNowByTariff, resultSort, searchMatches]);

  const resultKey = `${category}|${query}|${limitToArea ? areaScope?.label ?? "" : ""}|${serviceTonightOnly ? "service" : "all"}|${residentDistrict}|${evMinPower}|${evConnector}|${resultSort}`;
  const resultLimit = resultWindow.key === resultKey ? resultWindow.limit : RESULTS_PAGE_SIZE;
  const visibleResults = sortedResults.slice(0, resultLimit);
  const hiddenResultCount = sortedResults.length - visibleResults.length;

  return (
    <main className={`app-shell ${online ? "is-online" : "is-offline"}`}>
      <div ref={mapNodeRef} className="map-canvas" aria-label="Karta över parkeringsplatser och taxeområden i Stockholm" />

      <section className={`map-panel ${panelOpen ? "panel-open" : ""}`} aria-label="Parkeringssökning">
        <header className="brand-row">
          <button className="mobile-menu" type="button" onClick={() => setPanelOpen((open) => !open)} aria-label="Öppna meny">
            {panelOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <button className="brand" type="button" onClick={() => mapRef.current?.flyTo({ center: toLngLat(STOCKHOLM_CENTER), zoom: 13, duration: 1000 })}>
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
          <button className={category === "resident" ? "active" : ""} onClick={() => selectCategory("resident")} type="button">Boende</button>
          <button className={serviceTonightOnly ? "active" : ""} onClick={() => { setServiceTonightOnly((active) => !active); setPanelOpen(true); }} type="button" aria-pressed={serviceTonightOnly}><Clock3 size={15} /> Städnatt</button>
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
              {category === "resident" && residentDistricts.length > 0 ? (
                <div className="resident-filter">
                  <label>
                    <span>Boendeområde</span>
                    <select value={residentDistrict} onChange={(event) => setResidentDistrict(event.target.value)} aria-label="Välj boendeområde">
                      <option value="all">Alla boendeområden</option>
                      {residentDistricts.map((district) => (
                        <option key={district} value={district}>{district}</option>
                      ))}
                    </select>
                  </label>
                  <small>Områdena kommer från stadsdelsnamnen i föreskrifterna. Boendetaxan visas per plats eftersom den kan skilja sig mellan taxor.</small>
                </div>
              ) : null}
              <div className="fee-calculator" aria-label="P-avgiftskalkylator">
                <div className="filter-heading"><span>P-avgiftskalkylator</span><small>Exakt timpris</small></div>
                <div className="calculator-inputs">
                  <label><span>Från</span><input type="datetime-local" value={calcStartInput} onChange={(event) => setCalcStartInput(event.target.value)} aria-label="Beräkna från" /></label>
                  <label><span>Till</span><input type="datetime-local" value={calcEndInput} onChange={(event) => setCalcEndInput(event.target.value)} aria-label="Beräkna till" /></label>
                  <label><span>Taxa</span>
                    <select value={calcTariff} onChange={(event) => setCalcTariff(Number(event.target.value) as TariffId)} aria-label="Välj taxa för kalkylatorn">
                      {([1, 2, 3, 4, 5] as TariffId[]).map((tariff) => (
                        <option key={tariff} value={tariff}>Taxa {tariff}</option>
                      ))}
                    </select>
                  </label>
                </div>
                {feeCalculation.error ? (
                  <p className="calculator-error">{feeCalculation.error}</p>
                ) : feeCalculation.calculation ? (
                  <>
                    <p className="calculator-total">Beräknad avgift <strong>{formatFeeAmount(feeCalculation.calculation.total)}</strong></p>
                    <ul className="calculator-segments">
                      {feeCalculation.calculation.segments.slice(0, 12).map((segment, index) => (
                        <li key={`${segment.start.getTime()}-${index}`}>
                          <span>{formatClock(segment.start)}–{formatClock(segment.end)}</span>
                          <strong>{segment.amount === 0 ? "Gratis" : `${segment.amount} kr/tim`}</strong>
                        </li>
                      ))}
                    </ul>
                    {feeCalculation.calculation.segments.length > 12 ? (
                      <small className="calculator-more">Dessutom {feeCalculation.calculation.segments.length - 12} prisperioder.</small>
                    ) : null}
                    {feeCalculation.calculation.capped ? (
                      <p className="calculator-error">Intervallet kapades till {MAX_FEE_CALCULATION_DAYS} dagar.</p>
                    ) : null}
                  </>
                ) : null}
                <small className="calculator-note">Beräknas på taxans timpris i fem minuters steg. Betalningsappar kan avrunda uppåt och max tid kan vara kortare.</small>
              </div>
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

              {category === "ev" ? (
                <div className="ev-advanced" aria-label="Avancerat elbilfilter">
                  <label><span>Min effekt</span>
                    <select value={evMinPower} onChange={(event) => setEvMinPower(Number(event.target.value))} aria-label="Filtrera på minsta laddeffekt">
                      <option value={0}>Alla effekter</option>
                      <option value={11}>minst 11 kW</option>
                      <option value={22}>minst 22 kW</option>
                      <option value={50}>Snabbladdare, minst 50 kW</option>
                      <option value={150}>minst 150 kW</option>
                    </select>
                  </label>
                  <label><span>Kontakt</span>
                    <select value={evConnector} onChange={(event) => setEvConnector(event.target.value as EvConnectorFilter)} aria-label="Filtrera på laddkontakt">
                      <option value="all">Alla kontakter</option>
                      <option value="type2">Type 2</option>
                      <option value="ccs">CCS</option>
                      <option value="chademo">CHAdeMO</option>
                      <option value="tesla">Tesla</option>
                    </select>
                  </label>
                </div>
              ) : null}
              {category === "ev" && (evMinPower > 0 || evConnector !== "all") ? (
                <p className="ev-advanced-note">Platser utan kontaktuppgifter visas inte när effekt eller kontakt är vald.</p>
              ) : null}
              <div className="results-sort" role="group" aria-label="Sortera parkeringslistan">
                {sortOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={resultSort === option.value ? "active" : ""}
                    aria-pressed={resultSort === option.value}
                    onClick={() => setResultSort(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <div className="result-list">
                {visibleResults.map(({ place, distance }, index) => {
                  const copy = placeListCopy(place);
                  const freeNow = isFreeNow(place, priceNowByTariff);
                  const serviceOccurrence = serviceTonightByPlace?.get(place.id);
                  return (
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
                      <strong>{copy.heading}</strong>
                      <small>{copy.detail}</small>
                      <span>
                        <b className={freeNow ? "free" : ""}>{place.free ? "Avgiftsfri" : freeNow ? "Gratis nu" : placeTariffLabel(place)}</b>
                        <i>{placeKindLabel(place)}</i>
                        {serviceOccurrence ? <em className="service-warning">{formatServiceOccurrence(serviceOccurrence, new Date(clock))}</em> : null}
                      </span>
                    </span>
                    <span className="result-distance">{formatDistance(distance)}<Navigation size={14} /></span>
                  </motion.button>
                  );
                })}
                {hiddenResultCount > 0 && (
                  <button
                    type="button"
                    className="show-more-results"
                    onClick={() => setResultWindow({ key: resultKey, limit: resultLimit + RESULTS_PAGE_SIZE })}
                  >
                    <ChevronDown size={15} /> Visa fler · {visibleResults.length} av {sortedResults.length}
                  </button>
                )}
                {visibleResults.length === 0 && (
                  <div className="empty-results">
                    <Search size={25} />
                    <strong>Ingen parkering matchar</strong>
                    <span>{serviceTonightOnly ? "Ingen tolkad servicetid börjar inom det närmaste dygnet i det här urvalet. Stäng av Städnatt för att se alla platser." : category === "resident" ? "Inga boendeplatser matchar det valda området. Välj ett annat boendeområde eller Alla boendeområden." : "Prova en adress eller välj ett annat filter."}</span>
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
        <button type="button" className="utility-control profile-control" onClick={() => { setVehicleProfileDraft(vehicleProfile); setVehicleRegDraft(vehicleReg); setVehicleProfileOpen(true); }} aria-label={`Fordonsprofil, ${VEHICLE_PROFILES[vehicleProfile].label}`} title="Fordonsprofil" data-mobile-label="Profil">
          <Settings2 size={17} /> <span>{VEHICLE_PROFILES[vehicleProfile].label}</span>
        </button>
        <button type="button" onClick={() => setInfoOpen(true)} aria-label="Information"><Info size={18} /></button>
      </div>

      <div className={`map-controls${routeInfo?.tracking ? " is-driving" : ""}`} aria-label="Kartkontroller">
        <button type="button" onClick={() => mapRef.current?.zoomIn()} aria-label="Zooma in"><ZoomIn size={20} /></button>
        <button type="button" onClick={() => mapRef.current?.zoomOut()} aria-label="Zooma ut"><ZoomOut size={20} /></button>
        <button type="button" className={locating ? "locating" : ""} onClick={locateUser} aria-label="Hitta min position">
          {locating ? <RefreshCw className="spin" size={20} /> : <LocateFixed size={20} />}
        </button>
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
                <h2>{selectedParkingCopy?.heading}</h2>
                <p>
                  {selectedParkingCopy?.detail}
                  {selectedParkingCopy && !selectedParkingCopy.detail.includes(selectedParking.area) ? `, ${selectedParking.area}` : ""}
                </p>
                <span className="place-tariff" style={{ background: placeColor(selectedParking) }}>
                  {placeTariffLabel(selectedParking)}
                </span>
              </div>
            </div>
            <div className="place-facts">
              <div className="place-fact"><small>Pris</small><strong>{selectedParking.free ? "Gratis" : selectedParkingTariff ? getCurrentPrice(selectedParkingTariff).label : compactPriceText(selectedParking.priceText)}</strong></div>
              <div className="place-fact"><small>Avstånd</small><strong>{formatDistance(distanceKm(focusPosition, [selectedParking.lat, selectedParking.lng]))}</strong></div>
              {selectedParking.spaces ? <div className="place-fact"><small>Platser</small><strong>{selectedParking.spaces}</strong></div> : null}
              {(selectedParking.disabledSpaces ?? 0) > 0 ? <div className="place-fact"><small>Handikapp</small><strong>{selectedParking.disabledSpaces} plats{selectedParking.disabledSpaces !== 1 ? "er" : ""}</strong></div> : null}
              {(selectedParking.mcSpaces ?? 0) > 0 ? <div className="place-fact"><small>MC</small><strong>{selectedParking.mcSpaces} plats{selectedParking.mcSpaces !== 1 ? "er" : ""}</strong></div> : null}
              {(selectedParking.evSpaces ?? 0) > 0 ? (
                <div className="place-ev-details">
                  <div className="place-ev-header"><Zap size={16} /><small>Elladdning</small><strong>{selectedParking.evSpaces} plats{selectedParking.evSpaces !== 1 ? "er" : ""}</strong></div>
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
                  {!selectedParking.evConnections ? <span className="place-ev-missing">Ingen detaljerad information om laddkontakter finns tillgänglig för denna plats.</span> : null}
                  {selectedEvOperator ? (
                    <div className="place-ev-operator">
                      <small>Trolig operatör</small>
                      <strong>{selectedEvOperator.label}</strong>
                      <div className="operator-actions">
                        <button type="button" onClick={() => openExternalUrl(selectedEvOperator.site)}><ExternalLink size={15} /> Operatörens karta</button>
                        <button type="button" onClick={() => openExternalUrl(isIosDevice() ? selectedEvOperator.ios : selectedEvOperator.android)}><ExternalLink size={15} /> {isIosDevice() ? "App Store" : "Google Play"}</button>
                      </div>
                      <span>Operatören sköter laddning och betalning. Parkeringsregler kan vara separata.</span>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            {selectedParking.source === "api" && selectedParking.kind === "garage" ? (
              <p className="occupancy-note"><strong>Beläggning:</strong> live saknas i öppna data. Kapaciteten ovan är total kapacitet, inte lediga platser just nu.</p>
            ) : null}
            {selectedParkingOfficialRate ? (
              <div className="rate-card">
                <CircleAlert size={17} />
                <div>
                  <small>Avgift enligt föreskrift</small>
                  <strong>{selectedParkingOfficialRate}</strong>
                </div>
              </div>
            ) : null}
            {selectedParking.serviceText ? (
              <div className="service-day-card">
                <Clock3 size={18} />
                <div>
                  <small>Städgata / servicetid</small>
                  <strong>{selectedParking.serviceText}</strong>
                  {selectedServiceOccurrence ? (
                    <span>{`Nästa tolkade tillfälle: ${formatServiceOccurrence(selectedServiceOccurrence, new Date(clock))}. Gäller den markerade gatusträckan.`}</span>
                  ) : (
                    <span>Schemat kunde inte tolkas automatiskt. Gäller den markerade gatusträckan.</span>
                  )}
                  <span>Kontrollera alltid vägmärket på plats.</span>
                </div>
              </div>
            ) : null}
            {selectedResidentPermit ? (
              <div className="rate-card resident-card">
                <MapPin size={17} />
                <div>
                  <small>Boendeparkering enligt föreskriften</small>
                  <strong>{selectedResidentPermit.unavailable ? "Ingen boendeparkering på den här platsen" : `${selectedResidentPermit.monthly ?? "–"} kr/månad eller ${selectedResidentPermit.daily ?? "–"} kr/dygn`}</strong>
                  <span>Tillståndskrav och område kontrolleras mot skyltningen. Taxan kommer från föreskriftstexten i appen.</span>
                </div>
              </div>
            ) : null}
            {discPanelOpen ? (
              <div className="disc-card">
                <TimerIcon size={17} />
                <div>
                  <small>P-skiva / maxtid</small>
                  {selectedParking.maxMinutes ? (
                    <strong>Max {formatDuration(selectedParking.maxMinutes * 60_000)} enligt skyltning</strong>
                  ) : (
                    <strong>Ingen maxtid rapporterad – välj tid manuellt</strong>
                  )}
                  {discTimer && discTimer.placeId === selectedParking.id ? (
                    <span className="disc-active">P-skiva igång · {discTimer.endsAt > clock ? `${formatDuration(discTimer.endsAt - clock)} kvar` : "tiden är ute – flytta bilen"}</span>
                  ) : null}
                  <div className="disc-presets" role="group" aria-label="Välj P-skivetid">
                    {DISC_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        className={discMinutes === preset ? "active" : ""}
                        aria-pressed={discMinutes === preset}
                        onClick={() => setDiscMinutes(preset)}
                      >
                        {formatDuration(preset * 60_000)}
                      </button>
                    ))}
                  </div>
                  {discTimer && discTimer.placeId === selectedParking.id ? (
                    <button type="button" onClick={cancelDiscTimer}>Avbryt P-skiva</button>
                  ) : (
                    <button type="button" className="modal-action" onClick={startDiscTimer}><TimerIcon size={16} /> Starta P-skiva · {formatDuration(discMinutes * 60_000)}</button>
                  )}
                  <span>Kontrollera alltid vägmärket på plats. Appen måste vara öppen för notisen.</span>
                  <div className="disc-card-actions">
                    {discPanelPinned ? null : (
                      <button type="button" className="disc-off" onClick={() => setDiscOpen(false)}><ChevronUp size={14} /> Dölj</button>
                    )}
                    <button type="button" className="disc-off" onClick={() => setDiscTimerEnabled(false)}><BellOff size={14} /> Visa inte P-skiva</button>
                  </div>
                </div>
              </div>
            ) : discEnabled ? (
              <button type="button" className="disc-add" onClick={() => setDiscOpen(true)} aria-expanded={false}>
                <ParkingDiscIcon size={22} />
                <span>
                  <strong>P-skiva</strong>
                  <small>
                    {selectedParking.maxMinutes
                      ? `Maxtid ${formatDuration(selectedParking.maxMinutes * 60_000)} enligt skyltning · lägg till påminnelse`
                      : "Lägg till maxtid och påminnelse när tiden går ut"}
                  </small>
                </span>
                <ChevronDown size={17} />
              </button>
            ) : (
              <button type="button" className="disc-restore" onClick={() => setDiscTimerEnabled(true)}>
                <BellOff size={14} /> P-skiva avstängd · Slå på
              </button>
            )}
            <p className="place-note"><CircleAlert size={15} />{selectedParkingTariff ? TARIFFS[selectedParkingTariff].hours : selectedParking.note}</p>
            {(selectedParkingTariff || selectedParking.source === "api") && selectedNavigation ? (
              <div className="payment-card">
                <small>Betala parkering</small>
                <strong>{selectedParkingTariff ? `Taxa ${selectedParkingTariff} – välj rätt zonkod i appen` : "Kontrollera anläggningens betalningsapp"}</strong>
                <div className="payment-actions">
                  {PARKING_PAYMENT_PROVIDERS.map((provider) => (
                    <button key={provider.id} type="button" title={provider.note} onClick={() => openExternalUrl(provider.url)}>
                      <ExternalLink size={15} /> {provider.label}
                    </button>
                  ))}
                  {["easypark", "parkster"].map((providerId) => (
                    <button key={`${providerId}-app`} type="button" onClick={() => openExternalUrl(isIosDevice() ? PARKING_PAYMENT_APP_URLS[providerId].ios : PARKING_PAYMENT_APP_URLS[providerId].android)}>
                      <ExternalLink size={15} /> {providerId === "easypark" ? "EasyPark" : "Parkster"}-appen
                    </button>
                  ))}
                </div>
                <span>Betala P är nedlagd sedan 2024. Stödet kan skilja sig mellan gator och anläggningar – zonkoden på skylten avgör.</span>
              </div>
            ) : null}
            <div className="place-actions">
              <button type="button" className="primary-action" onClick={() => void buildRoute(selectedParking)} disabled={routeLoading}>
                {routeLoading ? <RefreshCw className="spin" size={18} /> : <Navigation size={18} />} Navigera hit
              </button>
              {selectedNavigation ? (
                <>
                  <button type="button" onClick={() => openExternalUrl(selectedNavigation.google)}>
                    <ExternalLink size={17} /> Google
                  </button>
                  <button type="button" onClick={() => openExternalUrl(selectedNavigation.apple)}>
                    <MapPin size={17} /> Apple
                  </button>
                  <button type="button" onClick={() => openExternalUrl(selectedNavigation.waze)}>
                    <CarFront size={17} /> Waze
                  </button>
                </>
              ) : null}
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
        {clickedPosition && clickedPlace && !selectedZone && (
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
                {clickedTariff ? (
                  <button
                    type="button"
                    className="place-tariff is-button"
                    style={{ background: placeColor(clickedPlace) }}
                    onClick={() => setSelectedZone(clickedTariff)}
                    title={`Visa reglerna för taxa ${clickedTariff}`}
                  >
                    {placeTariffLabel(clickedPlace)} · visa regler
                  </button>
                ) : (
                  <span className="place-tariff" style={{ background: placeColor(clickedPlace) }}>
                    Taxa ej karterad
                  </span>
                )}
              </div>
            </div>
            <div className="place-facts">
              <div className="place-fact">
                <small>Pris just nu</small>
                <strong>
                  {clickedPlace.tariff ? getCurrentPrice(clickedPlace.tariff).label : clickedPlace.priceText}
                </strong>
              </div>
              <div className="place-fact">
                <small>Områdestaxa</small>
                <strong>{clickedPlace.tariff ? `Taxa ${clickedPlace.tariff}` : "Se skyltning"}</strong>
              </div>
              <div className="place-fact">
                <small>Avstånd</small>
                <strong>{formatDistance(distanceKm(focusPosition, [clickedPlace.lat, clickedPlace.lng]))}</strong>
              </div>
            </div>
            <p className="place-note"><CircleAlert size={15} />{clickedPlace.note}</p>
            {clickedPlace.tariff && clickedNavigation ? (
              <div className="payment-card">
                <small>Betala parkering</small>
                <strong>{`Taxa ${clickedPlace.tariff} – välj rätt zonkod i appen`}</strong>
                <div className="payment-actions">
                  {PARKING_PAYMENT_PROVIDERS.map((provider) => (
                    <button key={provider.id} type="button" title={provider.note} onClick={() => openExternalUrl(provider.url)}>
                      <ExternalLink size={15} /> {provider.label}
                    </button>
                  ))}
                </div>
                <span>Zonkoden på skylten avgör vilken app som gäller här.</span>
              </div>
            ) : null}
            <div className="place-actions">
              <button type="button" className="primary-action" onClick={() => void buildRoute(clickedPlace)} disabled={routeLoading}>
                {routeLoading ? <RefreshCw className="spin" size={18} /> : <Navigation size={18} />} Navigera hit
              </button>
              {clickedNavigation ? (
                <>
                  <button type="button" onClick={() => openExternalUrl(clickedNavigation.google)}>
                    <ExternalLink size={17} /> Google
                  </button>
                  <button type="button" onClick={() => openExternalUrl(clickedNavigation.apple)}>
                    <MapPin size={17} /> Apple
                  </button>
                  <button type="button" onClick={() => openExternalUrl(clickedNavigation.waze)}>
                    <CarFront size={17} /> Waze
                  </button>
                </>
              ) : null}
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
        {discTimer && (
          <motion.div className="route-banner disc-banner" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <span><TimerIcon size={20} /></span>
            <div>
              <small>{discTimer.endsAt > clock ? "P-skiva igång" : "P-skivan har gått ut"}</small>
              <strong>{discTimer.endsAt > clock ? `${formatDuration(discTimer.endsAt - clock)} kvar` : "Flytta bilen"} · {discTimer.placeName}</strong>
            </div>
            <button type="button" onClick={cancelDiscTimer} aria-label="Avbryt P-skiva"><X size={18} /></button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {favoritesOpen && (
          <motion.div className="modal-backdrop feature-modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setFavoritesOpen(false)}>
            <motion.section className="info-modal feature-modal" role="dialog" aria-modal="true" aria-labelledby="favorites-title" tabIndex={-1} initial={{ opacity: 0, y: 28, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 18 }} onClick={(event) => event.stopPropagation()}>
              <button className="sheet-close" type="button" onClick={() => setFavoritesOpen(false)} aria-label="Stäng"><X size={19} /></button>
              <span className="info-icon favorite-icon"><Heart size={23} fill="currentColor" /></span>
              <h2 id="favorites-title">Favoritparkeringar</h2>
              <p>Dina sparade platser finns kvar på den här enheten.</p>
              {favorites.length ? (
                <div className="saved-place-list">
                  {favorites.map((favorite) => {
                    const copy = placeListCopy(favorite);
                    return (
                    <div className="saved-place-row" key={favorite.id}>
                      <button type="button" className="saved-place-main" onClick={() => showFavorite(favorite)}>
                        <span style={{ "--place-color": placeColor(favorite) } as React.CSSProperties}><ParkingCircle size={17} /></span>
                        <span><strong>{copy.heading}</strong><small>{copy.detail} · {placeTariffLabel(favorite)}</small></span>
                        <Navigation size={16} />
                      </button>
                      <button type="button" className="saved-place-remove" onClick={() => toggleFavorite(favorite)} aria-label={`Ta bort ${favorite.name}`}><Trash2 size={16} /></button>
                    </div>
                    );
                  })}
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
            <motion.section className="info-modal feature-modal parked-car-modal" role="dialog" aria-modal="true" aria-labelledby="parked-car-title" tabIndex={-1} initial={{ opacity: 0, y: 28, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 18 }} onClick={(event) => event.stopPropagation()}>
              <button className="sheet-close" type="button" onClick={() => setParkedCarOpen(false)} aria-label="Stäng"><X size={19} /></button>
              <span className="info-icon parked-car-icon"><CarFront size={24} /></span>
              <h2 id="parked-car-title">Var parkerade jag?</h2>
              {parkedCar && !parkedCarEditing ? (
                <>
                  <p className="saved-car-status"><Clock3 size={15} /> Sparad {new Date(parkedCar.savedAt).toLocaleString("sv-SE", { dateStyle: "medium", timeStyle: "short" })}</p>
                  <div className={`car-price-card ${parkedCarPrice ? (parkedCarPrice.amount === 0 ? "is-free" : "is-paid") : "is-unknown"}`}>
                    <span className="car-price-amount">
                      {parkedCarPrice ? (parkedCarPrice.amount === 0 ? "Gratis just nu" : `${parkedCarPrice.amount} kr/tim just nu`) : "Taxa ej karterad här"}
                    </span>
                    <span className="car-price-next">{parkedCarStatus}</span>
                    {parkedCar.tariffLabel && <small>{parkedCar.tariffLabel}</small>}
                  </div>
                  {parkedCarServiceWarning ? (
                    <div className="service-day-card">
                      <Clock3 size={18} />
                      <div>
                        <small>Servicetid nära bilen</small>
                        <strong>{formatServiceOccurrence(parkedCarServiceWarning.occurrence, new Date(clock))}</strong>
                        <span>{parkedCarServiceWarning.place.address} · {parkedCarServiceWarning.place.serviceText}</span>
                        <span>Närmaste tolkade servicetid inom 75 meter. Kontrollera alltid vägmärket på plats.</span>
                      </div>
                    </div>
                  ) : null}
                  {parkedCarFreeBoundary || parkedCarServiceWarning ? (
                    <>
                      <button type="button" className={`reminder-toggle ${parkedCar.reminder ? "is-on" : ""}`} aria-pressed={parkedCar.reminder} onClick={toggleParkingReminder}>
                        {parkedCar.reminder ? <BellRing size={17} /> : <Bell size={17} />}
                        <span>
                          {parkedCar.reminder ? "Påminnelse är på" : parkedCarFreeBoundary ? "Påminn mig innan avgiften ändras" : "Påminn mig innan servicetiden börjar"}
                          <small>{parkedCar.reminder ? `Varnar ${reminderLeadOf(parkedCar)} min innan avgiften ändras eller servicetiden börjar. Appen måste vara öppen för systemnotisen.` : "Du får en notis i appen innan det händer."}</small>
                        </span>
                      </button>
                      {parkedCar.reminder ? (
                        <div className="reminder-leads" role="group" aria-label="Välj framförhållning för påminnelsen">
                          {REMINDER_LEAD_OPTIONS.map((lead) => (
                            <button
                              key={lead}
                              type="button"
                              className={reminderLeadOf(parkedCar) === lead ? "active" : ""}
                              aria-pressed={reminderLeadOf(parkedCar) === lead}
                              onClick={() => setReminderLead(lead)}
                            >
                              {lead} min
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  <div className="parked-car-details">
                    <div><small>Plats</small><strong>{parkedCar.address}</strong><span>{parkedCar.lat.toFixed(5)}, {parkedCar.lng.toFixed(5)}</span></div>
                    {parkedCar.reg && <div><small>Bil</small><strong className="reg-plate">{parkedCar.reg}</strong></div>}
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
                  <div className="candidate-location"><MapPin size={18} /><span><small>Sparas från {parkedCarCandidate.source === "parking" ? "vald parkering" : parkedCarCandidate.source === "gps" ? "GPS" : parkedCarCandidate.source === "search" ? "sökning" : "kartan"}</small><strong>{parkedCarCandidate.address}</strong>{parkedCarCandidateTariff && <em>{`Taxa ${parkedCarCandidateTariff} · ${getCurrentPrice(parkedCarCandidateTariff).label}`}</em>}</span></div>
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
            <motion.section className="info-modal feature-modal" role="dialog" aria-modal="true" aria-labelledby="vehicle-profile-title" tabIndex={-1} initial={{ opacity: 0, y: 28, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 18 }} onClick={(event) => event.stopPropagation()}>
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
              <h3 className="map-view-heading">Kartläge</h3>
              <p className="map-view-text">3D lutar kartan i körläge som Google Maps och Waze. 2D håller den alltid platt.</p>
              <div className="vehicle-profile-grid map-view-grid">
                <button type="button" className={map3dEnabled ? "active" : ""} onClick={() => setMap3d(true)}>
                  <span><BoxIcon size={20} /></span>
                  <strong>3D</strong><small>Lutad vy i körläge</small>
                </button>
                <button type="button" className={!map3dEnabled ? "active" : ""} onClick={() => setMap3d(false)}>
                  <span><MapIcon size={20} /></span>
                  <strong>2D</strong><small>Platt karta norr-upp</small>
                </button>
              </div>
              <h3 className="map-view-heading">P-skiva-timer</h3>
              <p className="map-view-text">Maxtid från skyltningen och en nedräkning visas på varje platskort. Stäng av om du inte vill ha P-skivepåminnelser.</p>
              <div className="vehicle-profile-grid map-view-grid">
                <button type="button" className={discEnabled ? "active" : ""} onClick={() => setDiscTimerEnabled(true)}>
                  <span><ParkingDiscIcon size={20} /></span>
                  <strong>På</strong><small>Knapp på platskorten</small>
                </button>
                <button type="button" className={!discEnabled ? "active" : ""} onClick={() => setDiscTimerEnabled(false)}>
                  <span><BellOff size={20} /></span>
                  <strong>Av</strong><small>Ingen P-skiva</small>
                </button>
              </div>
              <h3 className="map-view-heading">Registreringsnummer <small className="optional-tag">valfritt</small></h3>
              <p className="map-view-text">Visas på det sparade bilkortet. Praktiskt med flera bilar eller hyrbil.</p>
              <label className="reg-input-label">
                <input
                  value={vehicleRegDraft}
                  onChange={(event) => setVehicleRegDraft(normalizeReg(event.target.value))}
                  maxLength={7}
                  placeholder="T.ex. ABC123"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Registreringsnummer"
                />
              </label>
              <button type="button" className="modal-action" onClick={saveVehicleProfile}><Settings2 size={17} /> Spara och använd {VEHICLE_PROFILES[vehicleProfileDraft].label}</button>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {infoOpen && (
          <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setInfoOpen(false)}>
            <motion.section className="info-modal" role="dialog" aria-modal="true" aria-labelledby="info-title" tabIndex={-1} initial={{ opacity: 0, y: 28, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 18 }} onClick={(event) => event.stopPropagation()}>
              <button className="sheet-close" type="button" onClick={() => setInfoOpen(false)} aria-label="Stäng"><X size={19} /></button>
              <span className="info-icon"><Info size={24} /></span>
              <h2 id="info-title">Parkera smartare i Stockholm</h2>
              <p>Kartan visar Stockholms fem ordinarie taxeområden, gatuparkering, garage, markparkering och platser som är markerade som gratis.</p>
              <div className="info-list">
                <div><strong>Taxedata</strong><span>Prisnivåer och tider baseras på Stockholms stads publicerade taxor. Helgdagar och lokala avvikelser kan förekomma.</span></div>
                <div><strong>Live-parkering</strong><span>Kompletteras online från OpenStreetMap och sparas i telefonen för senare användning.</span></div>
                <div><strong>Servicetider</strong><span>Städnatt-filtret visar bara servicetider som kan tolkas maskinellt och börjar inom ett dygn. Sparade bilar varnas upp till 48 timmar i förväg. Vägmärket gäller alltid.</span></div>
                <div><strong>Boende</strong><span>Boendefiltret använder boendetaxan i föreskriftstexten. Tillståndets område och krav måste kontrolleras mot skyltning och stadens tillståndsregler.</span></div>
                <div><strong>Betalning</strong><span>Betala P är nedlagd. Platskortet länkar till officiella guider för EasyPark, Parkster och Stockholm Parkering eftersom zonkoden på skylten avgör.</span></div>
                <div><strong>Beläggning</strong><span>Inget öppet liveflöde för lediga platser hittades. Garage visar därför kapacitet, men inte grön/gul/röd beläggning.</span></div>
                <div><strong>Påminnelser</strong><span>Påminnelser skapas lokalt i telefonen och kräver att appen har varit öppen. I den inbyggda appen visas de som systemnotiser från iOS; det finns ingen serverbaserad push i den här versionen.</span></div>
                <div><strong>Offline</strong><span>App, taxor, lokala parkeringar, GPS och besökta kartvyer fungerar utan nät. Ny adressökning och vägrutt kräver internet.</span></div>
                <div><strong>Statistik</strong><span>Webbplatsen räknar anonymt antal besök och några få knapptryck (t.ex. P-skiva, dela och parkera här) för att utvecklaren ska se vad som används. Inga cookies, inga personuppgifter och ingen spårning av dig mellan olika sidor. Den inbyggda appen skickar ingen statistik alls.</span></div>
              </div>
              <div className="warning-box"><CircleAlert size={18} /><span><strong>Viktigt:</strong> Vägmärken och skyltning på plats gäller alltid före kartan. Kontrollera även servicedag, max tid och eventuella tillståndskrav.</span></div>
              <div className="source-links">
                <a href="https://parkering.stockholm/betala-parkering/taxeomraden-avgifter/" target="_blank" rel="noreferrer" onClick={(event) => { event.preventDefault(); openExternalUrl("https://parkering.stockholm/betala-parkering/taxeomraden-avgifter/"); }}>Stockholms stads taxor <ExternalLink size={14} /></a>
                <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" onClick={(event) => { event.preventDefault(); openExternalUrl("https://www.openstreetmap.org/copyright"); }}>OpenStreetMap <ExternalLink size={14} /></a>
                <a href="https://nrnworld.one/ParkeraiSthlm/privacy.html" target="_blank" rel="noreferrer" onClick={(event) => { event.preventDefault(); openExternalUrl("https://nrnworld.one/ParkeraiSthlm/privacy.html"); }}>Integritetspolicy <ExternalLink size={14} /></a>
              </div>
              <button type="button" className="modal-action" onClick={() => { void saveOffline(); setInfoOpen(false); }}><Download size={17} /> {offlineReady ? "Offline-data är sparad" : offlineProgress ? "Laddar ner..." : "Gör appen redo offline"}</button>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>

      {offlineDialogOpen && (
        <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOfflineDialogOpen(false)}>
          <motion.section className="info-modal" role="dialog" aria-modal="true" aria-labelledby="offline-dialog-title" tabIndex={-1} initial={{ opacity: 0, y: 28, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 18 }} onClick={(e) => e.stopPropagation()}>
            <button className="sheet-close" type="button" onClick={() => setOfflineDialogOpen(false)} aria-label="Stäng"><X size={19} /></button>
            <span className="info-icon"><Download size={24} /></span>
            <h2 id="offline-dialog-title">Ladda ner offline-karta?</h2>
            <p>Kartrutor för det aktuella området (zoom {OFFLINE_MIN_ZOOM}–{OFFLINE_MAX_ZOOM}) laddas ner och sparas i telefonen. Efter nedladdning fungerar kartan, GPS:en och parkeringsdatan utan internet (även i flygplansläge).<br /><br /><strong>{offlineTiles.length} kartrutor</strong> · <strong>ca {offlineTileSizeLabel(offlineTiles.length)}</strong><br /><strong>Adressökning och vägrutt</strong> kräver fortfarande internet.</p>
            {offlineTiles.length > MAX_OFFLINE_TILES ? (
              <div className="warning-box"><CircleAlert size={18} /><span><strong>Området är för stort.</strong> Zooma in kartan och öppna rutan igen – max {MAX_OFFLINE_TILES} rutor per nedladdning.</span></div>
            ) : null}
            <div className="modal-actions">
              <button type="button" className="modal-action" onClick={startOfflineDownload} disabled={!offlineTiles.length || offlineTiles.length > MAX_OFFLINE_TILES}><Download size={17} /> Starta nedladdning</button>
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
            {noticeAction ? (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  setNotice(null);
                  setNoticeAction(null);
                  noticeAction.run();
                }}
              >
                {noticeAction.label}
              </button>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

export default App;
