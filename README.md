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
- Öppna destination direkt i **Google Maps** eller **Waze** för röstnavigering

### 🔍 Smart sökning
- Sök på adress, gata, område eller taxa
- Snabbfilter: Garage, Gatuparkering, Gratis, Taxa 1–5
- Sorterar alltid parkeringar närmast din position

### 📡 Live-parkeringsdata
- Hämtar parkeringsplatser från **OpenStreetMap Overpass API** inom 7 km från Stockholms centrum
- Cachas lokalt i webbläsaren (uppdateras var 24:e timme)
- Förkonfigurerade kända p-hus och garage (Citygaraget, Gallerian, Medborgarplatsen, Ringen m.fl.)

### 📴 100 % Offline-kapacitet
- Service Worker cachar hela appen inkl. besökta kartvyer
- Taxor, GPS-position, lokala parkeringar och väglinjer fungerar **utan internet**
- "Spara offline"-knapp för att förbereda telefonen inför körning

### 🌙 Mörkt läge
- Elegant mörkt tema med intelligent kartfiltrering
- Inställningen sparas automatiskt till nästa gång

---

## 🏗️ Teknikstack

| Teknik | Version | Syfte |
|--------|---------|-------|
| [React](https://react.dev/) | 19 | UI-komponentramverk |
| [TypeScript](https://www.typescriptlang.org/) | 5.9 | Typsäker JavaScript |
| [Vite](https://vite.dev/) | 7 | Byggverktyg & dev-server |
| [Leaflet.js](https://leafletjs.com/) | 1.9 | Interaktiv karta |
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
