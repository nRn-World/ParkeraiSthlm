// Tar fram appikonen och iOS-ikonerna/splasharna i rätt storlekar.
//
//   node scripts/ios-assets.mjs
//
// Steg 1: public/icon.svg -> public/icon-1024.png (ogenomskinlig, App Store-kravet)
// Steg 2: assets/logo.svg  -> ios/App/App/Assets.xcassets (ikon + startbild, ljust och mörkt tema)
//
// Färgerna skickas som argument i stället för på kommandoraden, eftersom citattecken
// hanteras olika i Windows- och Unix-skal.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const processor = path.join(root, "node_modules", "@capacitor", "assets", "bin", "capacitor-assets");

function run(script, args, label) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`${label} misslyckades (kod ${result.status ?? "okänd"}).`);
    process.exit(result.status ?? 1);
  }
}

run(path.join(root, "scripts", "make-app-assets.mjs"), [], "Ikonunderlaget");

if (!existsSync(path.join(root, "ios", "App"))) {
  console.log("ios/App saknas – kör `npx cap add ios` först. Hoppar över iOS-ikonerna.");
  process.exit(0);
}

run(processor, [
  "generate",
  "--ios",
  "--iconBackgroundColor", "#1266ee",
  "--iconBackgroundColorDark", "#0b1119",
  "--splashBackgroundColor", "#1266ee",
  "--splashBackgroundColorDark", "#0b1119",
], "iOS-ikonerna och startbilderna");
