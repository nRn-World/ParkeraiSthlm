# Publicera ParkeraiSthlm i App Store

Den här filen är hela vägen från det här repot till en app i App Store, steg för steg.
Texten som ska klistras in i App Store Connect ligger i [appstore-text.md](appstore-text.md).

## Kort om vad som gäller

- **En webbsida kan inte laddas upp till App Store.** Apple tar bara emot ett signerat
  iOS-bygge (`.ipa`), och ett sådant bygge kräver macOS och Xcode 26 eller senare.
- **Du behöver ingen egen Mac.** Bygget kan ske på en lånad moln-Mac (avsnittet
  "Bygg i molnet utan Mac"), medan du jobbar vidare i Windows. Själva kompileringen sker
  fortfarande på macOS – det finns ingen väg runt det.
- **Apple Developer Program kostar 99 USD per år** och krävs för att kunna skicka in en app.

## Vad som redan är klart i repot

| Del | Var | Kommentar |
| --- | --- | --- |
| iOS-projekt (Xcode, Swift Package Manager) | `ios/App` | Genererat med Capacitor 8.5.3, öppnas med `npm run ios:open` |
| Appens ID och namn | `ios/App/App.xcodeproj` + `capacitor.config.ts` | `one.nrnworld.parkeraisthlm`, namnet `ParkeraiSthlm` |
| Ikon 1024×1024 utan genomskinlighet | `public/icon-1024.png` → `ios/App/App/Assets.xcassets/AppIcon.appiconset` | App Store kräver ogenomskinlig 1024-ikon |
| Startbild, ljust och mörkt tema | `ios/App/App/Assets.xcassets/Splash.imageset` | Genereras av `npm run ios:assets` |
| Platsbehörighetens förklaringstext | `ios/App/App/Info.plist` | Utan den visas ingen behörighetsruta i iOS |
| Språk: svenska som huvudspår | `ios/App/App/Info.plist` | `CFBundleDevelopmentRegion = sv`, lokalerna `sv` och `en` |
| Exportefterlevnad | `ios/App/App/Info.plist` | `ITSAppUsesNonExemptEncryption = false` (bara systemets egen kryptering används) |
| Aviseringar, GPS och externa länkar | `src/native.ts` | Riktiga systemnotiser, inbyggd GPS och länkar som lämnar appen – webbversionen är oförändrad |
| Offline-karta utan service worker | `src/tile-cache.ts` | Kartrutor sparas i IndexedDB och läses via MapLibres `transformRequest` |
| Publik integritetspolicy | `public/privacy.html` | `https://nrnworld.one/ParkeraiSthlm/privacy.html` |
| Publik supportsida med kontakt | `public/support.html` | `https://nrnworld.one/ParkeraiSthlm/support.html` |
| Molnbygge | `codemagic.yaml` | Bygger och skickar till TestFlight utan Mac |
| Byggskript | `package.json` | `ios:assets`, `build:native`, `ios:sync` |

Så hänger byggstegen ihop:

```bash
npm ci                 # beroenden enligt package-lock.json
npm run ios:assets     # ikon + iOS-ikoner och startbilder
npm run build:native   # webbappen byggd för att ligga i appen (utan GitHub Pages-prefixet)
npx cap sync ios       # kopierar bygget in i ios/App/App/public och uppdaterar pluginlistan
```

`npm run ios:sync` gör de tre sista stegen i en följd.

### Skillnader mellan webbappen och den inbyggda appen

- Sökvägar: webbappen ligger under `/ParkeraiSthlm/`, appen i paketets rot.
- Service workern laddas inte i appen (den körs på `capacitor://`, där service workers inte
  finns). Appens filer ligger i paketet, och offline-kartan sparas i stället i telefonens
  IndexedDB och läses tillbaka via MapLibres `transformRequest` – se `src/tile-cache.ts`.
  Samma knapp ("Gör appen redo offline") fungerar i båda versionerna.
- Besöksstatistiken (Umami) är avstängd i appen – den finns bara på webbplatsen.
- Påminnelser blir riktiga systemnotiser i stället för webbläsarnotiser.
- Google Maps, Apple Maps och Waze öppnas i telefonens webbläsare i stället för i appens
  eget fönster.

## Det du måste göra själv

### 1. Apple Developer Program

1. Anmäl dig på <https://developer.apple.com/programs/> (99 USD per år, kan betalas privat).
2. Anteckna ditt **Team ID** (10 tecken) från <https://developer.apple.com/account> →
   Membership. Team-ID:t behövs när signeringen sätts upp.

Det tar oftast några dagar innan ett privat medlemskap är godkänt.

### 2. Skapa appen i App Store Connect

1. Gå till <https://appstoreconnect.apple.com> → **My Apps** → **+** → **New App**.
2. Plattform **iOS**, namn **ParkeraiSthlm**, språk **Svenska**, SKU (valfritt internt id,
   t.ex. `parkeraisthlm-1`), användaråtkomst **Full Access**.
3. Bundle-ID: välj `one.nrnworld.parkeraisthlm` i listan. Dyker det inte upp förrän Xcode har
   registrerat det – se nästa punkt.

Namnet kontrolleras mot App Store: ett namn kan bara användas av en app per språk. Är
`ParkeraiSthlm` upptaget får du välja ett annat namn (bundle-ID:t påverkas inte).

### 3. Skapa en App Store Connect-nyckel för molnbygget

För att ladda upp bygget utan att skriva in ditt Apple-ID-lösenord:

1. App Store Connect → **Users and Access** → **Integrations** → **App Store Connect API**.
2. Skapa en nyckel med rollen **App Manager**, ladda ner `.p8`-filen (den går bara att ladda
   ner en gång) och anteckna **Key ID** och **Issuer ID**.

### 4. Certifikat och profil

Enklaste vägen är att låta molntjänsten sköta det:

- **Codemagic:** ladda upp API-nyckeln under *Team integrations → Developer Portal*, och låt
  Codemagic hämta eller skapa distributionscertifikat och App Store-profil under
  *Code signing identities*.

Om du i stället bygger på en egen Mac sköter Xcode det automatiskt när du är inloggad med
ditt Apple-ID (Xcode → Settings → Accounts).

## Bygg i molnet utan Mac (rekommenderad väg)

Codemagic ger personliga konton **500 kostnadsfria macOS-minuter per månad** på en Mac med
M2-processor – gott och väl för en eller ett par releaser i månaden. Över det kostar M2
0,095 USD per minut.

1. Skapa ett konto på <https://codemagic.io> och koppla GitHub-repot.
2. **Team integrations → Developer Portal:** ladda upp App Store Connect-nyckeln från steg 3
   och döp den till `ParkeraiSthlmAppStore` (samma namn som i `codemagic.yaml`).
3. **Code signing identities:** ladda upp eller låt Codemagic hämta ett
   Apple Distribution-certifikat och en App Store-provisioneringsprofil för
   `one.nrnworld.parkeraisthlm`.
4. Välj arbetsflödet **ParkeraiSthlm – App Store** och starta det. Det triggas också
   automatiskt av en git-tagg som börjar på `ios-`, till exempel:

   ```bash
   git tag ios-1.0.0 && git push origin ios-1.0.0
   ```

5. När bygget är klart ligger `.ipa`-filen under *Artifacts* och dyker upp i TestFlight.

Arbetsflödet kör `npm ci`, genererar ikoner, bygger webbappen, synkar in den i iOS-projektet,
sätter versionsnummer och arkiverar. Första gången är `submit_to_app_store: false`, så bygget
går bara till TestFlight – provkör på en riktig telefon först, och ändra sedan till `true`
när du vill att bygget går vidare till granskning.

### Alternativ: GitHub Actions

GitHub Actions har macOS-maskiner (`macos-26`) som är kostnadsfria för publika repon. Ett
sådant bygge kräver att certifikat och profil läggs in som hemligheter och att signeringen
sätts upp i arbetsflödet, vilket är mer arbete än Codemagic-vägen. Kommandona är i så fall:

```bash
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$PWD/build/App.xcarchive" archive

xcodebuild -exportArchive -archivePath "$PWD/build/App.xcarchive" \
  -exportPath "$PWD/build/export" -exportOptionsPlist ios/ExportOptions.plist

xcrun altool --upload-package "$IPA" --type ios \
  --apple-id "$APPLE_ID" --bundle-id one.nrnworld.parkeraisthlm \
  --bundle-version "$BUILD" --bundle-short-version-string "$VERSION" \
  --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"
```

`ExportOptions.plist` behöver då bland annat `method = app-store-connect`,
`destination = export`, `teamID` och `provisioningProfiles`. Kontrollera aktuell syntax mot
Apples dokumentation innan du litar på den – kommandoraden för uppladdning har ändrats över
tid (`--upload-app` är på väg ut till förmån för `--upload-package`).

### Om du lånar en Mac i stället

```bash
npm ci
npm run ios:sync
npm run ios:open        # öppnar ios/App/App.xcworkspace i Xcode
```

I Xcode: välj enheten *Any iOS Device (arm64)*, **Product → Archive**, och därefter
**Distribute App → App Store Connect → Upload**. Byggnumret måste vara högre än förra
uppladdningen.

### Om e-postadressen på webbplatsen

Webbplatsen ligger hos Cloudflare, och deras skydd mot e-postskörd byter annars ut
adressen på integritets- och supportsidan mot en platshållare som bara fungerar när deras
skript laddas. Adresserna skrivs därför med kodat snabel-a, och då lämnas de i fred. Vill du
i stället stänga av funktionen helt: Cloudflare → **Scrape Shield → Email Address
Obfuscation**. Det spelar ingen roll för granskningen – adressen syns i webbläsaren oavsett.

## Skärmbilder

Appen körs på både iPhone och iPad (`TARGETED_DEVICE_FAMILY = "1,2"`), och då kräver Apple
**minst en skärmbild per skärmstorlek**: en för iPhone med Dynamic Island och en för iPad
13 tum. Upp till tio per storlek går bra. Övriga storlekar kan skalas från dessa.

| Enhet | Mått som godtas (stående) |
| --- | --- |
| iPhone med Dynamic Island (mellan) – **krav** | 1179 × 2556 eller 1206 × 2622 |
| iPhone med Dynamic Island (stor) – valfritt | 1260 × 2736, 1290 × 2796 eller 1320 × 2868 |
| iPad 13 tum – **krav** | 2064 × 2752 eller 2048 × 2732 |

Ta skärmbilderna i iOS-simulatorn (Xcode → *Open Developer Tool → Simulator*, välj en
iPhone 16 Pro och en iPad Pro 13 tum) eller på din egen telefon. Fem motiv som visar vad
appen gör är lagom; se förslagen i [appstore-text.md](appstore-text.md).

## Checklista innan du skickar in

- [ ] Apple Developer-medlemskapet är godkänt och Team ID antecknat
- [ ] Appen skapad i App Store Connect med bundle-ID `one.nrnworld.parkeraisthlm`
- [ ] Text, nyckelord, kategorier och URL:er ifyllda enligt `docs/appstore-text.md`
- [ ] Integritetspolicyns URL fungerar och sidan är läsbar: <https://nrnworld.one/ParkeraiSthlm/privacy.html>
- [ ] Support-URL:en fungerar och innehåller kontaktuppgifter: <https://nrnworld.one/ParkeraiSthlm/support.html>
- [ ] Integritetssvaren i App Privacy ifyllda (se `docs/appstore-text.md`)
- [ ] Skärmbilder för iPhone och iPad uppladdade
- [ ] Åldersgränsen satt via frågeformuläret
- [ ] Granskningsnoterna ifyllda, inklusive hur en granskare testar på två minuter
- [ ] Bygget provkört i TestFlight på en riktig telefon: karta, GPS, påminnelse, offline-läge
- [ ] Kontaktuppgifter i App Review-formuläret ifyllda (e-post och gärna telefon)

## Det som avgör om appen blir godkänd

Den största risken är Apples regel 4.2 (minsta funktionalitet): en app som bara är en
webbsida i ett skal avvisas. ParkeraiSthlm har saker som talar för sig – offline-karta,
platsbehörighet som bara används på begäran, lokala påminnelser, sparad bil med
avgiftspåminnelser och överlämning till telefonens egna kartappar – och det är just de
delarna granskaren ska se. Skriv därför i granskningsnoterna vad appen gör och hur man
testar den (texten ligger färdig i [appstore-text.md](appstore-text.md)).

Andra vanliga skäl till avslag som redan är omhändertagna:

| Skäl | Hur repot löser det |
| --- | --- |
| Ikon med genomskinlighet | `public/icon-1024.png` skapas utan alfakanal och kontrolleras i `scripts/make-app-assets.mjs` |
| Saknad förklaring till platsbehörigheten | Texten ligger i `Info.plist` |
| Integritetspolicy saknas | `public/privacy.html` publiceras på en publik adress |
| Ofyllda exportfrågor | `ITSAppUsesNonExemptEncryption = false` |
| Trasiga länkar ut ur appen | Externa länkar öppnas via systemets webbläsare på `src/native.ts` |
| Appen känns som en webbläsare | Ingen adressrad, inga menyer, egen ikon, egen startbild och helt eget skal |

Om appen mot förmodan avvisas kommer skälet i App Store Connect. Texten kan oftast justeras
och skickas in igen utan nytt bygge.

## Släppa en ny version

1. Uppdatera versionen i `ios/App/App.xcodeproj` (`MARKETING_VERSION`, och höj byggnumret
   om du bygger lokalt).
2. Skapa en ny tagg och kör molnbygget: `git tag ios-1.0.1 && git push origin ios-1.0.1`.
3. Provkör i TestFlight, skriv release notes i App Store Connect och skicka in.

Webbappen på GitHub Pages uppdateras av sitt eget arbetsflöde när du pushar till `master` –
den påverkas inte av appbygget.

## Källor

- Apples skärmbildskrav: <https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/>
- App-metadata och gränser: <https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/>
- Åldersgränser: <https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions/>
- Integritetsdeklaration: <https://developer.apple.com/app-store/app-privacy-details/>
- Tredjeparts-SDK:er och integritetsmanifest: <https://developer.apple.com/support/third-party-SDK-requirements/>
- Capacitors iOS-krav: <https://capacitorjs.com/docs/getting-started/environment-setup>
- Codemagic, native iOS: <https://docs.codemagic.io/yaml-quick-start/building-a-native-ios-app/>
- Codemagic, priser: <https://docs.codemagic.io/billing/pricing/>
