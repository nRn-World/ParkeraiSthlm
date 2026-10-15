# Publicera ParkiSthlm på Google Play

Hela vägen från det här repot till en app i Google Play. Texten som ska klistras in i Play
Console ligger i [google-play-text.md](google-play-text.md).

## Kort om vad som gäller

- **Engångsavgift 25 USD** för ett utvecklarkonto. Ingen årlig avgift.
- **Privat konto (personal) skapat efter 13 november 2023** måste köra en sluten testrunda
  med **minst 12 testare som är anmälda i 14 dagar i följd** innan du kan ansöka om att
  publicera skarpt. Ett företagskonto (organisation) har inte det kravet. Nya privata konton
  ska dessutom verifiera åtkomst till en Android-telefon via Play Console-appen.
- **Appbunt (.aab) krävs** för nya appar. Du signerar med din uppladdningsnyckel och Google
  signerar om för användarna (Play App Signing).
- **Målnivå för API:** senast **31 augusti 2026** ska nya appar och uppdateringar sikta på
  **API 36** (Android 16). Projektet ligger redan där (`targetSdkVersion = 36`).

## Vad som redan är klart i repot

| Del | Var | Kommentar |
| --- | --- | --- |
| Android-projekt (Gradle) | `android/` | Capacitor 8.5.3, minSdk 24, compileSdk/targetSdk 36, Gradle 8.14.3 |
| Behörigheter | `android/app/src/main/AndroidManifest.xml` | Internet, grov och exakt position, aviseringar. GPS är frivilligt, så appen går att installera överallt |
| Signering av release | `android/app/build.gradle` | Läser `android/keystore.properties` (git-ignorerad) eller miljövariablerna `PARKERA_KEYSTORE_*`. Saknas nyckel blir bygget osignerat i stället för att krascha |
| Uppladdningsnyckel | `~/.parkeraisthlm/upload-key.jks` + `android/keystore.properties` | Skapad åt dig. Se "Nyckeln" nedan |
| Ikoner och startbilder | `android/app/src/main/res/mipmap-*` och `drawable-*` | Adaptiv ikon, rund ikon och startbilder för alla densiteter, ljust och mörkt tema |
| Systemknappen Tillbaka | `src/native.ts` | Stänger det översta lagret (samma ordning som Escape på webben). Är inget öppet minimeras appen i stället för att stängas |
| Offline-karta | `src/tile-cache.ts` | Service workers finns inte i den inbyggda appen, så kartrutorna sparas i IndexedDB |
| Butiksmaterial | `public/play-icon-512.png`, `public/play-feature-banner.png` | Framtagna av `node scripts/make-app-assets.mjs` i exakt de mått Google kräver |
| Skärmbilder | `store/*.png` | Fem bilder tagna från den körda appen, 1 344 × 2 688 (2:1) |
| Historik och statistik | `index.html`, `src/main.tsx` | Ingen statistik och ingen service worker i den inbyggda appen |
| Integritetspolicy och support | `public/privacy.html`, `public/support.html` | Krävs på både butikssidan och i appen – länken finns i appens "i"-ruta |
| Molnbygge | `.github/workflows/android.yml` | Bygger signerad .aab på en GitHub-maskin, utan Android Studio |

Så hänger byggstegen ihop:

```bash
npm ci                  # beroenden enligt package-lock.json
npm run android:sync    # ikoner + webbappbygge + synk in i android/
cd android && ./gradlew bundleRelease
```

Resultatet ligger i `android/app/build/outputs/bundle/release/app-release.aab`.

**Viktigt om Java:** Android Gradle Plugin 8.13 vill ha **JDK 17 eller 21**, och Gradle
8.14.3 stödjer inte JDK 25. Är `java -version` i din PATH nyare (som 25) måste bygget köras
med Android Studios egen Java. I Git Bash:

```bash
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
cd android && ./gradlew bundleRelease
```

I cmd/PowerShell:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
cd android
.\gradlew.bat bundleRelease
```

Testa på en inkopplad telefon innan du laddar upp något:

```bash
cd android && ./gradlew installDebug
```

## Nyckeln

Uppladdningsnyckeln skapades med `node scripts/make-upload-keystore.mjs` och ligger här:

- nyckelfilen: `~/.parkeraisthlm/upload-key.jks` (`C:\Users\Admin\.parkeraisthlm\upload-key.jks` på den här datorn)
- lösenord och alias: `android/keystore.properties` (ignoreras av git)

**Ta en säkerhetskopia av båda filerna och lägg lösenordet i din lösenordshanterare.** Skriptet
skriver aldrig ut lösenordet i terminalen – du hittar det i inställningsfilen.

Med Play App Signing signerar du uppladdningen med den här nyckeln, medan Google håller den
nyckel som användarna faktiskt får. Tappar du uppladdningsnyckeln låser det dig alltså inte
ute: skapa en ny och begär en återställning av uppladdningsnyckeln i Play Console.

Vill du byta lösenord:

```bash
keytool -storepasswd -keystore ~/.parkeraisthlm/upload-key.jks
keytool -keypasswd -alias upload -keystore ~/.parkeraisthlm/upload-key.jks
```

## Bygga i molnet (utan Android Studio)

Arbetsflödet `Android-bygge` körs på en GitHub-maskin och sparar den färdiga appbunten som
en artefakt:

1. Skapa nyckelfilen som base64 (Git Bash):
   `base64 -w0 ~/.parkeraisthlm/upload-key.jks > keystore.b64`
2. Lägg in hemligheterna i repot under **Settings → Secrets and variables → Actions**:
   `ANDROID_UPLOAD_KEYSTORE_BASE64`, `ANDROID_UPLOAD_KEYSTORE_PASSWORD`,
   `ANDROID_UPLOAD_KEY_ALIAS` (`upload`) och `ANDROID_UPLOAD_KEY_PASSWORD`.
3. Kör **Actions → Android-bygge → Run workflow**, eller skicka upp en tagg:
   `git tag android-1.0.0 && git push origin android-1.0.0`.
4. Hämta `app-release-aab` från körningens artefakter. Versionsnumret blir körningens
   nummer, så varje uppladdning får ett högre nummer än den förra.

GitHub-maskinerna är kostnadsfria för publika repon. Glöm inte att radera `keystore.b64` från
datorn efteråt.

## I Play Console

1. Skapa kontot på <https://play.google.com/console> (25 USD), välj kontotyp och verifiera
   identiteten. Väljer du privat konto: räkna med testrundan på 12 testare i 14 dagar.
2. **Skapa app:** namn `ParkiSthlm`, standardspråk svenska, app (inte spel), gratis.
3. **Appinnehåll** – alla formulär måste fyllas i innan publicering:
   - *Åtkomst till appen:* inga inloggningar eller begränsade ytor. Inga testuppgifter behövs.
   - *Annonser:* nej.
   - *Innehållsdeklaration (IARC):* svara på frågeformuläret. Appen har inget våld, ingen
     sexualitet, inga droger, inget spel om pengar, inga användargenererade texter och ingen
     fri webbläsning – svaren landar på lägsta nivån.
   - *Målgrupp:* vuxna/alla åldrar, inte barn. Väljer du en barnkategori drar du på dig
     Families Policy, vilket appen inte behöver.
   - *Datasäkerhet:* se svaren i [google-play-text.md](google-play-text.md). Positionsdata
     lämnar telefonen till routing- och adresstjänster när du startar en rutt eller söker,
     och det ska deklareras.
   - *Integritetspolicy:* `https://nrnworld.one/ParkiSthlm/privacy.html` – måste också nås
     inifrån appen, vilket den gör via "i"-rutan.
4. **Butiksmaterial** – allt ligger färdigt i repot:
   - butiksikon: `public/play-icon-512.png` (512 × 512, 32-bitars PNG **med** alfakanal)
   - grafisk bild: `public/play-feature-banner.png` (1 024 × 500, 24-bitars PNG **utan** alfakanal)
   - telefonbilder: `store/01-karta-och-lista.png`, `02-karta.png`, `03-parkeringsplats.png`,
     `04-elbilsladdning.png`, `05-offline.png` (1 344 × 2 688, alltså exakt 2:1)
   - texterna: [google-play-text.md](google-play-text.md)

   Bilderna i `store/` är tagna direkt från appen som kördes på en Pixel 8 Pro-emulator
   (Android 15), inte renderade på nytt i efterhand. Google tillåter mellan 320 och 3 840
   pixlar per sida och högst 2:1 i förhållande – en skärm på 1 344 × 2 992 är 2,2:1 och
   beskärs därför till 1 344 × 2 688. Vill du ta nya bilder: starta appen, koppla upp mot
   webvyn (`adb forward tcp:9226 localabstract:webview_devtools_remote_<pid>`) och spara
   `adb exec-out screencap -p`. Ta skärmdumpen med adb och inte genom fjärrfelsökningen –
   WebGL-kartan blir tom i den senare. Surfplattebilder (fyra stycken) behövs bara om du
   vill att appen visas på surfplattor i butiken.
5. **Testa:** ladda upp appbunten under *Testning → Intern testning* först, sedan *Sluten
   testning* med dina 12 testare i 14 dagar, och ansök därefter om produktion.
6. **Publicera:** rulla ut till produktion när granskningen är klar. Granskningen tar oftast
   några dagar.

## Två saker som kan komma upp i granskningen

- **Position i bakgrunden används inte.** Behörigheten frågas bara när du trycker på plats-
  eller ruttknappen, och appen ber aldrig om platsen i bakgrunden. Det är också vad
  integritetspolicyn säger.
- **Exakta alarm.** Notisplugin:en lägger till `SCHEDULE_EXACT_ALARM` i manifestet, vilket
  behövs för att P-skivans nedräkning ska slå till på minuten. Användaren får själv ge
  "Alarm och påminnelser" i Android-inställningarna första gången. Frågar granskningen vad
  appen använder exakta alarm till är svaret P-skivan och påminnelsen om bilens plats.
  Vill du slippa behörigheten kan du ta bort den ur manifestet med manifest-merge, men då
  kan notiserna bli något fördröjda.

Det sammanslagna release-manifestet innehåller exakt de här behörigheterna:
`ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`, `ACCESS_NETWORK_STATE`, `INTERNET`,
`POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, `SCHEDULE_EXACT_ALARM` och `WAKE_LOCK`.
Utöver positionen och aviseringarna kommer alltså bara `RECEIVE_BOOT_COMPLETED` och
`WAKE_LOCK` från notisplugin:en. Det finns **inget** `USE_EXACT_ALARM` (den begränsade
varianten som kräver en egen deklaration), ingen `ACCESS_BACKGROUND_LOCATION` och inget
`AD_ID` – alltså inga av de behörigheter som drar på sig extra formulär i Play Console.

## Vad som är provat i den byggda appen

Appen byggdes och kördes på en emulator (Pixel 8 Pro, Android 15), och det här är mätt i den
körande appen – inte bara läst i koden:

| Kontroll | Resultat |
| --- | --- |
| Appen startar och gränssnittet ritas | Ja, 154 parkeringar i listan |
| Baskartan laddas | 14 kartrutor från OpenStreetMap, noll misslyckade anrop |
| Offline-karta | 185 rutor nedladdade (180 av 180 lyckade) och sparade i telefonens IndexedDB. I flygplansläge laddar appen om med **noll** anrop till kartservern och ritar kartan från cachen |
| Systemknappen Tillbaka | Stänger det översta lagret; appen ligger kvar i förgrunden |
| Aviseringsbehörigheten | `requestPermissions` svarar `granted` |
| Platsbehörigheten | Beviljad och positionen används |
| Kantzoner | Webvyn ligger innanför statusrad och gestlist – inget hamnar under systemknapparna |

Det som **inte** går att prova förrän appen ligger på en riktig telefon: de inbyggda
notiserna (P-skivan och påminnelsen om bilens plats), platsrutan mot riktig GPS, länkarna ut
till Google Maps/Waze/Apple Kartor och offline-kartan på en enhet med egen lagring. Provkör
därför appbunten på en telefon innan du laddar upp.

## Checklista innan uppladdning

- [ ] Konto och identitetsverifiering klara i Play Console
- [ ] Appen skapad med paketnamnet `one.nrnworld.parkisthlm`
- [ ] `android/keystore.properties` och nyckelfilen undanlagda på ett säkert ställe
- [x] Signerad appbunt byggd (`android/app/build/outputs/bundle/release/app-release.aab`, 5,1 MB)
- [ ] Appbunten provkörd på en riktig Android-telefon
- [x] Platsbehörigheten och aviseringsbehörigheten provade i appen (beviljat svar)
- [ ] Behörigheterna provade med **nekat** svar
- [x] Systemknappen Tillbaka stänger lager i stället för att lämna appen
- [x] Offline-kartan provad med flygplansläge på
- [ ] Datasäkerhetsformuläret ifyllt, inklusive position till routingtjänsten
- [ ] Integritetspolicy och support-URL ifyllda och läsbara
- [ ] Butikstexter, ikon, grafisk bild och skärmbilder uppladdade
- [ ] Testrunda genomförd (privat konto: 12 testare i 14 dagar i följd)

## Släppa en ny version

1. Höj `versionCode` (och vid behov `versionName`) i `android/app/build.gradle`.
2. Bygg en ny appbunt och ladda upp den under *Produktion → Ny version*.
3. Skriv vad som är nytt och rulla ut.

Webbappen på GitHub Pages uppdateras av sitt eget arbetsflöde och påverkas inte.

## Källor

- Kontotyper, avgift och krav: <https://support.google.com/googleplay/android-developer/answer/6112435>
- Testkrav för privata konton: <https://support.google.com/googleplay/android-developer/answer/14151465>
- Målnivå för API: <https://support.google.com/googleplay/android-developer/answer/11926878>
- Appbuntar: <https://developer.android.com/guide/app-bundle>
- Play App Signing: <https://support.google.com/googleplay/android-developer/answer/9842756>
- Datasäkerhetsformuläret: <https://support.google.com/googleplay/android-developer/answer/10787469>
- Butiksmaterial och mått: <https://support.google.com/googleplay/android-developer/answer/9866151>
