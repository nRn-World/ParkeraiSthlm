export type LatLng = [number, number];
export type TariffId = 1 | 2 | 3 | 4 | 5;
export type ParkingKind = "garage" | "street" | "surface";

export type ParkingPlace = {
  id: string;
  name: string;
  address: string;
  area: string;
  lat: number;
  lng: number;
  kind: ParkingKind;
  tariff: TariffId | null;
  free: boolean;
  priceText: string;
  note: string;
  spaces?: number;
  source: "local" | "osm";
};

export type TaxArea = {
  id: string;
  tariff: TariffId;
  positions: LatLng[];
};

export type StreetSegment = {
  id: string;
  name: string;
  tariff: TariffId;
  positions: LatLng[];
};

export const STOCKHOLM_CENTER: LatLng = [59.3293, 18.0686];

export const TARIFFS = {
  1: {
    color: "#ef5b4d",
    price: "55 kr/tim",
    shortHours: "Dygnet runt",
    hours: "55 kr/tim, dygnet runt, alla dagar inklusive helgdagar.",
  },
  2: {
    color: "#d94f9d",
    price: "31 kr/tim",
    shortHours: "Vard. 07–21 / Lör+helgdag 09–19",
    hours: "31 kr/tim vardagar 07–21 och lördagar/helgdagar 09–19. Övrig tid: 20 kr/tim (dygnet runt).",
  },
  3: {
    color: "#526fe8",
    price: "20 kr/tim",
    shortHours: "Vardagar 07–19",
    hours: "20 kr/tim vardagar 07–19. Lördagar 11–17: 15 kr/tim. Övrig tid (inkl. söndag och helgdag): gratis.",
  },
  4: {
    color: "#159783",
    price: "10 kr/tim",
    shortHours: "Vardagar 07–19",
    hours: "10 kr/tim vardagar 07–19 och lördagar 11–17. Övrig tid (inkl. söndag och helgdag): gratis.",
  },
  5: {
    color: "#80a63b",
    price: "5 kr/tim",
    shortHours: "Vardagar 07–19",
    hours: "5 kr/tim vardagar 07–19. Övrig tid (inkl. lördag, söndag och helgdag): gratis.",
  },
} as const;

// Områdena följer stadens områdesbeskrivningar. Enskild skyltning på gatan gäller alltid.
export const TAX_AREAS: TaxArea[] = [
  {
    id: "t5-bromma",
    tariff: 5,
    positions: [
      [59.353, 17.917], [59.364, 17.941], [59.354, 17.979], [59.337, 17.993],
      [59.321, 17.973], [59.324, 17.938],
    ],
  },
  {
    id: "t5-hagersten",
    tariff: 5,
    positions: [
      [59.309, 17.972], [59.302, 18.003], [59.281, 18.015], [59.274, 17.984],
      [59.286, 17.952],
    ],
  },
  {
    id: "t5-bagarmossen",
    tariff: 5,
    positions: [
      [59.283, 18.119], [59.28, 18.14], [59.264, 18.142], [59.259, 18.116],
      [59.27, 18.102],
    ],
  },
  {
    id: "t4-traneberg",
    tariff: 4,
    positions: [
      [59.342, 17.978], [59.347, 18.001], [59.335, 18.016], [59.324, 18.003],
      [59.327, 17.981],
    ],
  },
  {
    id: "t4-essingen",
    tariff: 4,
    positions: [
      [59.329, 17.996], [59.324, 18.013], [59.314, 18.008], [59.309, 17.997],
      [59.315, 17.988],
    ],
  },
  {
    id: "t4-soderort",
    tariff: 4,
    positions: [
      [59.306, 17.996], [59.307, 18.039], [59.298, 18.071], [59.304, 18.109],
      [59.286, 18.126], [59.274, 18.102], [59.273, 18.043], [59.287, 18.002],
    ],
  },
  {
    id: "t4-ekhagen",
    tariff: 4,
    positions: [
      [59.381, 18.054], [59.387, 18.077], [59.374, 18.087], [59.364, 18.066],
    ],
  },
  {
    id: "t3-kungsholmen",
    tariff: 3,
    positions: [
      [59.353, 18.003], [59.361, 18.031], [59.35, 18.057], [59.332, 18.052],
      [59.318, 18.035], [59.319, 18.008], [59.336, 17.995],
    ],
  },
  {
    id: "t3-norr-ostermalm",
    tariff: 3,
    positions: [
      [59.361, 18.025], [59.379, 18.045], [59.37, 18.107], [59.348, 18.129],
      [59.337, 18.114], [59.337, 18.077], [59.348, 18.052],
    ],
  },
  {
    id: "t3-sodermalm",
    tariff: 3,
    positions: [
      [59.324, 18.015], [59.326, 18.076], [59.316, 18.107], [59.296, 18.102],
      [59.289, 18.065], [59.299, 18.019],
    ],
  },
  {
    id: "t3-sjostad",
    tariff: 3,
    positions: [
      [59.309, 18.09], [59.31, 18.13], [59.297, 18.142], [59.291, 18.112],
      [59.297, 18.086],
    ],
  },
  {
    id: "t3-liljeholmen",
    tariff: 3,
    positions: [
      [59.315, 17.997], [59.314, 18.023], [59.303, 18.035], [59.294, 18.012],
      [59.299, 17.988],
    ],
  },
  {
    id: "t2-innerstaden",
    tariff: 2,
    positions: [
      [59.3427, 18.035], [59.3457, 18.058], [59.3432, 18.085], [59.3375, 18.105],
      [59.3261, 18.094], [59.319, 18.078], [59.32, 18.045], [59.328, 18.035],
    ],
  },
  {
    id: "t1-city",
    tariff: 1,
    positions: [
      [59.3379, 18.043], [59.3382, 18.067], [59.3356, 18.075], [59.3297, 18.075],
      [59.3275, 18.065], [59.328, 18.052], [59.332, 18.044],
    ],
  },
];

export const TAX_STREETS: StreetSegment[] = [
  { id: "kungsgatan", name: "Kungsgatan", tariff: 1, positions: [[59.3358, 18.046], [59.3368, 18.064], [59.3374, 18.073]] },
  { id: "regeringsgatan", name: "Regeringsgatan", tariff: 1, positions: [[59.3297, 18.069], [59.338, 18.068]] },
  { id: "master-samuelsgatan", name: "Mäster Samuelsgatan", tariff: 1, positions: [[59.3342, 18.052], [59.335, 18.073]] },
  { id: "scheelegatan", name: "Scheelegatan", tariff: 2, positions: [[59.3261, 18.042], [59.3369, 18.038]] },
  { id: "tegnergatan", name: "Tegnergatan", tariff: 2, positions: [[59.3404, 18.048], [59.3405, 18.071]] },
  { id: "karlavagen", name: "Karlavägen", tariff: 2, positions: [[59.3403, 18.079], [59.3385, 18.102]] },
  { id: "norr-malarstrand", name: "Norr Mälarstrand", tariff: 2, positions: [[59.3241, 18.022], [59.327, 18.05]] },
  { id: "sankt-eriksgatan", name: "Sankt Eriksgatan", tariff: 3, positions: [[59.3214, 18.031], [59.3544, 18.038]] },
  { id: "odengatan", name: "Odengatan", tariff: 3, positions: [[59.3433, 18.034], [59.3452, 18.087]] },
  { id: "valhallavagen", name: "Valhallavägen", tariff: 3, positions: [[59.3464, 18.074], [59.35, 18.112]] },
  { id: "hornsgatan", name: "Hornsgatan", tariff: 3, positions: [[59.3174, 18.012], [59.3197, 18.072]] },
  { id: "ringvagen", name: "Ringvägen", tariff: 3, positions: [[59.3044, 18.026], [59.2958, 18.077], [59.304, 18.103]] },
  { id: "hammarby-alle", name: "Hammarby Allé", tariff: 3, positions: [[59.3011, 18.08], [59.3023, 18.127]] },
  { id: "gullmarsvagen", name: "Gullmarsvägen", tariff: 4, positions: [[59.297, 18.077], [59.2877, 18.088]] },
  { id: "arstavagen", name: "Årstavägen", tariff: 4, positions: [[59.2952, 18.027], [59.286, 18.061]] },
  { id: "tellusborgsvagen", name: "Tellusborgsvägen", tariff: 4, positions: [[59.3014, 17.999], [59.2974, 18.015]] },
  { id: "ulvsundavagen", name: "Ulvsundavägen", tariff: 5, positions: [[59.336, 17.968], [59.363, 17.961]] },
  { id: "sedelvagen", name: "Sedelvägen", tariff: 5, positions: [[59.2853, 17.965], [59.296, 17.974]] },
  { id: "lagavagen", name: "Lågavägen", tariff: 5, positions: [[59.2733, 18.117], [59.278, 18.131]] },
];

export const OFFLINE_BASE_ROADS: LatLng[][] = [
  [[59.305, 17.92], [59.318, 17.974], [59.327, 18.02], [59.335, 18.066], [59.35, 18.12], [59.367, 18.17]],
  [[59.274, 18.002], [59.298, 18.032], [59.317, 18.05], [59.34, 18.065], [59.372, 18.072]],
  [[59.282, 18.13], [59.298, 18.105], [59.319, 18.086], [59.337, 18.071], [59.36, 18.03]],
  [[59.329, 17.91], [59.338, 17.972], [59.346, 18.034], [59.346, 18.098], [59.355, 18.17]],
  [[59.29, 17.96], [59.301, 18.0], [59.305, 18.055], [59.304, 18.115]],
  [[59.32, 17.97], [59.324, 18.018], [59.324, 18.065], [59.319, 18.111]],
];

export const LOCAL_PARKING: ParkingPlace[] = [
  {
    id: "citygaraget", name: "Citygaraget", address: "Mäster Samuelsgatan 61", area: "Norrmalm",
    lat: 59.3364, lng: 18.0654, kind: "garage", tariff: 1, free: false,
    priceText: "Garageavgift", note: "Centralt garage. Kontrollera aktuell taxa vid infart.", source: "local",
  },
  {
    id: "gallerian", name: "P-hus Gallerian", address: "Regeringsgatan 15", area: "City",
    lat: 59.3319, lng: 18.0672, kind: "garage", tariff: 1, free: false,
    priceText: "Garageavgift", note: "Inomhusparkering mitt i city.", source: "local",
  },
  {
    id: "norra-latin", name: "P-hus Norra Latin", address: "Olof Palmes gata 28", area: "Norrmalm",
    lat: 59.3375, lng: 18.0521, kind: "garage", tariff: 1, free: false,
    priceText: "Garageavgift", note: "Centralt parkeringshus nära T-Centralen.", source: "local",
  },
  {
    id: "odenplansgaraget", name: "Odenplansgaraget", address: "Gyldengatan 2", area: "Vasastan",
    lat: 59.3431, lng: 18.0487, kind: "garage", tariff: 3, free: false,
    priceText: "Garageavgift", note: "Garage vid Odenplan.", source: "local",
  },
  {
    id: "radshusgaraget", name: "Rådhusgaraget", address: "Kungsholmsgatan 28", area: "Kungsholmen",
    lat: 59.3308, lng: 18.0416, kind: "garage", tariff: 2, free: false,
    priceText: "Garageavgift", note: "Parkeringsgarage nära Rådhuset.", source: "local",
  },
  {
    id: "medborgarplatsen", name: "P-hus Medborgarplatsen", address: "Folkungagatan 54", area: "Södermalm",
    lat: 59.3145, lng: 18.0736, kind: "garage", tariff: 3, free: false,
    priceText: "Garageavgift", note: "Centralt garage på Södermalm.", source: "local",
  },
  {
    id: "ringen", name: "Ringen centrumgarage", address: "Götgatan 100", area: "Skanstull",
    lat: 59.3084, lng: 18.0761, kind: "garage", tariff: 3, free: false,
    priceText: "Garageavgift", note: "Garage vid Ringen och Skanstull.", source: "local",
  },
  {
    id: "liljeholmstorget", name: "Liljeholmstorget garage", address: "Liljeholmstorget 7", area: "Liljeholmen",
    lat: 59.3092, lng: 18.0219, kind: "garage", tariff: 3, free: false,
    priceText: "Garageavgift", note: "Garage i direkt anslutning till centrum.", source: "local",
  },
  {
    id: "globen", name: "Globen Shopping garage", address: "Arenavägen 49", area: "Johanneshov",
    lat: 59.2938, lng: 18.0823, kind: "garage", tariff: 4, free: false,
    priceText: "Garageavgift", note: "Stor parkering nära arenorna.", source: "local",
  },
  {
    id: "sjostaden", name: "Heliosgaraget", address: "Heliosgatan 15", area: "Hammarby Sjöstad",
    lat: 59.3018, lng: 18.1028, kind: "garage", tariff: 3, free: false,
    priceText: "Garageavgift", note: "Inomhusparkering i Hammarby Sjöstad.", source: "local",
  },
  {
    id: "vartan", name: "Värtahamnen parkering", address: "Hamnpirsvägen", area: "Värtahamnen",
    lat: 59.3489, lng: 18.1145, kind: "surface", tariff: 3, free: false,
    priceText: "Områdestaxa", note: "Stor markparkering vid hamnen.", source: "local",
  },
  {
    id: "brunnsgatan", name: "Brunnsgatan", address: "Brunnsgatan 18", area: "Norrmalm",
    lat: 59.3364, lng: 18.0678, kind: "street", tariff: 1, free: false,
    priceText: "55 kr/tim", note: "Gatuparkering i taxeområde 1. Läs alltid skylten på plats.", source: "local",
  },
  {
    id: "fleminggatan", name: "Fleminggatan", address: "Fleminggatan 35", area: "Kungsholmen",
    lat: 59.3347, lng: 18.0398, kind: "street", tariff: 2, free: false,
    priceText: "31 kr/tim dagtid", note: "Gatuparkering i taxeområde 2. Avgift dygnet runt.", source: "local",
  },
  {
    id: "dalagatan", name: "Dalagatan", address: "Dalagatan 44", area: "Vasastan",
    lat: 59.3424, lng: 18.0438, kind: "street", tariff: 3, free: false,
    priceText: "20 kr/tim dagtid", note: "Gatuparkering i taxeområde 3. Gratis vissa tider.", source: "local",
  },
  {
    id: "blekingegatan", name: "Blekingegatan", address: "Blekingegatan 40", area: "Södermalm",
    lat: 59.3088, lng: 18.068, kind: "street", tariff: 3, free: false,
    priceText: "20 kr/tim dagtid", note: "Gatuparkering i taxeområde 3. Kontrollera servicedag.", source: "local",
  },
  {
    id: "arstavagen-p", name: "Årstavägen", address: "Årstavägen 38", area: "Årsta",
    lat: 59.2879, lng: 18.0551, kind: "street", tariff: 4, free: false,
    priceText: "10 kr/tim dagtid", note: "Gatuparkering i taxeområde 4. Gratis vissa tider.", source: "local",
  },
  {
    id: "tranebergsvagen", name: "Tranebergsvägen", address: "Tranebergsvägen 45", area: "Traneberg",
    lat: 59.3359, lng: 17.9878, kind: "street", tariff: 4, free: false,
    priceText: "10 kr/tim dagtid", note: "Gatuparkering i taxeområde 4.", source: "local",
  },
  {
    id: "riksby", name: "Riksbyvägen", address: "Riksbyvägen 40", area: "Riksby",
    lat: 59.3438, lng: 17.9479, kind: "street", tariff: 5, free: false,
    priceText: "5 kr/tim dagtid", note: "Gatuparkering i taxeområde 5. Gratis utanför avgiftstid.", source: "local",
  },
  {
    id: "bagarmossen", name: "Lågavägen", address: "Lågavägen 22", area: "Bagarmossen",
    lat: 59.2754, lng: 18.1256, kind: "street", tariff: 5, free: false,
    priceText: "5 kr/tim dagtid", note: "Gatuparkering i taxeområde 5. Gratis utanför avgiftstid.", source: "local",
  },
  {
    id: "bromma-free", name: "Abrahamsberg lokalgata", address: "Registervägen", area: "Abrahamsberg",
    lat: 59.3368, lng: 17.9533, kind: "street", tariff: null, free: true,
    priceText: "Gratis", note: "Möjlig avgiftsfri gatuparkering. Tidsgräns och lokal skyltning kan gälla.", source: "local",
  },
  {
    id: "tallkrogen-free", name: "Tallkrogen lokalgata", address: "Tallkrogsvägen", area: "Tallkrogen",
    lat: 59.2711, lng: 18.0868, kind: "street", tariff: null, free: true,
    priceText: "Gratis", note: "Möjlig avgiftsfri parkering. Kontrollera skyltning och 24-timmarsregeln.", source: "local",
  },
];

export function getCurrentPrice(tariff: TariffId, date = new Date()) {
  const day = date.getDay(); // 0=söndag, 1–5=vardag, 6=lördag
  const hour = date.getHours() + date.getMinutes() / 60;

  // Taxa 1: 55 kr/tim dygnet runt, alla dagar
  if (tariff === 1) return { amount: 55, label: "55 kr/tim just nu" };

  // Taxa 2: Vardagar 07–21 = 31 kr, Lördag/helgdag 09–19 = 31 kr, övrig tid = 20 kr
  if (tariff === 2) {
    const isWeekday = day >= 1 && day <= 5;
    const isSaturday = day === 6;
    const isSunday = day === 0;
    const peakWeekday = isWeekday && hour >= 7 && hour < 21;
    const peakSaturday = isSaturday && hour >= 9 && hour < 19;
    const peakSunday = isSunday && hour >= 9 && hour < 19; // helgdag = söndagsregler
    const isPeak = peakWeekday || peakSaturday || peakSunday;
    return { amount: isPeak ? 31 : 20, label: `${isPeak ? 31 : 20} kr/tim just nu` };
  }

  // Taxa 3: Vardagar 07–19 = 20 kr, Lördagar 11–17 = 15 kr, övrig tid = gratis
  if (tariff === 3) {
    if (day >= 1 && day <= 5 && hour >= 7 && hour < 19) return { amount: 20, label: "20 kr/tim just nu" };
    if (day === 6 && hour >= 11 && hour < 17) return { amount: 15, label: "15 kr/tim just nu" };
    return { amount: 0, label: "Gratis just nu" };
  }

  // Taxa 4: Vardagar 07–19 = 10 kr, Lördagar 11–17 = 10 kr, övrig tid = gratis
  if (tariff === 4) {
    if ((day >= 1 && day <= 5 && hour >= 7 && hour < 19) || (day === 6 && hour >= 11 && hour < 17)) {
      return { amount: 10, label: "10 kr/tim just nu" };
    }
    return { amount: 0, label: "Gratis just nu" };
  }

  // Taxa 5: Vardagar 07–19 = 5 kr, övrig tid = gratis
  if (day >= 1 && day <= 5 && hour >= 7 && hour < 19) return { amount: 5, label: "5 kr/tim just nu" };
  return { amount: 0, label: "Gratis just nu" };
}

export function distanceKm(a: LatLng, b: LatLng) {
  const rad = (value: number) => (value * Math.PI) / 180;
  const earth = 6371;
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return earth * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}