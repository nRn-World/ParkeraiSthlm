// Skapar uppladdningsnyckeln för Google Play och skriver android/keystore.properties.
//
//   node scripts/make-upload-keystore.mjs
//
// Nyckeln hamnar utanför repot (~/.parkeraisthlm/upload-key.jks) och lösenordet skrivs
// bara till android/keystore.properties, som git ignorerar. Lösenordet skrivs aldrig ut
// i terminalen. Ta en säkerhetskopia av båda filerna – tappar du nyckeln måste du begära
// en återställning i Play Console.
//
// Kör med --force för att skapa en ny nyckel (den gamla skrivs över).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const force = process.argv.includes("--force");
const keyDir = process.env.PARKERA_KEY_DIR ?? path.join(os.homedir(), ".parkeraisthlm");
const keystorePath = path.join(keyDir, "upload-key.jks");
const alias = "upload";

function findKeytool() {
  const candidates = [
    process.env.PARKERA_KEYTOOL,
    // Android Studios egen Java (JDK 21) – den som Capacitor 8 och AGP förväntar sig.
    "C:/Program Files/Android/Android Studio/jbr/bin/keytool.exe",
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool",
    "keytool",
  ].filter(Boolean);
  return candidates.find((candidate) => candidate === "keytool" || existsSync(candidate));
}

if (existsSync(keystorePath) && !force) {
  console.error(`Nyckeln finns redan: ${keystorePath}`);
  console.error("Kör med --force om du verkligen vill skapa en ny (Play kräver då en återställning av uppladdningsnyckeln).");
  process.exit(1);
}

const keytool = findKeytool();
if (!keytool) {
  console.error("Hittade ingen keytool. Sätt PARKERA_KEYTOOL till sökvägen för keytool och försök igen.");
  process.exit(1);
}

mkdirSync(keyDir, { recursive: true });

// 24 slumpade byte i base64url: starkt nog och utan tecken som bråkar i en .properties-fil.
const password = crypto.randomBytes(24).toString("base64url");

const result = spawnSync(keytool, [
  "-genkeypair",
  "-keystore", keystorePath,
  "-alias", alias,
  "-keyalg", "RSA",
  "-keysize", "2048",
  "-validity", "10000",
  // Lösenordet skickas via miljövariabeln i stället för på kommandoraden, så att det
  // inte syns i någon processlista.
  "-storepass:env", "PARKERA_STORE_PASS",
  "-keypass:env", "PARKERA_STORE_PASS",
  "-dname", "CN=ParkeraiSthlm, OU=nRn World, O=nRn World, L=Stockholm, ST=Stockholm, C=SE",
], {
  stdio: "inherit",
  env: { ...process.env, PARKERA_STORE_PASS: password },
});

if (result.status !== 0) {
  console.error(`keytool misslyckades (kod ${result.status ?? "okänd"}).`);
  process.exit(result.status ?? 1);
}

const propertiesPath = path.join(root, "android", "keystore.properties");
writeFileSync(propertiesPath, [
  "Skapad av scripts/make-upload-keystore.mjs – ignoreras av git.",
  "Det här är din uppladdningsnyckel till Google Play. Ta en säkerhetskopia av både",
  "den här filen och nyckelfilen, och lägg lösenordet i din lösenordshanterare.",
  `storeFile=${keystorePath.split(path.sep).join("/")}`,
  `storePassword=${password}`,
  `keyAlias=${alias}`,
  `keyPassword=${password}`,
  "",
].join("\n"), { mode: 0o600 });

console.log(`Nyckelfil:        ${keystorePath}`);
console.log(`Inställningar:    ${propertiesPath}`);
console.log("Lösenordet står i inställningsfilen och skrivs aldrig här.");
