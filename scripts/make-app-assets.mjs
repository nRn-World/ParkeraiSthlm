// Tar fram underlaget för appikonen till iOS/App Store och för webbappen.
//
//   node scripts/make-app-assets.mjs
//
// assets/logo-source.png (ParkiSthlm-loggan, genomskinlig) är källan. Här blir den:
//   public/icon-<storlek>.png    – webbappens ikoner och favicon
//   public/icon-1024.png         – 1024x1024, helt utan genomskinlighet (App Store kräver det)
//   public/play-icon-512.png     – 512x512, 32-bitars PNG med alfakanal (Google Plays krav)
//   public/play-feature-1024x500.png – 1024x500 utan alfakanal (Google Plays krav)
//   assets/logo.png              – samma ikon som @capacitor/assets använder för ios/android
//
// Apple och Google har motsatta krav på alfakanalen, därav två varianter av ikonen.
// Genomskinligheten tas bort genom att lägga ikonen på loggans marinblå bottenfärg.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const source = path.join(root, "assets", "logo-source.png");
const BACKGROUND = "#040c1f";
const ICON_SIZE = 1024;

const logo = await readFile(source);

const iconPng = await sharp(logo)
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

// Google Play vill ha butiksikonen som 32-bitars PNG med alfakanal. Alla pixlar är
// fortfarande ogenomskinliga – bara kanalen finns där.
const playIcon = await sharp(logo)
  .resize(512, 512, { fit: "contain", background: BACKGROUND })
  .flatten({ background: BACKGROUND })
  .ensureAlpha()
  .png({ compressionLevel: 9 })
  .toBuffer();
const playIconMeta = await sharp(playIcon).metadata();
if (!playIconMeta.hasAlpha || playIconMeta.width !== 512 || playIconMeta.height !== 512) {
  throw new Error(`Butiksikonen blev ${playIconMeta.width}x${playIconMeta.height}, alfakanal: ${playIconMeta.hasAlpha}.`);
}
await writeFile(path.join(root, "public", "play-icon-512.png"), playIcon);

// Grafisk bild till butikssidan: 1024x500 utan alfakanal, med ikonen på appens mörka
// bottenfärg. Byt gärna ut den mot en egen bild med rubrik.
const featureIcon = await sharp(logo)
  .resize(400, 400, { fit: "contain", background: BACKGROUND })
  .flatten({ background: BACKGROUND })
  .png()
  .toBuffer();
const featureGraphic = await sharp({
  create: { width: 1024, height: 500, channels: 3, background: "#0b1119" },
})
  .composite([{ input: featureIcon, gravity: "center" }])
  .flatten({ background: "#0b1119" })
  // Google vill ha 24-bitars PNG utan alfakanal här, och composite lägger till en kanal.
  .removeAlpha()
  .png({ compressionLevel: 9 })
  .toBuffer();
const featureMeta = await sharp(featureGraphic).metadata();
if (featureMeta.hasAlpha || featureMeta.width !== 1024 || featureMeta.height !== 500) {
  throw new Error(`Grafiska bilden blev ${featureMeta.width}x${featureMeta.height}, alfakanal: ${featureMeta.hasAlpha}.`);
}
await writeFile(path.join(root, "public", "play-feature-1024x500.png"), featureGraphic);

const WEB_SIZES = [48, 72, 96, 128, 144, 152, 168, 180, 192, 384, 512];
for (const size of WEB_SIZES) {
  await sharp(iconPng).resize(size, size).png({ compressionLevel: 9 }).toFile(path.join(root, "public", `icon-${size}.png`));
}

// Samma ikon som logo för @capacitor/assets.
const assetsDir = path.join(root, "assets");
await mkdir(assetsDir, { recursive: true });
await writeFile(path.join(assetsDir, "logo.png"), iconPng);

console.log(`public/icon-1024.png klar (${meta.width}x${meta.height}, alfakanal: ${meta.hasAlpha ? "ja" : "nej"})`);
console.log(`public/play-icon-512.png klar (${playIconMeta.width}x${playIconMeta.height}, alfakanal: ja)`);
console.log(`public/play-feature-1024x500.png klar (${featureMeta.width}x${featureMeta.height}, alfakanal: nej)`);
console.log(`public/icon-{${WEB_SIZES.join(",")}}.png klara`);
console.log("assets/logo.png klar");
