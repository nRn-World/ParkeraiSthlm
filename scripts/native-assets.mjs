// Tar fram appikonen och ikonerna/startbilderna för de inbyggda plattformarna.
//
//   node scripts/native-assets.mjs
//
// Steg 1: public/icon.svg -> public/icon-1024.png (ogenomskinlig, App Stores krav)
//         och assets/logo.svg
// Steg 2: assets/logo.svg -> ios/App/App/Assets.xcassets och android/app/src/main/res
//         – bara för de plattformar som faktiskt är tillagda.
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

const platforms = [
  { flag: "--ios", dir: path.join(root, "ios", "App"), hint: "npx cap add ios" },
  { flag: "--android", dir: path.join(root, "android", "app"), hint: "npx cap add android" },
].filter((platform) => {
  if (existsSync(platform.dir)) return true;
  console.log(`${platform.dir.replace(root + path.sep, "")} saknas – kör \`${platform.hint}\` först. Hoppar över.`);
  return false;
});

if (!platforms.length) {
  console.log("Ingen inbyggd plattform är tillagd – bara ikonen för webbappen uppdaterades.");
  process.exit(0);
}

run(processor, [
  "generate",
  ...platforms.map((platform) => platform.flag),
  "--iconBackgroundColor", "#1266ee",
  "--iconBackgroundColorDark", "#0b1119",
  "--splashBackgroundColor", "#1266ee",
  "--splashBackgroundColorDark", "#0b1119",
], "Ikonerna och startbilderna");
