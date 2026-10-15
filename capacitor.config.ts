import type { CapacitorConfig } from "@capacitor/cli";

// Inställningar för den inbyggda iOS-appen. Webbappen (GitHub Pages) påverkas inte av
// den här filen – den används bara när `npm run build:native` följt av `cap sync ios`
// körs i en macOS-miljö (eller i molnet, se docs/APPSTORE.md).
const config: CapacitorConfig = {
  // App-ID:t kan inte ändras efter att appen har laddats upp till App Store.
  appId: "one.nrnworld.parkisthlm",
  appName: "ParkiSthlm",
  webDir: "dist",
  // Den inbyggda appen får aldrig peka på en extern server: allt ligger i paketet.
  server: {
    iosScheme: "capacitor",
  },
  ios: {
    // Appen ritar sin egen yta ända ut i kanterna (samma som standalone-läget i webbläsaren).
    contentInset: "never",
    backgroundColor: "#040c1f",
    // Mörkt läge hanteras av appens eget CSS-tema, inte av systemets.
    preferredContentMode: "mobile",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      launchAutoHide: true,
      backgroundColor: "#040c1f",
      showSpinner: false,
      // Splash-bilden får skalas upp så att den fyller skärmen på alla iPhone-modeller.
      iosScaleToFit: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      // Kartan ligger bakom statusraden, precis som i webbläsarens standalone-läge.
      overlaysWebView: true,
      style: "LIGHT",
    },
    LocalNotifications: {
      smallIcon: "ic_stat_parkisthlm",
      iconColor: "#1266ee",
    },
  },
};

export default config;
