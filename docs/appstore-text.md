# Text och svar att klistra in i App Store Connect

Allt här är skrivet för att passa Apples teckenbegränsningar. Siffrorna inom parentes är
max antal tecken. Ändra fritt – men kontrollera längden om du skriver om.

## Appens identitet

| Fält | Värde |
| --- | --- |
| Apple-ID (bundle ID) | `one.nrnworld.parkisthlm` |
| Namn (30) | `ParkiSthlm` |
| Underrubrik (30) | `Parkering & taxor i Stockholm` |
| Kategori | Primär: **Navigation** · Sekundär: **Travel** |
| Åldersgräns | 4+ (frågeformuläret avgör: inga användargenererade texter, inget socialt, ingen reklam och ingen fri webbläsning – bara supportsidan) |
| Copyright | `© 2026 nRn World` |
| Support-URL | `https://nrnworld.one/ParkiSthlm/support.html` |
| Marknadsförings-URL | `https://nrnworld.one/ParkiSthlm/` |
| Integritetspolicy-URL | `https://nrnworld.one/ParkiSthlm/privacy.html` |
| Appens språk | Svenska (engelska texter finns i integritetspolicyn) |

Namnet kontrolleras mot hela App Store när appen skapas. Är `ParkiSthlm` upptaget får du
byta namn – bundle-ID:t och ikonen påverkas inte av det.

## Promotional text (170)

```
Parkeringskartan för Stockholm: fem taxeområden, garage, laddplatser och gatuparkering med aktuellt timpris. GPS-navigering, P-skiva och offline-karta. Vägmärket på plats gäller alltid.
```

## Beskrivning (4000)

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

## Nyckelord (100, kommatecken, inga mellanslag efter kommatecken)

```
parkering,stockholm,taxa,avgift,parkeringszon,garage,laddplats,skiva,boendeparkering,parkera
```

## Vad är nytt (release notes, valfritt)

```
Första versionen för iPhone och iPad: karta över Stockholms taxeområden, garage och laddplatser, GPS-navigering med körläge, P-skiva med påminnelse, sparad bil och offline-karta.
```

## Integritetssvar (App Privacy)

Appen har ingen egen server och skickar inte något till utvecklaren. Statistik är avstängd i
den inbyggda appen. Rekommenderad ifyllnad:

| Fråga i App Store Connect | Svar |
| --- | --- |
| Samlar appen in data? | **Ja** (bara position, för att kunna räkna ut en rutt) |
| **Location → Precise Location** | Kryssa för. Används till: **App Functionality**. *Linked to you:* **Nej**. *Used for tracking:* **Nej** |
| Namn, e-post, telefon, kontakter, hälsa, ekonomi, foton, meddelanden | Inte insamlade |
| Identifierare, användningsdata, diagnostik, köp | Inte insamlade |
| Reklam och spårning | Nej, ingen reklam-SDK och inget spårningstillstånd behövs (ingen ATT-fråga visas) |

Skälet till att position kryssas för: när du startar en rutt skickas start- och målpunkt till
den publika routingtjänsten OSRM för att vägen ska kunna ritas, och adressökning går till
OpenStreetMap. Positionshistorik skickas aldrig; positionen används annars helt i telefonen.

Apple definierar "samlar in" som att uppgifter skickas från enheten på ett sätt som gör att
utvecklaren eller en tredje part kan komma åt dem längre än vad som behövs för att svara på
förfrågan i realtid. Enligt den definitionen är själva ruttberäkningen ingen insamling, så
**Nej, appen samlar inte in data** är också ett försvarbart svar. Den publika demo-servern
för OSRM kan dock logga förfrågningar, och därför är det kryssade alternativet ovan det säkra
och rekommenderade – det kostar ingenting och kan inte bli fel. Oavsett val ska
integritetspolicyn beskriva flödet, och det gör den.

## Granskningsnoter (App Review Information → Notes)

```
ParkiSthlm är en parkeringskarta för Stockholm och kräver inget konto, ingen inloggning och inga köp. Ingen demoinloggning behövs.

Så testar du på 2 minuter:
1. Tryck på den blå platsknappen till höger för att ge platsbehörighet (frågas bara då).
2. Sök "Stureplan" i sökfältet eller tryck direkt på kartan. Ett platskort visar taxa, timpris och vad som gäller just nu.
3. Tryck "Kör hit" för ruttberäkning – vägen ritas och körläget följer positionen.
4. Öppna P-skivan från platskortet och starta timern: en nedräkning visas tillsammans med en lokal påminnelse.
5. Öppna "i"-knappen för källor, integritetspolicy och nedladdning av offline-karta.

Appen är ett genuint inbyggt skal runt kartan och fungerar i sin helhet utan internet: parkeringsdata, taxor, offline-kartrutor, sparad bil, P-skiva och GPS är lokala. Ny adressökning och vägrutt kräver nät.

Data kommer från Stockholms stads öppna data, OpenStreetMap, Open Charge Map, Stockholm Parkering och Nobil. Appen har ingen server, inga användarkonton och ingen analys i den inbyggda versionen (statistik finns bara på webbplatsen).

Platsbehörigheten används enbart när användaren själv trycker på plats- eller ruttknappen. Om behörigheten nekats fungerar kartan ändå, med rutten från kartans mitt.
```

Kontaktuppgifter i granskningsformuläret: `bynnrworld@gmail.com`. Ange en telefon som kan nås
under granskningen om du har en.

## Skärmbilder

Apple kräver **minst en skärmbild per skärmstorlek** och tillåter upp till tio. Eftersom
appen körs på både iPhone och iPad behövs två uppsättningar: en för iPhone med Dynamic
Island (mellanstorlek) och en för iPad 13 tum. Måtten finns i tabellen i
[APPSTORE.md](APPSTORE.md#skärmbilder).

Förslag på motiv, i den ordning de visas (ta fem på varje enhet):

1. Karta med taxeområden i färg och platskort med timpris
2. Körläge med rutt och svänganvisning
3. P-skiva med nedräkning och påminnelse
4. Sparad bil med avgiftsändring
5. Offline-karta och nedladdning

Lägg till en kort bildtext på varje bild (t.ex. "Timpris direkt när du trycker på kartan").
