// Campaign-site watch for the Kroger / Kevin Brown monitor.
// Fetches each campaign website, fingerprints its text so the page can tell
// you when it changed, pulls its headings, counts key terms, and lists any
// recently updated pages from its sitemap.

const crypto = require("crypto");

// kevin: true = the site targets Kevin Brown by name (shown in red).
// focus: for large org sites, only sitemap pages whose URL matches this are listed.
const SITES = [
  { id: "kbscandal", url: "https://kevinbrownscandal.com", host: "The Humane League", kevin: true, note: "Dedicated to Kevin Brown; links his Kroger board seat" },
  { id: "kbexposed", url: "https://kevinbrown.exposed", host: "Animal Equality", kevin: true, note: "Redirect to campaign page targeting Kevin" },
  { id: "whoiskb", url: "https://whoiskevinbrown.com", host: "Center for Responsible Food Business (CRFB)", kevin: true, note: "Main personal targeting hub" },
  { id: "khf", url: "https://www.krogerhurtsfamilies.com", host: "Unknown", kevin: true, note: "Links to whoiskevinbrown.com" },
  { id: "ae", url: "https://animalequality.org", host: "Animal Equality", kevin: true, note: "Kroger campaign portal, Dell action page, action page naming Kevin", focus: "kroger|kevin|dell" },
  { id: "kdc", url: "https://krogerdoesntcare.com", host: "The Humane League", kevin: false, note: "Anti-Kroger domain" },
  { id: "ctk", url: "https://canttrustkroger.com", host: "Unknown", kevin: false, note: "Anti-Kroger domain (live site)" },
  { id: "thl", url: "https://thehumaneleague.org", host: "The Humane League", kevin: false, note: "Campaign action page", focus: "kroger|kevin" },
  { id: "hw", url: "https://www.humaneworld.org", host: "Humane World for Animals", kevin: false, note: "Petition urging Kroger to meet cage-free timeline", focus: "kroger" },
  { id: "mfa", url: "https://mercyforanimals.org", host: "Mercy for Animals", kevin: false, note: "Kroger campaign", focus: "kroger" },
  { id: "aeuk", url: "https://animalequality.org.uk", host: "Animal Equality UK", kevin: false, note: "UK site", focus: "kroger|kevin" },
  { id: "aac", url: "https://animalactivismcollective.com", host: "Animal Activism Collective", kevin: true, note: "Instagram amplifier's site" },
];

const TERMS = {
  "Kevin Brown": /kevin\s+brown/gi, "Kroger": /kroger/gi, "Dell": /\bdell\b/gi, "BCG": /\bBCG\b|boston consulting/gi,
  "Hotchkiss": /hotchkiss/gi, "JFK Library": /jfk library|kennedy library/gi, "GWU": /\bGWU\b|george washington univ/gi,
  "Howard": /\bhoward\b/gi, "cage-free": /cage[- ]free/gi, "protest": /protest|rally/gi, "petition": /petition|sign now|take action/gi,
};
const WATCH_DOMAINS = ["whoiskevinbrown.com", "kevinbrownscandal.com", "kevinbrown.exposed", "krogerdoesntcare.com",
  "canttrustkroger.com", "krogerhurtsfamilies.com", "thehumaneleague.org", "animalequality.org", "humaneworld.org", "mercyforanimals.org"];

const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36" };

async function get(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: UA });
    return { ok: r.ok, status: r.status, url: r.url || url, text: await r.text() };
  } finally { clearTimeout(t); }
}

function decode(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&#8217;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}
function visibleText(html) {
  return decode(html.replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim();
}

function readPage(html, baseUrl) {
  const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "").replace(/\s+/g, " ").trim();
  const heads = [];
  for (const m of html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)) {
    const h = decode(m[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").replace(/\s+([?.!,:;])/g, "$1").trim();
    if (h && h.length < 200 && !heads.includes(h)) heads.push(h);
    if (heads.length >= 30) break;
  }
  const text = visibleText(html);
  const counts = {};
  for (const [k, re] of Object.entries(TERMS)) { const n = (text.match(re) || []).length; if (n) counts[k] = n; }
  let self = "";
  try { self = new URL(baseUrl).hostname.replace(/^www\./, ""); } catch (e) {}
  const links = new Set();
  for (const m of html.matchAll(/href=["']([^"']+)["']/gi)) {
    try {
      const h = new URL(m[1], baseUrl).hostname.replace(/^www\./, "");
      if (h !== self && WATCH_DOMAINS.some(d => h === d || h.endsWith("." + d))) links.add(h);
    } catch (e) {}
  }
  const hash = crypto.createHash("sha1").update(text).digest("hex").slice(0, 16);
  return { title, headings: heads, counts, linksTo: [...links], hash, words: text ? text.split(" ").length : 0 };
}

function parseSitemap(xml) {
  const urls = [], maps = [];
  for (const m of xml.matchAll(/<sitemap>([\s\S]*?)<\/sitemap>/gi)) {
    const loc = (m[1].match(/<loc>\s*([\s\S]*?)\s*<\/loc>/i) || [])[1];
    if (loc) maps.push(decode(loc.replace(/<!\[CDATA\[|\]\]>/g, "")));
  }
  for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
    const loc = (m[1].match(/<loc>\s*([\s\S]*?)\s*<\/loc>/i) || [])[1];
    const mod = (m[1].match(/<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/i) || [])[1];
    if (loc) urls.push({ url: decode(loc.replace(/<!\[CDATA\[|\]\]>/g, "")), lastmod: mod ? new Date(mod).toISOString() : null });
  }
  return { urls, maps };
}

async function recentPages(origin, site, sinceMs) {
  let first;
  try { first = await get(origin + "/sitemap.xml", 5000); } catch (e) { return { found: false, pages: [] }; }
  if (!first.ok || !/<(urlset|sitemapindex)/i.test(first.text)) return { found: false, pages: [] };
  let { urls, maps } = parseSitemap(first.text);
  if (maps.length) {
    const pick = maps.filter(u => /post|page|campaign|action|news|blog|press/i.test(u)).slice(0, 6);
    const kids = await Promise.all((pick.length ? pick : maps.slice(0, 4)).map(u => get(u, 5000).catch(() => null)));
    for (const k of kids) if (k && k.ok) urls = urls.concat(parseSitemap(k.text).urls);
  }
  const focus = site.focus ? new RegExp(site.focus, "i") : null;
  const pages = urls
    .filter(u => focus ? focus.test(u.url) : (u.lastmod && Date.parse(u.lastmod) >= sinceMs))
    .sort((a, b) => (b.lastmod || "").localeCompare(a.lastmod || ""))
    .slice(0, 15)
    .map(u => ({ ...u, recent: !!(u.lastmod && Date.parse(u.lastmod) >= sinceMs) }));
  return { found: true, pages };
}

async function checkSite(site, sinceMs) {
  const out = { ...site, checked: new Date().toISOString() };
  try {
    const r = await get(site.url, 8000);
    out.status = r.status;
    out.finalUrl = r.url;
    out.redirected = r.url.replace(/\/$/, "") !== site.url.replace(/\/$/, "");
    out.up = r.ok;
    Object.assign(out, readPage(r.text, r.url));
    let origin = site.url;
    try { origin = new URL(r.url).origin; } catch (e) {}
    out.sitemap = await recentPages(origin, site, sinceMs);
  } catch (e) {
    out.up = false;
    out.error = String((e && e.message) || e);
  }
  return out;
}

async function handler(req, res) {
  const days = { "1d": 1, "7d": 7, "30d": 30 }[(req.query && req.query.window) || "7d"] || 7;
  const since = Date.now() - days * 86400000;
  const sites = await Promise.all(SITES.map(s => checkSite(s, since)));
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send(JSON.stringify({ generated: new Date().toISOString(), sites }));
}

module.exports = handler;
module.exports._test = { readPage, parseSitemap, SITES };
