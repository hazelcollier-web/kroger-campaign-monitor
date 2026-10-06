// News scan for the Kroger / Kevin Brown campaign monitor.
// Runs the alert searches through Google News RSS, merges duplicates,
// tags each headline with the key terms it contains, and ranks them.

const SEARCHES = [
  { id: "kb_kroger", label: "Kevin Brown + Kroger", kevin: true,
    q: '"Kevin Brown" Kroger (animal OR cage-free OR cruelty OR eggs)' },
  { id: "kb_dell", label: "Kevin Brown + Dell", kevin: true,
    q: '"Kevin Brown" Dell (animal OR cruelty OR cage-free OR board)' },
  { id: "kb_affil", label: "Kevin Brown + affiliations", kevin: true,
    q: '"Kevin Brown" ("JFK Library" OR "John F. Kennedy Library" OR Hotchkiss OR GWU OR "George Washington University" OR Howard OR BCG OR "Boston Consulting Group") (animal OR cruelty OR protest)' },
  { id: "kb_groups", label: "Kevin Brown + groups", kevin: true,
    q: '"Kevin Brown" ("Humane League" OR "Animal Equality" OR CRFB OR "Center for Responsible Food Business" OR "Animal Activism Collective")' },
  { id: "kb_broad", label: "Kevin Brown master Boolean", kevin: true,
    q: '"Kevin Brown" (Kroger OR Dell OR "Animal Equality" OR "Animal Activism" OR CRFB OR "animal cruelty" OR protest OR whoiskevinbrown OR BCG OR Hotchkiss OR "JFK Library" OR GWU OR Howard)' },
  { id: "kroger", label: "Kroger animal-welfare campaign", kevin: false,
    q: 'Kroger ("cage-free" OR "animal cruelty" OR "Humane League" OR "Animal Equality" OR "Mercy for Animals" OR "Humane World")' },
  { id: "site_thl", label: "thehumaneleague.org", kevin: false, q: 'site:thehumaneleague.org (Kroger OR "Kevin Brown")' },
  { id: "site_ae", label: "animalequality.org", kevin: false, q: 'site:animalequality.org (Kroger OR "Kevin Brown" OR Dell)' },
  { id: "site_aeuk", label: "animalequality.org.uk", kevin: false, q: 'site:animalequality.org.uk (Kroger OR "Kevin Brown")' },
  { id: "site_hw", label: "humaneworld.org", kevin: false, q: "site:humaneworld.org Kroger" },
  { id: "site_mfa", label: "mercyforanimals.org", kevin: false, q: "site:mercyforanimals.org Kroger" },
];

// Key terms to flag inside each result. Group decides the chip color.
const TERMS = [
  ["kevin", "Kevin Brown", ["Kevin Brown", "whoiskevinbrown", "kevinbrownscandal", "kevinbrown.exposed"]],
  ["group", "The Humane League", ["Humane League", "THL"]],
  ["group", "Animal Equality", ["Animal Equality", "Igualdad Animal"]],
  ["group", "CRFB", ["CRFB", "Center for Responsible Food Business", "Taylor Warren Ford"]],
  ["group", "Animal Activism Collective", ["Animal Activism Collective", "Animal Activism"]],
  ["group", "Mercy for Animals", ["Mercy for Animals"]],
  ["group", "Humane World", ["Humane World", "Humane Society"]],
  ["affil", "Kroger", ["Kroger"]],
  ["affil", "Dell", ["Dell"]],
  ["affil", "BCG", ["Boston Consulting Group", "BCG"]],
  ["affil", "Hotchkiss", ["Hotchkiss"]],
  ["affil", "JFK Library", ["JFK Library", "John F. Kennedy Library", "Kennedy Library"]],
  ["affil", "GWU", ["George Washington University", "GWU", "GW University"]],
  ["affil", "Howard", ["Howard University", "Howard"]],
  ["issue", "cage-free", ["cage-free", "cage free", "caged hens", "battery cages"]],
  ["issue", "eggs", ["egg", "eggs"]],
  ["issue", "animal cruelty", ["animal cruelty", "cruelty", "animal welfare", "abuse"]],
  ["issue", "protest", ["protest", "protester", "rally", "demonstration", "picket"]],
  ["issue", "petition", ["petition", "campaign", "pledge"]],
  ["issue", "board", ["board", "director", "shareholder"]],
];

function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function wordRe(w) { return new RegExp("(?<![A-Za-z0-9])" + esc(w) + "(?:s|es)?(?![A-Za-z0-9])", "i"); }
const COMPILED = TERMS.map(([group, label, words]) => ({ group, label, res: words.map(wordRe) }));

function tagTerms(text) {
  const hits = [];
  for (const t of COMPILED) if (t.res.some(re => re.test(text))) hits.push({ group: t.group, label: t.label });
  return hits;
}

function score(hits) {
  let p = 0;
  for (const h of hits) p += h.group === "kevin" ? 5 : h.group === "group" ? 3 : h.group === "affil" ? 2 : 1;
  return p;
}

function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}
function tag(block, name) {
  const m = block.match(new RegExp("<" + name + "[^>]*>([\\s\\S]*?)</" + name + ">", "i"));
  return m ? decode(m[1]) : "";
}
function stripHtml(s) { return decode(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }

function parseRss(xml) {
  const items = [];
  for (const b of xml.match(/<item>[\s\S]*?<\/item>/gi) || []) {
    let title = tag(b, "title");
    const link = tag(b, "link");
    const pub = tag(b, "pubDate");
    const source = tag(b, "source");
    const srcUrl = (b.match(/<source[^>]*url="([^"]+)"/i) || [])[1] || "";
    if (source && title.endsWith(" - " + source)) title = title.slice(0, -(source.length + 3)).trim();
    const snippet = stripHtml(tag(b, "description")).replace(title, "").replace(source, "").trim();
    if (!title || !link) continue;
    items.push({ title, link, source, sourceUrl: srcUrl, snippet, date: pub ? new Date(pub).toISOString() : null });
  }
  return items;
}

const WINDOWS = { "1d": "when:1d", "7d": "when:7d", "30d": "when:30d" };

async function fetchSearch(s, win) {
  const q = s.q + " " + WINDOWS[win];
  const url = "https://news.google.com/rss/search?q=" + encodeURIComponent(q) + "&hl=en-US&gl=US&ceid=US:en";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; LaurelMonitor/1.0)" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return { id: s.id, ok: true, items: parseRss(await r.text()) };
  } catch (e) {
    return { id: s.id, ok: false, error: String(e.message || e), items: [] };
  } finally { clearTimeout(timer); }
}

// Merge results from all searches into one ranked list.
function merge(results) {
  const byKey = new Map();
  for (const r of results) {
    const search = SEARCHES.find(s => s.id === r.id);
    for (const it of r.items) {
      const key = it.title.toLowerCase().replace(/\W+/g, " ").trim();
      let row = byKey.get(key);
      if (!row) {
        const hits = tagTerms(it.title + " " + it.snippet);
        row = { ...it, hits, score: score(hits), searches: [] };
        // A "Kevin Brown" search hit with no other key term in the headline
        // may be a different Kevin Brown (athlete, actor, etc.).
        row.namesKevin = hits.some(h => h.group === "kevin");
        row.contextOnly = hits.filter(h => h.group !== "kevin").length === 0;
        byKey.set(key, row);
      }
      if (!row.searches.includes(search.label)) row.searches.push(search.label);
    }
  }
  return [...byKey.values()].sort((a, b) =>
    (b.namesKevin - a.namesKevin) || (b.score - a.score) || (b.date || "").localeCompare(a.date || ""));
}

async function handler(req, res) {
  const win = WINDOWS[(req.query && req.query.window) || ""] ? req.query.window : "7d";
  const results = await Promise.all(SEARCHES.map(s => fetchSearch(s, win)));
  const status = results.map(r => ({ id: r.id, label: SEARCHES.find(s => s.id === r.id).label, ok: r.ok, error: r.error || null, count: r.items.length }));
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send(JSON.stringify({ generated: new Date().toISOString(), window: win, status, items: merge(results) }));
}

module.exports = handler;
module.exports._test = { parseRss, merge, tagTerms, SEARCHES };
