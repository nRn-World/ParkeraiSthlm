// Kartrutor för offline-läget.
//
// På webbplatsen sköts det här av service workern (public/sw.js) med Cache API.
// Den inbyggda appen körs på capacitor://, där service workers inte finns alls – där
// sparas rutorna i stället i IndexedDB och läses tillbaka som blob-adresser via
// MapLibres transformRequest. På webben gör den här filen ingenting.
import { idbGet, idbSet } from "./idb-cache";
import { isNativeApp } from "./native";

const TILE_HOST = "tile.openstreetmap.org";
const KEY_PREFIX = "tile:";
// Hur många blob-adresser som får leva samtidigt, och hur länge innan de städas bort.
// MapLibre laddar rutorna en gång och behåller dem som texturer, så en adress behövs
// bara en kort stund efter att rutan hämtats.
const MAX_BLOB_URLS = 400;
const BLOB_URL_TTL_MS = 120_000;

export function isTileUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(TILE_HOST);
  } catch {
    return false;
  }
}

function tileKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${KEY_PREFIX}${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

export async function readTile(url: string): Promise<Blob | null> {
  const key = tileKey(url);
  if (!key) return null;
  return idbGet<Blob>(key);
}

export async function writeTile(url: string, blob: Blob): Promise<void> {
  const key = tileKey(url);
  if (!key) return;
  await idbSet(key, blob);
}

const blobUrls = new Map<string, { url: string; at: number }>();

function blobUrlFor(key: string, blob: Blob): string {
  const existing = blobUrls.get(key);
  if (existing) return existing.url;

  const url = URL.createObjectURL(blob);
  blobUrls.set(key, { url, at: Date.now() });

  const now = Date.now();
  for (const [entryKey, entry] of blobUrls) {
    if (entryKey === key) continue;
    if (now - entry.at > BLOB_URL_TTL_MS) {
      URL.revokeObjectURL(entry.url);
      blobUrls.delete(entryKey);
    }
  }
  while (blobUrls.size > MAX_BLOB_URLS) {
    const oldest = blobUrls.keys().next().value;
    if (oldest === undefined || oldest === key) break;
    const entry = blobUrls.get(oldest);
    if (entry) URL.revokeObjectURL(entry.url);
    blobUrls.delete(oldest);
  }

  return url;
}

/**
 * MapLibres krok för att byta ut en förfrågan. På webben returneras ingenting, så
 * MapLibre sköter hämtningen precis som förut. I den inbyggda appen hämtas en ruta som
 * redan finns sparad från telefonen, vilket är det som gör kartan läsbar offline.
 */
export function nativeTileRequestTransform(): undefined | ((url: string) => Promise<{ url: string }>) {
  if (!isNativeApp()) return undefined;

  return async (url: string) => {
    if (!isTileUrl(url)) return { url };
    const key = tileKey(url);
    if (!key) return { url };
    try {
      const cached = await idbGet<Blob>(key);
      if (cached) return { url: blobUrlFor(key, cached) };
    } catch {
      // Går cachen inte att läsa hämtas rutan från nätet i stället.
    }
    return { url };
  };
}

/**
 * Laddar ner kartrutor och sparar dem i telefonen. Samma uppdelning som service workern
 * använder: tio i taget, och rutor som redan finns hoppas över.
 */
export async function downloadTiles(
  urls: string[],
  onProgress: (cached: number, total: number) => void,
): Promise<number> {
  const total = urls.length;
  let cached = 0;

  for (let index = 0; index < total; index += 10) {
    await Promise.all(urls.slice(index, index + 10).map(async (url) => {
      try {
        if (await readTile(url)) return;
        const response = await fetch(url);
        if (!response.ok) return;
        await writeTile(url, await response.blob());
      } catch {
        // En ruta som inte går att hämta ska inte avbryta resten.
      }
    }));
    cached = Math.min(index + 10, total);
    onProgress(cached, total);
  }

  return cached;
}
