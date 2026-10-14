// Tar fram underlaget för appikonen till iOS/App Store och för webbappen.
//
//   node scripts/make-app-assets.mjs
//
// public/icon.svg är källan. Här blir den:
//   public/icon-1024.png  – 1024x1024, helt utan genomskinlighet (App Store kräver det)
//   assets/logo.svg       – samma ikon som @capacitor/assets använder för iOS-ikoner och splash
//
// Genomskinlighet tas bort genom att lägga ikonen på appens blå bottenfärg, eftersom
// Apple avvisar ikoner med alfakanal.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const sourceSvg = path.join(root, "public", "icon.svg");
const BACKGROUND = "#1266ee";
const ICON_SIZE = 1024;

const svg = await readFile(sourceSvg);

const iconPng = await sharp(svg, { density: 384 })
  .resize(ICON_SIZE, ICON_SIZE, { fit: "contain", background: BACKGROUND })
  .flatten({ background: BACKGROUND })
  .png({ compressionLevel: 9 })
  .toBuffer();

// Utan alfakanal skriver sharp en RGB-PNG (färgtyp 2). Skulle kanalen ändå finnas kvar
// ska bygget inte gå igenom – då blir uppladdningen till App Store avvisad.
const meta = await sharp(iconPng).metadata();
if (meta.hasAlpha) {
  throw new Error("Ikonen har fortfarande en alfakanal – App Store kräver en ogenomskinlig PNG.");
}
if (meta.width !== ICON_SIZE || meta.height !== ICON_SIZE) {
  throw new Error(`Ikonen blev ${meta.width}x${meta.height}, förväntade ${ICON_SIZE}x${ICON_SIZE}.`);
}

await writeFile(path.join(root, "public", "icon-1024.png"), iconPng);

// Samma ikon som logo för @capacitor/assets (den läser SVG direkt).
const assetsDir = path.join(root, "assets");
await mkdir(assetsDir, { recursive: true });
await writeFile(path.join(assetsDir, "logo.svg"), svg);

console.log(`public/icon-1024.png klar (${meta.width}x${meta.height}, alfakanal: ${meta.hasAlpha ? "ja" : "nej"})`);
console.log("assets/logo.svg klar");
