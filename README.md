# 🅿️ Parkera i Stockholm – Realtidskarta för gatuparkering

> **Hitta rätt parkering, korrekt taxa och snabbaste vägen – direkt i mobilen, även offline.**

[![Licens: Icke-kommersiell](https://img.shields.io/badge/Licens-Icke--kommersiell-blue.svg)](./LICENSE)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Vite 7](https://img.shields.io/badge/Vite-7-646CFF?logo=vite)](https://vite.dev/)
[![OpenStreetMap](https://img.shields.io/badge/Karta-OpenStreetMap-7EBC6F?logo=openstreetmap)](https://www.openstreetmap.org/)

---

## 📌 Vad är appen?

**Parkera i Stockholm** är en modern, interaktiv och mobilanpassad webbapplikation som hjälper dig att snabbt hitta parkering och se gällande taxor i Stockholms stad – direkt i webbläsaren utan att ladda ner någon app.

Appen visar Stockholms stads officiella fem taxeområden (Taxa 1–5) med korrekta priser och tider enligt Trafikkontorets taxebestämmelser. Den hämtar även realtidsdata om parkeringsplatser via OpenStreetMap.

> ⚠️ **Vägmärken och skyltning på plats gäller alltid.** Kontrollera alltid skylten på gatan innan du parkerar. Appen är ett hjälpmedel – inte ett rättsligt bindande dokument.

---

## ✨ Funktioner

### 🗺️ Interaktiv taxekarta
- Färgkodade zoner för Stockholms fem officiella taxeområden (Taxa 1–5)
- Klicka var som helst på kartan för att se vilken taxa som gäller och priset **just nu**
- Reverse geocoding visar exakt gatunamn vid kartkick (kräver internet)

### 💰 Officiella taxor (Stockholms stad, 2025)

| Taxa | Timpris | Avgiftstider |
|------|---------|--------------|
| **Taxa 1** | 55 kr/tim | Dygnet runt, alla dagar |
| **Taxa 2** | 31 kr/tim | Vardagar 07–21, lördag & helgdag 09–19 (20 kr övrig tid) |
| **Taxa 3** | 20 kr/tim | Vardagar 07–19 (lördag 11–17: 15 kr/tim, övrig tid: gratis) |
| **Taxa 4** | 10 kr/tim | Vardagar 07–19 och lördag 11–17 (övrig tid: gratis) |
| **Taxa 5** | 5 kr/tim | Vardagar 07–19 (övrig tid: gratis) |

*Källa: [Stockholms stad – Parkering](https://parkering.stockholm)*

### 📍 GPS & Navigering
- Hitta din nuvarande position med ett klick
- Beräkna bilväg med restid och avstånd till valfri parkering
- Öppna destination direkt i **Google Maps**, **Apple Maps** eller **Waze** för röstnavigering

### 🔍 Smart sökning
- Sök på adress, gata, område eller taxa
- Snabbfilter: Garage, Gatuparkering, Gratis, Boende, Städnatt och Taxa 1–5
- Listan kan sorteras på **närmast**, **billigast** eller **gratis nu** (elbilar kan även sorteras på **starkast**), och "Visa fler" fortsätter bortom de första 20 träffarna
- Rubriken i listan är gatunamnet; föreskriftstypen (t.ex. "P-avgift endast besök") visas som etikett
- Föreskriftstaxor utanför taxa 1–5 visas som **belopp** i listan, och hela skrivningen samlas i ett eget kort i platskortet

### 🧹 Servicetider och städnätter
- **Städnatt** visar gator med maskinläsbar servicetid som börjar inom ett dygn
- Sparad bil varnar om en tolkad servicetid börjar inom 48 timmar
- Otolkbara scheman visas, men tolkas inte automatiskt; vägmärket gäller alltid

### 🏠 Boendeparkering
- **Boende** filtrerar platser med boendetaxa i föreskriftstexten
- Välj boendeområde från stadsdelsnamnen i föreskrifterna
- Platskortet visar boendetaxa per månad/dygn där föreskriften anger den

### 🧮 P-avgiftskalkylator
- Välj start, sluttid och taxa 1–5
- Beräknar totalen från taxans timpris i fem minuters steg, inklusive gratisperioder
- Visar prisperioder; betalningsappar kan avrunda annorlunda

### ⚡ Elbil och laddning
- Filtrera på minsta effekt och kontakt: Type 2, CCS, CHAdeMO eller Tesla
- Troliga operatörer länkas till operatörens karta och officiella app
- Platser utan kontaktuppgifter filtreras bort när effekt eller kontakt väljs

### 💳 Betalning
- Platskort länkar till officiella guider för EasyPark, Parkster och Stockholm Parkering
- Betala P är nedlagd; zonkoden på skylten avgör vilken app som gäller
- Inga zonkoder gissas i appen

### 🔗 Dela parkering
- Dela-knappen på varje platskort skapar en länk med `?spot=<id>&lat=..&lng=..&title=..`
- Länken öppnar inget kort av sig själv: platsen läggs till som en vanlig, valbar plats i kartan och listan (exakt plats via id, koordinater som reserv)
- Därifrån kan mottagaren öppna platsen, trycka **Parkera här** eller dela den vidare

### ⏱️ P-skiva-timer
- Platskortet har en **P-skiveknapp** (blå parkeringsskiva); den fäller ut maxtid, tider och startknapp först när man trycker på den
- Välj 30 min / 1 / 2 / 3 tim och starta – nedräkning i kortet och global banner
- En pågående nedräkning håller rutan utfälld; Avbryt fäller ihop den igen
- P-skivan är ett tillval: **Visa inte P-skiva** i kortet eller På/Av under Fordonsprofil → P-skiva-timer stänger av den och tar bort en pågående nedräkning
- Avstängd P-skiva går alltid att slå på igen: **Ångra** i notisen direkt efteråt, eller raden **P-skiva avstängd · Slå på** i platskortet, eller På under Fordonsprofil
- Varnar 10 min innan och notifierar när tiden går ut (lokalt, appen måste vara öppen)

### 🚗 Min parkerade bil
- Spara var bilen står (GPS, vald parkering eller valfri kartpunkt) med plats och anteckning
- Registreringsnummer (valfritt) i Fordonsprofilen visas på bilkortet
- Taxan på platsen sparas vid tillfället: kortet visar **pris nu**, när avgiften ändras och en nedräkning till dess
- Valfri påminnelse 15 eller 30 minuter innan gratisperioden tar slut, avgiften börjar eller en tolkad servicetid börjar. Notiser är lokala och kräver att appen är öppen; det finns ingen serverbaserad push

### 📡 Live-parkeringsdata
- Hämtar parkeringsplatser från **OpenStreetMap Overpass API** inom 7 km från Stockholms centrum
- Cachas i IndexedDB i webbläsaren (uppdateras var 24:e timme) – rymmer stora datamängder utan localStorage-tak
- Förkonfigurerade kända p-hus och garage (Citygaraget, Gallerian, Medborgarplatsen, Ringen m.fl.)

### 📴 100 % Offline-kapacitet
- Service Worker cachar hela appen inkl. besökta kartvyer
- Taxor, GPS-position, lokala parkeringar och väglinjer fungerar **utan internet**
- "Spara offline"-knapp för att förbereda telefonen inför körning

### 🌙 Mörkt läge
- Elegant mörkt tema med intelligent kartfiltrering
- Inställningen sparas automatiskt till nästa gång

---

### 📈 Användningsstatistik
- Anonym, cookiefri räkning av besök och några få knapptryck (P-skiva, dela, parkera här, spara offline) via Umami Cloud
- Endast utvecklaren ser siffrorna; instrumentpanelen är inloggningsskyddad
- Webbplats-id:t sätts i `index.html` (`UMAMI_WEBSITE_ID`). Tomt värde stänger av statistiken, och på localhost laddas ingenting

## 🏗️ Teknikstack

| Teknik | Version | Syfte |
|--------|---------|-------|
| [React](https://react.dev/) | 19 | UI-komponentramverk |
| [TypeScript](https://www.typescriptlang.org/) | 5.9 | Typsäker JavaScript |
| [Vite](https://vite.dev/) | 7 | Byggverktyg & dev-server |
| [MapLibre GL JS](https://maplibre.org/) | 6 | Interaktiv karta med 3D-perspektiv i körläge (2D/3D-val i Profil) |
| [OpenStreetMap](https://www.openstreetmap.org/) | – | Kartbilder & adressdata |
| [Framer Motion](https://www.framer.com/motion/) | 12 | Animationer & transitions |
| [Lucide React](https://lucide.dev/) | 1.24 | Ikoner |
| [TailwindCSS](https://tailwindcss.com/) | 4 | Styling |
| [vite-plugin-singlefile](https://github.com/richardtallent/vite-plugin-singlefile) | – | Single-file offline-build |

---

## 🚀 Kom igång

### Krav
- [Node.js](https://nodejs.org/) version **18 eller senare**
- [npm](https://www.npmjs.com/) (ingår med Node.js)

### Steg 1 – Klona projektet

```bash
git clone https://github.com/nRn-World/ParkeraiSthlm.git
cd ParkeraiSthlm
```

### Steg 2 – Installera beroenden

```bash
npm install
```

### Steg 3 – Starta utvecklingsservern

```bash
npm run dev
```

Appen öppnas på `http://localhost:5173` i din webbläsare.

### Steg 4 – Bygg för produktion (offline-redo)

Bygger en optimerad, fristående HTML-fil där all JavaScript, CSS och logik är inbäddad:

```bash
npm run build
```

Den färdiga filen finns i `dist/index.html` och kan öppnas direkt i valfri webbläsare – utan webbserver.

### Steg 5 – Kvalitetskontroll

```bash
npm run typecheck
```

Kör TypeScript-kontrollen utan att bygga. Rekommenderas före varje pull request.

---

## 📂 Projektstruktur

```
stockholm-parking-zone-map/
├── src/
│   ├── App.tsx          # Huvudkomponent med all kartlogik och UI
│   ├── data.ts          # Taxedata, parkeringsplatser och hjälpfunktioner
│   ├── index.css        # Stilar, animationer och mörkt läge
│   └── main.tsx         # Appens entrypoint
├── public/
│   └── sw.js            # Service Worker för offline-stöd
├── index.html           # HTML-mall
├── vite.config.ts       # Vite-konfiguration
├── tsconfig.json        # TypeScript-konfiguration
└── package.json         # Beroenden och skript
```

---

## 🗃️ Datakällor

Appen använder enbart öppna och tillförlitliga datakällor:

| Källa | Användning |
|-------|------------|
| [Stockholms stad – Trafikkontoret](https://parkering.stockholm) | Officiella taxeområden och priser |
| [OpenStreetMap](https://www.openstreetmap.org/) (Overpass API) | Realtidsdata för parkeringsplatser |
| [OpenStreetMap Nominatim](https://nominatim.org/) | Adressökning och reverse geocoding |
| [OSRM](https://project-osrm.org/) | Vägberäkning och ruttinformation |
| [Stockholm Parkering](https://www.stockholmparkering.se/parkeringar/betala-parkering/) | Anläggningspriser, kapacitet och godkända betalningsappar |
| [Open Charge Map](https://openchargemap.org/) och [NOBIL](https://nobil.no/) | Laddplatser, kontakter och effekter |

---

## ⚙️ Konfiguration och anpassning

Taxedata och parkeringsplatser finns i [`src/data.ts`](./src/data.ts):

- **`TARIFFS`** – Taxebeskrivningar, priser och tider
- **`TAX_AREAS`** – Taxezonernas geografiska polygoner (WGS84-koordinater)
- **`TAX_STREETS`** – Gatumarkeringar med taxa
- **`LOCAL_PARKING`** – Förkonfigurerade kända p-hus och gatuparkering
- **`getCurrentPrice()`** – Beräknar aktuellt pris baserat på klockslag och veckodag

---

## 📱 Använd på mobil (utan appbutik)

1. Öppna appen i **Chrome** (Android) eller **Safari** (iPhone)
2. Tryck på dela-ikonen → **"Lägg till på hemskärm"**
3. Appen beter sig som en native-app med fullskärmsläge

Tryck på **"Spara offline"** i appen för att ladda ner kartvyer och taxedata för körning utan nätanslutning.

---

## 🍏 iPhone- och iPad-app (App Store)

Samma app finns även som inbyggd iOS-app. Xcode-projektet ligger i `ios/` och byggs med
Capacitor 8; webbappen på GitHub Pages är oförändrad.

```bash
npm ci
npm run ios:sync      # ikoner + appbygge + synk in i ios/
npm run ios:open      # öppnar projektet i Xcode (kräver macOS)
```

- **Bygga utan Mac:** [codemagic.yaml](./codemagic.yaml) bygger och skickar bygget till
  TestFlight på en moln-Mac. Hela vägen står i [docs/APPSTORE.md](./docs/APPSTORE.md).
- **Butikstexter och integritetssvar:** [docs/appstore-text.md](./docs/appstore-text.md).
- I den inbyggda appen blir påminnelser riktiga systemnotiser, externa länkar öppnas i
  telefonens webbläsare och besöksstatistiken är avstängd. Se [src/native.ts](./src/native.ts).
- Eftersom service workers inte finns på `capacitor://` sparas offline-kartans rutor i
  IndexedDB i stället: [src/tile-cache.ts](./src/tile-cache.ts).
- Integritetspolicy: <https://nrnworld.one/ParkeraiSthlm/privacy.html> ·
  Support: <https://nrnworld.one/ParkeraiSthlm/support.html>

---

## 🤝 Bidra till projektet

Bidrag är välkomna! Om du hittar felaktig taxeinformation, vill lägga till parkeringsplatser eller förbättra UX:

1. Forka projektet
2. Skapa en ny branch (`git checkout -b feature/din-ändring`)
3. Committa dina ändringar
4. Skicka en Pull Request

Vänligen notera att projektet är **icke-kommersiellt**. Se [LICENSE](./LICENSE) för fullständiga villkor.

---

## ⚖️ Licens

Projektet är licensierat under en **anpassad icke-kommersiell licens**.

✅ Du får: ladda ner, köra, studera och modifiera koden för personligt bruk och utbildning.  
❌ Du får inte: sälja, tjäna pengar på, lägga till annonser eller på annat sätt kommersialisera appen.

Se [LICENSE](./LICENSE) för fullständiga villkor.

---

## 👤 Upphovsman

Skapad av **nRn World**  
GitHub: [github.com/nRn-World](https://github.com/nRn-World)

---

*Parkera smart. Kör säkert. Kontrollera alltid skylten på gatan.* 🚗

---

☕ **Support development**: [Buy me a coffee 💜](https://ko-fi.com/nrnworld)

Created by ❤️ © nRn World
