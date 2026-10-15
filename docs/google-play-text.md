# Text, bilder och svar att klistra in i Google Play Console

Siffrorna inom parentes är Googles teckenbegränsningar. Ändra fritt – kontrollera längden om
du skriver om.

## Appens identitet

| Fält | Värde |
| --- | --- |
| Paketnamn | `one.nrnworld.parkisthlm` |
| Appnamn (30) | `ParkiSthlm` |
| Kort beskrivning (80) | `Parkering, taxor och avgifter i Stockholm – även offline.` |
| Kategori | Kartor och navigering |
| Taggar | Parkering, Karta, Stockholm |
| Kontakt-e-post | bynrnworld@gmail.com |
| Integritetspolicy | `https://nrnworld.one/ParkiSthlm/privacy.html` |
| Supportwebbplats | `https://nrnworld.one/ParkiSthlm/support.html` |
| Typ av app | App (inte spel), gratis, inga köp i appen |
| Innehållsdeklaration | Lägsta nivån (inga känsliga kategorier) |

## Fullständig beskrivning (4000)

```
ParkiSthlm visar var du får parkera i Stockholm, vad det kostar just nu och hur länge.

Kartan täcker Stockholms fem ordinarie taxeområden med gatuparkering, garage, markparkering, laddplatser och platser som är markerade som gratis. Priset räknas ut för den tid du faktiskt står där, med dagens taxa, avgiftsperioder och gratistimmar.

SÅ FUNGERAR DET
· Tryck på kartan eller sök en adress för att se taxa, timpris och vad som gäller just nu
· Grön, gul och röd färg visar taxenivån i området du tittar på
· Filtret för städnätter visar när gatan servas och bilen behöver flyttas
· Spara din favoritplats och få den direkt på kartan nästa gång

KÖR TILL PLATSEN
· Starta ruttberäkning och få sväng-för-sväng-anvisningar i körläge
· Vägbeskrivningen kan lämnas över till Google Maps, Apple Maps eller Waze
· Kartan fungerar offline när du har laddat ner området

HÅLL KOLL PÅ TIDEN
· P-skiva med nedräkning och påminnelse innan tiden går ut
· Spara bilens plats och få en varning innan avgiften ändras eller en gratisperiod tar slut
· Välj framförhållning på 15 eller 30 minuter

FÖR DIG SOM BOR I STOCKHOLM
· Boendefiltret visar boendetaxan och vilka gator som omfattas
· Utökad area-sökning hittar parkering i ett valfritt område på kartan

BRA ATT VETA
· Allt du sparar ligger i din telefon – ingen inloggning, inga konton, ingen spårning
· Positionshistorik skickas aldrig vidare; GPS används bara när du själv trycker på knappen
· Uppgifterna kommer från Stockholms stad, OpenStreetMap, Open Charge Map, Stockholm Parkering och Nobil
· Vägmärken, skyltning och betalningsapp på plats gäller alltid före kartan

ParkiSthlm är byggd för att vara snabb att öppna när du står vid bilen: ingen registrering, ingen reklam och inga köp inuti appen.
```

## Vad är nytt (release notes, valfritt)

```
Första versionen: karta över Stockholms taxeområden, garage och laddplatser, GPS-navigering med körläge, P-skiva med påminnelse, sparad bil och offline-karta.
```

## Datasäkerhetsformuläret

| Fråga | Svar |
| --- | --- |
| Samlar appen in eller delar någon obligatorisk användardata? | **Ja**, men bara position, och bara när du själv startar en rutt |
| **Plats → Ungefärlig eller exakt position** | Ja. Insamlad: **nej**. Delad: **ja**. Ändamål: **Appfunktioner**. Bearbetning: **Tillfällig** |
| Är uppgifterna krypterade under överföring? | Ja (HTTPS) |
| Kan användaren begära att uppgifterna raderas? | Ja – allt ligger i telefonen och försvinner när appen avinstalleras eller appdata rensas |
| Namn, e-post, telefon, kontakter, ekonomi, hälsa, meddelanden, foton, filer | Inte insamlade |
| Appaktivitet, sökhistorik, enhets-ID, kraschloggar, diagnostik | Inte insamlade |
| Reklam eller spårning | Nej |

Skälet till att position deklareras som **delad**: när du startar en rutt skickas start- och
målpunkt till den publika routingtjänsten OSRM för att vägen ska kunna ritas, och adressökning
går till OpenStreetMap. Uppgifterna används bara för att svara på din förfrågan och sparas
inte av oss eller i appen. Positionshistorik skickas aldrig, och appen innehåller ingen
analys, ingen reklam och inga spårningsverktyg.

## Innehållsdeklarationen (IARC)

| Fråga | Svar |
| --- | --- |
| Våld, skräck, sexualitet, nakenhet, droger, alkohol, tobak, spel om pengar | Nej på alla |
| Grovt språk | Nej |
| Användargenererat innehåll eller sociala funktioner | Nej, appen har inga kommentarer, chattar eller delade flöden |
| Delar användaren sin position med andra användare? | Nej |
| Köp i appen | Nej |
| Fri webbläsning | Nej – appen visar länkar till enskilda externa sidor, inte en öppen webbläsare |
| Reklam | Nej |

Svaren ger lägsta åldersnivå. Ange samma sak under **Målgrupp**: appen riktar sig till vuxna
och är inte gjord för barn, så du slipper Families Policy.

## Bilder

| Bild | Krav | Var den finns |
| --- | --- | --- |
| Butiksikon | 512×512 px, 32-bitars PNG med alfakanal, max 1 024 kB | [play-icon-512.png](../public/play-icon-512.png) (11 kB) |
| Grafisk bild | 1 024×500 px, JPEG eller 24-bitars PNG utan alfakanal | [play-feature-1024x500.png](../public/play-feature-1024x500.png) |
| Telefonbilder | Minst 2, fyra rekommenderas i 1080×1920 (JPEG eller PNG utan alfakanal) | Fem färdiga i [`store/`](../store): karta med lista, helskärmskarta, platskort, elbilsladdning, offline |
| Surfplattebilder | Fyra bilder, 1 080–7 680 px, 16:9 liggande eller 9:16 stående | Behövs bara för surfplattor i butiken – tas med fördel i en surfplatte-emulator |

Den grafiska bilden är en enkel variant med appens ikon på mörk botten. Den går att byta ut
mot en egen bild med rubrik om du vill – kravet är bara måttet och att alfakanalen saknas.

Skärmbilderna i `store/` är tagna från den körande appen på en Pixel 8 Pro-emulator och är
1 344 × 2 688 px (exakt 2:1), utan alfakanal och mellan 0,57 och 4,05 MB. Google tillåter
320–3 840 px per sida, högst 2:1 och högst 8 MB per bild. Vill du ta nya:

- **På en telefon:** koppla in den med USB, kör `cd android && ./gradlew installDebug`, öppna
  appen och ta skärmbilder som vanligt. Kopiera dem med `adb pull /sdcard/Pictures/Screenshots`.
- **I emulatorn:** `adb exec-out screencap -p > bild.png`. Ta skärmdumpen med adb och inte via
  fjärrfelsökningen i Chrome – WebGL-kartan blir tom i den senare. Beskär därefter till högst
  2:1, t.ex. 1 344 × 2 688, och se till att alfakanalen tas bort.
- Tänkbara motiv: karta med taxeområden och platskort, körläge med rutt, P-skiva med
  nedräkning, sparad bil, offline-nedladdning.

## Checklista för butikssidan

- [ ] Appnamn, kort och fullständig beskrivning ifyllda
- [ ] Butiksikon och grafisk bild uppladdade
- [x] Fem telefonbilder färdiga i `store/` (surfplattebilder kvar om appen ska visas på surfplattor)
- [ ] Integritetspolicy och support-URL ifyllda
- [ ] Datasäkerhetsformuläret ifyllt enligt tabellen ovan
- [ ] Innehållsdeklaration och målgrupp ifyllda
- [ ] Kontaktuppgifter till utvecklaren ifyllda
