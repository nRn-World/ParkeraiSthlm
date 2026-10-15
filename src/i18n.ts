// Språkstöd: appens källtexter är svenska. På engelska översätts texten i gränssnittet i
// efterhand (ordlista + mönster), så att appens logik och sökord inte påverkas.
// Byte av språk laddar om sidan, så svenska läget kostar ingenting.
import { EN } from "./i18n-en";

export type Lang = "sv" | "en";
const STORAGE_KEY = "parksthlm-lang";

function detectLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "sv" || stored === "en") return stored;
  } catch {
    // localStorage kan saknas i privata fönster.
  }
  const preferred = typeof navigator !== "undefined" && navigator.languages?.length ? navigator.languages : [navigator.language];
  return preferred.some((value) => /^sv\b/i.test(value ?? "")) ? "sv" : "en";
}

export const lang: Lang = detectLang();
export const isEnglish = lang === "en";
export const LOCALE = isEnglish ? "en-GB" : "sv-SE";

export function setLang(next: Lang) {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Ingen lagring tillgänglig – valet gäller då bara till nästa start.
  }
  window.location.reload();
}

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
const cap = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

const DIRECTIONS: Record<string, string> = {
  vänster: "left", höger: "right", "svagt vänster": "slightly left", "svagt höger": "slightly right",
  "skarpt vänster": "sharp left", "skarpt höger": "sharp right",
};
const onto = (road?: string) => (road ? ` onto ${road}` : "");

// Delar av texten som är kategorinamn (lägre skiftläge i meddelanden).
const lower = (value: string) => translateCore(cap(value)).toLowerCase();
const sub = (value: string) => translateCore(value);

type Pattern = [RegExp, (m: RegExpExecArray) => string];
const PATTERNS: Pattern[] = [
  [/^Taxa (\d+)$/, (m) => `Tariff ${m[1]}`],
  [/^Taxa (\d+) enligt gatumarkeringen för (.+)\. Kontrollera alltid skylten på plats\.$/, (m) => `Tariff ${m[1]} according to the street marking for ${m[2]}. Always check the sign on site.`],
  [/^Taxa (\d+) enligt Stockholms stads taxeområde för den här punkten\. Kontrollera alltid skylten på plats\.$/, (m) => `Tariff ${m[1]} according to the City of Stockholm's tariff zone for this point. Always check the sign on site.`],
  [/^Taxa (\d+) – välj rätt zonkod i appen$/, (m) => `Tariff ${m[1]} – choose the right zone code in the app`],
  [/^Taxa (\d+) enligt (?:kartan|taxekartan)$/, (m) => `Tariff ${m[1]} per the map`],
  [/^Taxa (\d+) · (.+)$/, (m) => `Tariff ${m[1]} · ${sub(m[2])}`],
  [/^Stockholm · Taxa (\d+)$/, (m) => `Stockholm · Tariff ${m[1]}`],
  [/^Visa reglerna för taxa (\d+)$/, (m) => `Show the rules for tariff ${m[1]}`],
  [/^Taxa enligt Stockholms stad: (.+)$/, (m) => `Rate per City of Stockholm: ${sub(m[1])}`],
  [/^Taxa: (.+)\. (.+)$/, (m) => `Rate: ${sub(m[1])}. ${m[2]}`],
  [/^Stockholm Parkering: (.+), (.+)\.$/, (m) => `Stockholm Parkering: ${sub(m[1])}, ${m[2]}.`],
  [/^Föreskrift: (.+)$/, (m) => `Regulation: ${m[1]}`],
  [/^Stockholms stad · (.+)$/, (m) => `City of Stockholm · ${m[1]}`],
  [/^Nära (.+)$/, (m) => `Near ${m[1]}`],
  [/^Pågår nu till (.+)$/, (m) => `Ongoing until ${m[1]}`],
  [/^Idag (.+)$/, (m) => `Today ${m[1]}`],
  [/^I morgon (.+)$/, (m) => `Tomorrow ${m[1]}`],
  [/^Parkeringsgarage · (.+)$/, (m) => `Parking garage · ${sub(m[1])}`],
  // Körinstruktioner
  [/^Sväng (vänster|höger|svagt vänster|svagt höger|skarpt vänster|skarpt höger)(?: på (.+))?$/, (m) => `Turn ${DIRECTIONS[m[1]]}${onto(m[2])}`],
  [/^Håll (vänster|höger)(?: på (.+))?$/, (m) => `Keep ${DIRECTIONS[m[1]]}${onto(m[2])}`],
  [/^Fortsätt på (.+)$/, (m) => `Continue on ${m[1]}`],
  [/^Kör ut på (.+)$/, (m) => `Drive out onto ${m[1]}`],
  [/^Ta avfart (\d+) i rondellen(?: på (.+))?$/, (m) => `Take exit ${m[1]} at the roundabout${onto(m[2])}`],
  [/^Kör in i rondellen(?: på (.+))?$/, (m) => `Enter the roundabout${onto(m[1])}`],
  [/^Foga in(?: på (.+))?$/, (m) => `Merge${onto(m[1])}`],
  [/^(.+) kvar · Till (.+)$/, (m) => `${m[1]} left · To ${m[2]}`],
  [/^(\d+) min <i>·<\/i> (.+)$/, (m) => `${m[1]} min <i>·</i> ${m[2]}`],
  // Tider och avgifter
  [/^Max (.+)$/, (m) => `Max ${m[1]}`],
  [/^Maxtid (.+) enligt skyltning · lägg till påminnelse$/, (m) => `Max time ${m[1]} according to signs · add a reminder`],
  [/^(\d+) platser$/, (m) => `${m[1]} spots`],
  [/^(\d+) plats$/, (m) => `${m[1]} spot`],
  [/^(\d+) plats$/, (m) => `${m[1]} spot`],
  [/^(.+) kvar$/, (m) => `${m[1]} left`],
  [/^(\d{1,2}:\d{2}) om (.+)$/, (m) => `${m[1]} in ${m[2]}`],
  [/^Gratis parkering från (.+)\.$/, (m) => `Free parking from ${m[1]}.`],
  [/^Avgift (\d+) kr\/tim börjar (.+)\.$/, (m) => `A fee of ${m[1]} SEK/h starts ${m[2]}.`],
  [/^Avgiften ändras till (\d+) kr\/tim (.+)\.$/, (m) => `The fee changes to ${m[1]} SEK/h ${m[2]}.`],
  [/^Avgiften börjar (.+) med (\d+) kr\/tim – flytta bilen eller betala\.$/, (m) => `The fee starts ${m[1]} at ${m[2]} SEK/h – move the car or pay.`],
  [/^Gratis parkering från (.+)$/, (m) => `Free parking from ${m[1]}`],
  [/^(\d+(?:[.,]\d+)?) kr\/tim (?:just nu|dagtid)$/, (m) => `${m[1]} SEK/h ${/dagtid/.test(m.input) ? "daytime" : "now"}`],
  [/^([\d–]+) kr\/månad eller ([\d–]+) kr\/dygn$/, (m) => `${m[1]} SEK/month or ${m[2]} SEK/day`],
  [/^(\d+(?:[.,]\d+)?)[–-](\d+(?:[.,]\d+)?) kr\/tim enligt APCOA$/, (m) => `${m[1]}–${m[2]} SEK/h according to APCOA`],
  // Parkerad bil och P-skiva
  [/^P-skivan har gått ut \((.+)\)\. Flytta bilen\.$/, (m) => `The parking disc has expired (${m[1]}). Move the car.`],
  [/^(\d+) min kvar på P-skivan \((.+)\)\.$/, (m) => `${m[1]} min left on the parking disc (${m[2]}).`],
  [/^P-skiva startad · (.+) – du får en notis när tiden går ut$/, (m) => `Parking disc started · ${m[1]} – you'll get a notification when time is up`],
  [/^Påminnelse (\d+) min innan avgiften ändras eller servicetiden börjar$/, (m) => `Reminder ${m[1]} min before the fee changes or the service time starts`],
  [/^Påminnelse på · (\d+) min innan avgiften ändras eller servicetiden börjar$/, (m) => `Reminder on · ${m[1]} min before the fee changes or the service time starts`],
  [/^Varnar (\d+) min innan avgiften ändras eller servicetiden börjar\. Appen måste vara öppen för systemnotisen\.$/, (m) => `Warns ${m[1]} min before the fee changes or the service time starts. The app must be open for the system notification.`],
  [/^Servicetid (.+): (.+)\. Flytta bilen i tid\.$/, (m) => `Service time ${m[1]}: ${m[2]}. Move the car in time.`],
  [/^Bilens plats sparades · (.+)$/, (m) => `Car location saved · ${sub(m[1])}`],
  [/^(.+) · Servicetid (.+)$/, (m) => `${sub(m[1])} · Service time ${m[2]}`],
  [/^Nästa tolkade tillfälle: (.+)\. Gäller den markerade gatusträckan\.$/, (m) => `Next interpreted occasion: ${m[1]}. Applies to the marked street section.`],
  [/^(.+) sparad(?: · (.+))? – relevant filter är aktivt$/, (m) => `${m[1]} saved${m[2] ? ` · ${m[2]}` : ""} – the relevant filter is active`],
  [/^Favoriter, (\d+) sparade$/, (m) => `Favourites, ${m[1]} saved`],
  [/^Fordonsprofil, (.+)$/, (m) => `Vehicle profile, ${sub(m[1])}`],
  [/^Ta bort (.+)$/, (m) => `Remove ${m[1]}`],
  [/^Taxa ej karterad här$/, () => "Tariff not mapped here"],
  // Hämtning och meddelanden
  [/^Parkeringar nära (.+) har hämtats$/, (m) => `Parking near ${m[1]} was fetched`],
  [/^Delad parkering finns i listan: (.+)$/, (m) => `Shared parking is in the list: ${m[1]}`],
  [/^Delad parkering tillagd i kartan och listan: (.+)$/, (m) => `Shared parking added to the map and list: ${m[1]}`],
  [/^(\d+) källposter hämtades för (.+) i Stockholmsområdet$/, (m) => `${m[1]} source records were fetched for ${lower(m[2])} in the Stockholm area`],
  [/^(.+) är uppdaterat för hela Stockholmsområdet$/, (m) => `${sub(m[1])} is updated for the whole Stockholm area`],
  [/^All data för (.+) kunde inte hämtas just nu\. Sparad data visas\.$/, (m) => `All data for ${lower(m[1])} could not be fetched right now. Saved data is shown.`],
  [/^Visar (.+) inom (\d+) m från (.+)$/, (m) => `Showing ${lower(m[1])} within ${m[2]} m of ${sub(m[3])}`],
  [/^Kartvyn täcker mer än (\d+) km\. Visar (.+) inom (\d+) km från mitten – zooma in för fler platser\.$/, (m) => `The map view covers more than ${m[1]} km. Showing ${lower(m[2])} within ${m[3]} km of the centre – zoom in for more spots.`],
  [/^Visar (.+) i aktuell kartvy$/, (m) => `Showing ${lower(m[1])} in the current map view`],
  [/^(.+) i kartvyn$/, (m) => `${sub(m[1])} in the map view`],
  [/^(.+) i Stockholmsområdet$/, (m) => `${sub(m[1])} in the Stockholm area`],
  [/^kartans mitt \(max (\d+) km\)$/, (m) => `the map centre (max ${m[1]} km)`],
  [/^Området är för stort för offline-nedladdning\. Zooma in och försök igen \(max (\d+) rutor\)\.$/, (m) => `The area is too large for offline download. Zoom in and try again (max ${m[1]} tiles).`],
  [/^Kunde inte hämta (.+)$/, (m) => `Could not fetch ${m[1]}`],
  [/^Overpass svarade (\d+)$/, (m) => `Overpass responded ${m[1]}`],
  [/^Sparad (.+)$/, (m) => `Saved ${m[1]}`],
  [/^(\d+(?:\.\d+)?) MB$/, (m) => `${m[1]} MB`],
  [/^Max (\d+) min$/, (m) => `Max ${m[1]} min`],
  [/^(.+)-app(?:en)?$/, (m) => `${m[1]} app`],
  [/^Gatuparkering i taxeområde (\d+)\.(?: (.+))?$/, (m) => `Street parking in tariff zone ${m[1]}.${m[2] ? ` ${sub(m[2])}` : ""}`],
  [/^(.+) just nu$/, (m) => `${sub(m[1])} now`],
];

// Föreskriftstexter från stadens öppna data (t.ex. "Alla dagar 00:00-24:00") översätts ordvis.
const WORDS: [RegExp, string][] = [
  [/Alla dagar/g, "All days"], [/Vardagar/g, "Weekdays"], [/vardagar/g, "weekdays"],
  [/Lördagar/g, "Saturdays"], [/lördagar/g, "Saturdays"], [/Söndagar/g, "Sundays"], [/söndagar/g, "Sundays"],
  [/helgdagar/g, "public holidays"], [/Helgdagar/g, "Public holidays"], [/dag före helgdag/g, "day before a public holiday"],
  [/övrig tid/g, "other times"], [/dygnet runt/g, "around the clock"], [/och/g, "and"],
];
const wordwise = (value: string) => WORDS.reduce((text, [pattern, to]) => text.replace(pattern, to), value);

function post(value: string): string {
  return value
    .replace(/(\d),(\d)/g, "$1.$2")
    // \b räknar å/ä/ö som skiljetecken, så ordgränserna skrivs med bokstavsklassen \p{L}.
    .replace(/(?<![\p{L}])kr\/(?:timme|tim)(?![\p{L}])/gu, "SEK/h")
    .replace(/(?<![\p{L}])kr\/månad(?![\p{L}])/gu, "SEK/month")
    .replace(/(?<![\p{L}])kr\/dygn(?![\p{L}])/gu, "SEK/day")
    .replace(/(?<![\p{L}])kr\/kwh/giu, "SEK/kWh")
    .replace(/(?<![\p{L}\/])kr(?![\p{L}\/])/gu, "SEK")
    .replace(/(\d) tim(?![\p{L}])/gu, "$1 h")
    .replace(/(\d) dygn(?![\p{L}])/gu, "$1 days");
}

function translateCore(core: string): string {
  let result: string | undefined = EN[core];
  if (result === undefined) {
    for (const [pattern, build] of PATTERNS) {
      const match = pattern.exec(core);
      if (match) {
        result = build(match);
        break;
      }
    }
  }
  // Flera meningar i rad: översätt var och en för sig om hela texten saknas.
  if (result === undefined && /\.\s+\S/.test(core)) {
    const parts = core.split(/(?<=\.)\s+/);
    if (parts.length > 1 && parts.some((part) => EN[part] !== undefined)) {
      result = parts.map((part) => translateCore(part)).join(" ");
    }
  }
  if (result === undefined && /\d/.test(core)) result = wordwise(core);
  return post(result ?? core);
}

/** Översätter en svensk text till valt språk (svenska returneras oförändrad). */
export function tr(source: string): string {
  if (!isEnglish || !source) return source;
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(source);
  if (!match) return source;
  const core = normalize(match[2]);
  if (!core) return source;
  return match[1] + translateCore(core) + match[3];
}

const TRANSLATED_ATTRIBUTES = ["placeholder", "aria-label", "title", "alt", "data-mobile-label"];
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "CANVAS", "TEXTAREA", "INPUT", "NOSCRIPT"]);

type Record_ = { source: string; shown: string };
const textState = new WeakMap<Node, Record_>();
const attrState = new WeakMap<Element, Map<string, Record_>>();

function translateText(node: Text) {
  const parent = node.parentElement;
  if (!parent || SKIP_TAGS.has(parent.tagName) || parent.closest("[translate='no']")) return;
  const current = node.data;
  const known = textState.get(node);
  if (known && known.shown === current) return;
  const translated = tr(current);
  textState.set(node, { source: current, shown: translated });
  if (translated !== current) node.data = translated;
}

function translateAttributes(element: Element) {
  if (element.closest("[translate='no']")) return;
  for (const attribute of TRANSLATED_ATTRIBUTES) {
    const value = element.getAttribute(attribute);
    if (!value) continue;
    let states = attrState.get(element);
    if (!states) attrState.set(element, (states = new Map()));
    const known = states.get(attribute);
    if (known && known.shown === value) continue;
    const translated = tr(value);
    states.set(attribute, { source: value, shown: translated });
    if (translated !== value) element.setAttribute(attribute, translated);
  }
}

function translateTree(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) {
    translateText(root as Text);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const element = root as Element;
  if (SKIP_TAGS.has(element.tagName)) return;
  translateAttributes(element);
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) translateText(node as Text);
    else translateAttributes(node as Element);
    node = walker.nextNode();
  }
}

/** Startar översättningen av gränssnittet (görs bara när språket är engelska). */
export function startTranslator() {
  if (!isEnglish || typeof document === "undefined") return;
  document.documentElement.lang = "en";
  document.title = tr(document.title);
  translateTree(document.body);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "childList") record.addedNodes.forEach((added) => translateTree(added));
      else if (record.type === "characterData") translateText(record.target as Text);
      else if (record.type === "attributes") translateAttributes(record.target as Element);
    }
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: TRANSLATED_ATTRIBUTES,
  });
}
