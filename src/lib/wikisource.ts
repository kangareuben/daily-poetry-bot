import { readFile } from "node:fs/promises";
import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import { USER_AGENT, type Poem } from "./poem.js";

export interface PoemListEntry {
  // Wikisource page title, e.g. "Sonnet 64 (Shakespeare)".
  page: string;
  // Display title, e.g. "Sonnet 64".
  title: string;
  author: string;
}

export const POEM_LIST_PATH = new URL(
  "../../data/wikisource-poems.json",
  import.meta.url
);

const PAGE_API = "https://en.wikisource.org/w/rest.php/v1/page/";
const WIKI_URL = "https://en.wikisource.org/wiki/";

let poemsByAuthor: Map<string, PoemListEntry[]> | undefined;

async function loadPoemsByAuthor() {
  if (!poemsByAuthor) {
    const poemList: PoemListEntry[] = JSON.parse(
      await readFile(POEM_LIST_PATH, "utf8")
    );
    poemsByAuthor = new Map();
    for (const entry of poemList) {
      const poems = poemsByAuthor.get(entry.author) ?? [];
      poems.push(entry);
      poemsByAuthor.set(entry.author, poems);
    }
  }
  return poemsByAuthor;
}

function pickRandom<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

function pageUrl(page: string) {
  // Keep subpage slashes and colons readable, as Wikisource's own links do.
  return (
    WIKI_URL +
    encodeURIComponent(page.replaceAll(" ", "_"))
      .replaceAll("%2F", "/")
      .replaceAll("%3A", ":")
  );
}

async function fetchPageHtml(page: string) {
  const response = await fetch(
    PAGE_API + encodeURIComponent(page.replaceAll(" ", "_")) + "/html",
    {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(30_000),
    }
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Wikisource request for "${page}" failed: ${response.status}`);
  }
  return response.text();
}

// Turns a link like "./Poems_(1898)/Let_Me_Believe#x" into a page title.
function linkToPage(href: string) {
  return decodeURIComponent(href.replace(/^\.\//, "").replace(/#.*$/, ""))
    .replaceAll("_", " ");
}

// Pages in other namespaces (Author:, Portal:, Special:, ...) aren't poems.
export function isContentPage(page: string) {
  return !/^[A-Z][a-z]+:\S/.test(page);
}

// Many poem pages only list the editions that contain the poem ("Versions of
// X include: ..."). Pick the most recent edition, which is the least likely
// to use archaic spelling, or the first if none mention a year.
function pickEdition($: CheerioAPI) {
  let best: { page: string; year: number } | undefined;
  $("li")
    .filter((_, li) => $(li).closest(".wst-header, .navbox").length === 0)
    .each((_, li) => {
      const href = $(li).find("a[rel='mw:WikiLink']").first().attr("href");
      if (!href) return;
      const page = linkToPage(href);
      if (!isContentPage(page)) return;
      const years = [...$(li).text().matchAll(/\b1[5-9]\d\d\b/g)].map(Number);
      const year = years.length ? Math.max(...years) : 0;
      if (!best || year > best.year) best = { page, year };
    });
  return best?.page;
}

// Small caps on a poem's first word render as "THE show is not the show".
function fixDropCap(line: string) {
  return /\p{Ll}/u.test(line)
    ? line.replace(/^(["'‘“]?\p{Lu})(\p{Lu}+)(?=\s)/u, (_, first, rest) =>
        first + rest.toLowerCase()
      )
    : line;
}

function splitStanzas(lines: string[]) {
  const stanzas: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line) {
      current.push(line);
    } else if (current.length) {
      stanzas.push(current);
      current = [];
    }
  }
  if (current.length) stanzas.push(current);
  return stanzas;
}

// Old printings use the long s ("ſ"), which reads as an f to most people.
function cleanLine(text: string) {
  return text.replaceAll("ſ", "s").replace(/\s+/g, " ").trim();
}

// Wikisource formats poems in three ways; returns the stanzas from whichever
// this page uses.
export function extractStanzas(html: string) {
  const $ = cheerio.load(html);
  // Song books give lyrics split into syllables under a score.
  if ($.root().text().includes("A musical score should appear")) return [];
  // Headers, page numbers, footnote markers, licence notices and tables of
  // navigation aren't part of the poem.
  $(
    "style, script, sup, table, .wst-header, .ws-noexport, .navbox, " +
      ".pagenum, .ws-pagenum, .reference, .mw-references-wrap, .licenseContainer"
  ).remove();

  // 1. The {{ppoem}} template: one element per stanza and per line.
  if ($(".ws-poem-line").length) {
    return $(".ws-poem-stanza")
      .toArray()
      .map((stanza) =>
        $(stanza)
          .find(".ws-poem-line")
          .toArray()
          // Unclosed tags on some pages nest the next line inside this one.
          .map((line) =>
            cleanLine($(line).clone().find(".ws-poem-line").remove().end().text())
          )
          .filter(Boolean)
      )
      .filter((stanza) => stanza.length > 0);
  }

  // 2. The <poem> tag, or 3. plain paragraphs with <br> line breaks. Either
  // way each paragraph is a stanza; blank lines inside one also split stanzas.
  let blocks = $(".poem p").toArray();
  if (!blocks.length) blocks = $(".poem").toArray();
  if (!blocks.length) {
    // Centred text is title pages, imprints and headings, not verse.
    blocks = $("p")
      .filter(
        (_, p) =>
          $(p).find("br").length > 0 &&
          $(p).closest(".wst-center, center, [style*='text-align:center']")
            .length === 0
      )
      .toArray();
  }
  return blocks.flatMap((block) => {
    // Source newlines are only formatting; <br> marks the end of a line.
    const inner = ($(block).html() ?? "")
      .replace(/\s*\n\s*/g, " ")
      .replace(/<br[^>]*>/g, "\n");
    const lines = cheerio.load(inner).root().text().split("\n").map(cleanLine);
    return splitStanzas(lines);
  });
}

// Picks an author at random, then one of their poems, so prolific authors
// don't crowd out everyone else. Returns null if the page has no usable text.
export async function getWikisourcePoem(): Promise<Poem | null> {
  const byAuthor = await loadPoemsByAuthor();
  const entry = pickRandom(pickRandom([...byAuthor.values()]));

  let page = entry.page;
  let html = await fetchPageHtml(page);
  if (!html) return null;

  const $ = cheerio.load(html);
  if ($(".wst-header-pretitle").text().includes("Versions of")) {
    const edition = pickEdition($);
    if (!edition) return null;
    page = edition;
    html = await fetchPageHtml(page);
    if (!html) return null;
  }

  const stanzas = extractStanzas(html);
  if (!stanzas.length) return null;
  stanzas[0][0] = fixDropCap(stanzas[0][0]);

  return {
    title: entry.title,
    author: entry.author,
    lines: stanzas.flatMap((stanza, i) => (i ? ["", ...stanza] : stanza)),
    url: pageUrl(page),
  };
}
