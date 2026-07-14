import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(projectRoot, "public", "data");

async function readLocalEnv() {
  const values = {};
  try {
    const source = await readFile(path.join(projectRoot, ".env.local"), "utf8");
    for (const line of source.split(/\r?\n/)) {
      const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
      if (match) values[match[1]] = match[2];
    }
  } catch {
    // Environment variables can be supplied by CI instead.
  }
  return { ...values, ...process.env };
}

async function fetchJson(url, init, label) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${label} svarade ${response.status}`);
  return response.json();
}

async function saveJson(fileName, payload) {
  const target = path.join(outputDirectory, fileName);
  await writeFile(target, JSON.stringify(payload), "utf8");
  const count = Array.isArray(payload) ? payload.length : payload?.features?.length ?? payload?.chargerstations?.length ?? payload?.Hits?.length ?? 0;
  console.log(`${fileName}: ${count} poster`);
}

async function fetchStockholmParking() {
  const homepageResponse = await fetch("https://www.stockholmparkering.se/", {
    headers: { "User-Agent": "ParkeraiSthlm-data-refresh" },
  });
  if (!homepageResponse.ok) throw new Error(`Stockholm Parkering svarade ${homepageResponse.status}`);
  const homepage = await homepageResponse.text();
  const token = homepage.match(/meta name="anti-forgery-token" content="([^"]+)"/)?.[1];
  if (!token) throw new Error("Stockholm Parkerings verifieringstoken saknas");
  const cookies = typeof homepageResponse.headers.getSetCookie === "function"
    ? homepageResponse.headers.getSetCookie().map((cookie) => cookie.split(";", 1)[0]).join("; ")
    : homepageResponse.headers.get("set-cookie")?.split(/,(?=[^;,]+=[^;,]+)/).map((cookie) => cookie.split(";", 1)[0]).join("; ");
  const params = new URLSearchParams({ query: "", showAll: "true", showRental: "true", showVisit: "true", showMobility: "true" });
  return fetchJson(
    `https://www.stockholmparkering.se/api/map?${params}`,
    {
      headers: {
        Accept: "application/json",
        Language: "sv",
        "User-Agent": "ParkeraiSthlm-data-refresh",
        "X-Requested-With": "XMLHttpRequest",
        "X-RequestVerificationToken": token,
        ...(cookies ? { Cookie: cookies } : {}),
      },
    },
    "Stockholm Parkering",
  );
}

function compactOfficial(payload) {
  const propertyNames = [
    "STREET_NAME", "CITY_DISTRICT", "ADDRESS", "VF_PLATS_TYP", "PARKING_RATE",
    "CITATION", "OTHER_INFO", "MAX_MINUTES", "MAX_HOURS", "START_TIME", "END_TIME",
    "DAY_TYPE", "START_WEEKDAY", "VEHICLE", "FID",
  ];
  return {
    type: "FeatureCollection",
    features: (payload?.features ?? []).map((feature) => ({
      id: feature.id,
      geometry: feature.geometry,
      properties: Object.fromEntries(propertyNames.flatMap((name) =>
        feature.properties?.[name] == null ? [] : [[name, feature.properties[name]]],
      )),
    })),
  };
}

function compactOcm(payload) {
  return (payload ?? []).map((station) => ({
    ID: station.ID,
    AddressInfo: station.AddressInfo && {
      Title: station.AddressInfo.Title,
      AddressLine1: station.AddressInfo.AddressLine1,
      Town: station.AddressInfo.Town,
      Latitude: station.AddressInfo.Latitude,
      Longitude: station.AddressInfo.Longitude,
      AccessComments: station.AddressInfo.AccessComments,
    },
    NumberOfPoints: station.NumberOfPoints,
    UsageCost: station.UsageCost,
    Connections: station.Connections?.map((connection) => ({
      ConnectionTypeID: connection.ConnectionTypeID,
      StatusTypeID: connection.StatusTypeID,
      PowerKW: connection.PowerKW,
      Quantity: connection.Quantity,
      CurrentTypeID: connection.CurrentTypeID,
      Amps: connection.Amps,
      Voltage: connection.Voltage,
    })),
  }));
}

function compactNobil(payload) {
  return {
    chargerstations: (payload?.chargerstations ?? []).map((station) => {
      const details = station.csmd ?? station;
      return {
        csmd: {
          id: details.id,
          name: details.name,
          Street: details.Street,
          House_number: details.House_number,
          City: details.City,
          Position: details.Position,
          Number_charging_points: details.Number_charging_points,
          Description_of_location: details.Description_of_location,
          User_comment: details.User_comment,
          Station_status: details.Station_status,
          International_id: details.International_id,
        },
      };
    }),
  };
}

function compactStockholmParking(payload) {
  return {
    Hits: (payload?.Hits ?? []).map((facility) => ({
      id: facility.id,
      name: facility.name,
      url: facility.url,
      location: facility.location && {
        address: facility.location.address,
        areaCode: facility.location.areaCode,
        position: facility.location.position,
      },
      visitorTaxes: facility.visitorTaxes,
      facilityType: facility.facilityType,
      features: facility.features && {
        totalVisitorSpace: facility.features.totalVisitorSpace,
        totalDisabledSpaces: facility.features.totalDisabledSpaces,
        totalMcVisitorSpaces: facility.features.totalMcVisitorSpaces,
        loadingSpacesCarVisitors: facility.features.loadingSpacesCarVisitors,
        fastLoadingSpaces: facility.features.fastLoadingSpaces,
      },
      isVisit: facility.isVisit,
      isGarage: facility.isGarage,
      isSurfaceParking: facility.isSurfaceParking,
      facilityNumber: facility.facilityNumber,
    })),
  };
}

const env = await readLocalEnv();
const stockholmKey = env.STOCKHOLM_OPEN_DATA_API_KEY;
const ocmKey = env.OCM_API_KEY;
const nobilKey = env.NOBIL_API_KEY;

if (!stockholmKey || !ocmKey || !nobilKey) {
  throw new Error("STOCKHOLM_OPEN_DATA_API_KEY, OCM_API_KEY och NOBIL_API_KEY måste vara konfigurerade");
}

await mkdir(outputDirectory, { recursive: true });

await saveJson("stockholm-parking.json", compactStockholmParking(await fetchStockholmParking()));

for (const rule of ["pmotorcykel", "prorelsehindrad", "ptillaten"]) {
  const params = new URLSearchParams({
    outputFormat: "json",
    apiKey: stockholmKey,
    maxFeatures: "25000",
  });
  const payload = await fetchJson(
    `https://openparking.stockholm.se/LTF-Tolken/v1/${rule}/all?${params}`,
    { headers: { Accept: "application/json", "User-Agent": "ParkeraiSthlm-data-refresh" } },
    rule,
  );
  await saveJson(`${rule}.json`, compactOfficial(payload));
}

const ocmParams = new URLSearchParams({
  output: "json",
  countrycode: "SE",
  latitude: "59.3293",
  longitude: "18.0686",
  distance: "35",
  distanceunit: "KM",
  maxresults: "5000",
  compact: "true",
  verbose: "false",
  key: ocmKey,
});
await saveJson("open-charge-map.json", compactOcm(await fetchJson(
  `https://api.openchargemap.io/v3/poi/?${ocmParams}`,
  { headers: { "User-Agent": "ParkeraiSthlm-data-refresh" } },
  "OpenChargeMap",
)));

const nobilBody = new URLSearchParams({
  apikey: nobilKey,
  apiversion: "3",
  action: "search",
  type: "rectangle",
  format: "json",
  limit: "3000",
  northeast: "(59.4294,18.2466)",
  southwest: "(59.2300,17.7633)",
});
await saveJson("nobil.json", compactNobil(await fetchJson(
  "https://nobil.no/api/server/search.php",
  { method: "POST", body: nobilBody, headers: { "Content-Type": "application/x-www-form-urlencoded" } },
  "NOBIL",
)));
