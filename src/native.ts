// Inbyggd app (iOS/Android) via Capacitor.
//
// Allt i den här filen är skrivet så att webbversionen beter sig exakt som förut:
// finns ingen native-brygga används webbläsarens egna API:er. Ingen import av
// native-koden sker på webben, så webbpaketet påverkas inte.
import { Capacitor } from "@capacitor/core";

export type NativePosition = {
  lat: number;
  lng: number;
  accuracy: number;
  heading: number | null;
};

/** Sant när koden körs inuti den inbyggda appen (inte i en webbläsare). */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** "ios", "android" eller "web". */
export function nativePlatform(): string {
  try {
    return Capacitor.getPlatform();
  } catch {
    return "web";
  }
}

type PositionCallback = (position: NativePosition) => void;
type ErrorCallback = (error?: unknown) => void;

const GEO_OPTIONS = { enableHighAccuracy: true, timeout: 12_000, maximumAge: 10_000 };

function toNativePosition(position: {
  coords: { latitude: number; longitude: number; accuracy: number; heading: number | null };
}): NativePosition {
  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracy: position.coords.accuracy,
    heading: Number.isFinite(position.coords.heading as number) ? position.coords.heading : null,
  };
}

/** Hämtar en position. På webben används navigator.geolocation precis som förut. */
export async function getCurrentLocation(): Promise<NativePosition> {
  if (isNativeApp()) {
    const { Geolocation } = await import("@capacitor/geolocation");
    const position = await Geolocation.getCurrentPosition(GEO_OPTIONS);
    return toNativePosition(position);
  }
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("geolocation-missing"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(toNativePosition(position)),
      (error) => reject(error),
      GEO_OPTIONS,
    );
  });
}

/**
 * Följer positionen löpande. Returnerar en funktion som stoppar spårningen.
 * På webben används navigator.geolocation.watchPosition precis som förut.
 */
export function watchLocation(onPosition: PositionCallback, onError: ErrorCallback): () => void {
  if (isNativeApp()) {
    let watchId: string | null = null;
    let stopped = false;
    void import("@capacitor/geolocation").then(async ({ Geolocation }) => {
      const id = await Geolocation.watchPosition({ ...GEO_OPTIONS, maximumAge: 5_000 }, (position, error) => {
        if (stopped) return;
        if (error || !position) {
          onError(error);
          return;
        }
        onPosition(toNativePosition(position));
      });
      if (stopped) {
        void Geolocation.clearWatch({ id });
        return;
      }
      watchId = id;
    }).catch(onError);
    return () => {
      stopped = true;
      if (watchId) void import("@capacitor/geolocation").then(({ Geolocation }) => Geolocation.clearWatch({ id: watchId! }));
    };
  }

  if (!navigator.geolocation) {
    onError(new Error("geolocation-missing"));
    return () => undefined;
  }
  const watchId = navigator.geolocation.watchPosition(
    (position) => onPosition(toNativePosition(position)),
    onError,
    { ...GEO_OPTIONS, maximumAge: 5_000 },
  );
  return () => navigator.geolocation.clearWatch(watchId);
}

/** Sant om aviseringar kan visas – utan att fråga användaren. */
export async function notificationPermissionGranted(): Promise<boolean> {
  if (isNativeApp()) {
    try {
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      const status = await LocalNotifications.checkPermissions();
      return status.display === "granted";
    } catch {
      return false;
    }
  }
  try {
    return typeof Notification !== "undefined" && Notification.permission === "granted";
  } catch {
    return false;
  }
}

/** Frågar om lov att visa aviseringar. Returnerar om det blev tillåtet. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (isNativeApp()) {
    try {
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      const status = await LocalNotifications.requestPermissions();
      return status.display === "granted";
    } catch {
      return false;
    }
  }
  try {
    if (typeof Notification === "undefined") return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

/**
 * Visar en avisering. I den inbyggda appen blir det en riktig systemnotis (appen
 * behöver inte vara öppen i förgrunden), på webben webbläsarens notis.
 */
export async function showNotification(title: string, body: string, tag: string): Promise<void> {
  if (isNativeApp()) {
    try {
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      const status = await LocalNotifications.checkPermissions();
      if (status.display !== "granted") return;
      await LocalNotifications.schedule({
        notifications: [{
          // Samma tagg ger samma id, så en ny påminnelse ersätter den gamla i stället för
          // att staplas. iOS visar den senaste.
          id: notificationId(tag),
          title,
          body,
          schedule: { at: new Date(Date.now() + 1_000) },
        }],
      });
    } catch {
      // Aviseringar är ett tillägg – appens egen ruta visas ändå.
    }
    return;
  }

  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title, { body, tag });
    }
  } catch {
    // Utan stöd för notiser används appens egen ruta.
  }
}

function notificationId(tag: string) {
  let hash = 0;
  for (let index = 0; index < tag.length; index += 1) {
    hash = (hash * 31 + tag.charCodeAt(index)) % 1_000_000_007;
  }
  return hash + 1;
}

/**
 * Öppnar en extern länk (Google Maps, Apple Maps, Waze …). I den inbyggda appen
 * lämnar länken appen och öppnas i systemets webbläsare i stället för att kapa
 * appens eget fönster.
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (isNativeApp()) {
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url, presentationStyle: "popover" });
      return;
    } catch {
      // Faller igenom till webbläsarens eget sätt nedan.
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Gör i ordning skalet runt webbvyn: statusradens stil och att startbilden tas bort.
 * Anropas en gång när appen startar; på webben händer ingenting.
 */
export async function initNativeShell(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide();
  } catch {
    // Startbilden stängs av sig själv om anropet inte går igenom.
  }
}

/**
 * Statusraden ligger ovanpå appens egen yta (kartan och den blå listen), och ska därför
 * ha ljus text i både ljust och mörkt tema – samma beteende som webbappen har i
 * standalone-läge. Färgen på själva listen sätts inte, eftersom den ligger bakom appens yta.
 */
export async function setNativeStatusBar(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: Style.Dark });
  } catch {
    // Statusraden har en vettig standard om anropet inte stöds.
  }
}
