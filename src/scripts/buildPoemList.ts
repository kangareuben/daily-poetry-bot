// Builds data/wikisource-poems.json: every English Wikisource page that
// Wikidata records as a poem, with its title and author. Run with
// `npm run build-poems` to refresh the list.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { USER_AGENT } from "../lib/poem.js";
import {
  isContentPage,
  POEM_LIST_PATH,
  type PoemListEntry,
} from "../lib/wikisource.js";

// Fixes for author names that are wrong on Wikidata, keyed by Wikidata ID,
// e.g. {"Q1235042": "Phoebe Cary"}. Better still, fix the name on Wikidata
// too. An entry that repeats Wikidata's name marks a flagged name as checked,
// so it isn't flagged again.
const OVERRIDES_PATH = new URL(
  "../../data/author-overrides.json",
  import.meta.url
);

// Poems (form of creative work: poem) with an English Wikisource page, plus
// each author's Wikisource author page, used to sanity-check their name.
// Labels are matched directly rather than through the label service, which
// makes the query slow enough to hit Wikidata's 60 second limit.
const QUERY = `
SELECT ?page ?poemLabel ?author ?authorLabel ?authorLang ?authorPage WHERE {
  ?sitelink schema:about ?poem;
    schema:isPartOf <https://en.wikisource.org/>;
    schema:name ?page.
  ?poem wdt:P7937 wd:Q5185279;
    wdt:P50 ?author.
  OPTIONAL { ?poem rdfs:label ?poemLabel. FILTER(LANG(?poemLabel) = "en") }
  OPTIONAL {
    ?author rdfs:label ?authorLabel.
    BIND(LANG(?authorLabel) AS ?authorLang)
    FILTER(?authorLang IN ("en", "mul"))
  }
  OPTIONAL {
    ?authorSitelink schema:about ?author;
      schema:isPartOf <https://en.wikisource.org/>;
      schema:name ?authorPage.
  }
}`;

type Binding = Record<string, { value: string } | undefined>;

// "Poems (1898)/Let Me Believe" -> "Let Me Believe". Some Wikidata labels
// include the book path too.
function lastSegment(title: string) {
  return title.slice(title.lastIndexOf("/") + 1);
}

// "Sonnet 64 (Shakespeare)" -> "Sonnet 64".
function titleFromPage(page: string) {
  return lastSegment(page).replace(/\s*\([^)]*\)$/, "");
}

// Lowercase words without accents: "Ibn Khafājah" -> ["ibn", "khafajah"].
function nameWords(name: string) {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .split(/[^a-z]+/)
    .filter((word) => word.length > 1);
}

function editDistance(a: string, b: string) {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length];
}

// Wikisource names author pages by full name ("Author:Charles Lutwidge
// Dodgson" for Lewis Carroll), so a different name is normal. A word that is
// *nearly* a word of the Wikisource name, though, is probably a typo:
// "Phoebe Caryary" vs "Author:Phoebe Cary". Returns the suspect word pair.
function likelyTypo(name: string, authorPage: string) {
  const reference = nameWords(authorPage.replace(/^Author:/, ""));
  for (const word of nameWords(name)) {
    if (reference.includes(word)) continue;
    const near = reference.find(
      (other) =>
        other[0] === word[0] &&
        (editDistance(word, other) <=
          Math.max(1, Math.floor(Math.min(word.length, other.length) / 3)) ||
          word.startsWith(other) ||
          other.startsWith(word))
    );
    if (near) return `${word} ~ ${near}`;
  }
  return null;
}

async function readOverrides(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(OVERRIDES_PATH, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

const response = await fetch(
  "https://query.wikidata.org/sparql?query=" + encodeURIComponent(QUERY),
  {
    headers: {
      Accept: "application/sparql-results+json",
      "User-Agent": USER_AGENT,
    },
    signal: AbortSignal.timeout(120_000),
  }
);
if (!response.ok) {
  throw new Error(`Wikidata query failed: ${response.status}`);
}
const bindings: Binding[] = (await response.json()).results.bindings;

// Collect each author's name, preferring English over the language-neutral
// ("mul") one, and each page's title and authors.
interface AuthorInfo {
  name?: string;
  lang?: string;
  authorPage?: string;
}
const authors = new Map<string, AuthorInfo>();
const pages = new Map<string, { title?: string; authorIds: Set<string> }>();
for (const row of bindings) {
  const page = row.page?.value;
  const authorUri = row.author?.value;
  if (!page || !authorUri || !isContentPage(page)) continue;
  const authorId = authorUri.slice(authorUri.lastIndexOf("/") + 1);

  const author = authors.get(authorId) ?? {};
  const name = row.authorLabel?.value;
  const lang = row.authorLang?.value;
  if (name && (!author.name || (author.lang !== "en" && lang === "en"))) {
    author.name = name;
    author.lang = lang;
  }
  author.authorPage ??= row.authorPage?.value;
  authors.set(authorId, author);

  const entry = pages.get(page) ?? { authorIds: new Set<string>() };
  entry.title ??= row.poemLabel?.value;
  entry.authorIds.add(authorId);
  pages.set(page, entry);
}

// Apply overrides, and flag names that look misspelled for review.
const overrides = await readOverrides();
const warnings: string[] = [];
for (const [id, author] of authors) {
  const override = overrides[id];
  if (override) {
    // An override matching Wikidata marks a flagged name as checked.
    author.name = override;
  } else if (author.name && author.authorPage) {
    const typo = likelyTypo(author.name, author.authorPage);
    if (typo) {
      warnings.push(
        `${id}: "${author.name}" vs Wikisource "${author.authorPage}" (${typo})`
      );
    }
  }
}

const poems: PoemListEntry[] = [];
let skipped = 0;
for (const [page, { title, authorIds }] of pages) {
  const names = [...authorIds]
    .map((id) => authors.get(id)?.name)
    .filter((name) => name !== undefined);
  // Without an author name there's nothing to attribute the poem to.
  if (names.length === 0) {
    skipped++;
    continue;
  }
  poems.push({
    page,
    title: title ? lastSegment(title) : titleFromPage(page),
    author: names.join(" and "),
  });
}
poems.sort((a, b) => a.page.localeCompare(b.page));

// One poem per line keeps diffs readable when the list is refreshed.
await mkdir(new URL(".", POEM_LIST_PATH), { recursive: true });
await writeFile(
  POEM_LIST_PATH,
  "[\n" + poems.map((poem) => JSON.stringify(poem)).join(",\n") + "\n]\n"
);

const authorCount = new Set(poems.map((poem) => poem.author)).size;
console.log(
  `Wrote ${poems.length} poems by ${authorCount} authors ` +
    `(skipped ${skipped} without an author name)`
);
if (warnings.length) {
  console.warn(
    `\nCheck these author names. To fix one, add its ID and the correct ` +
      `name to data/author-overrides.json (and ideally fix it on Wikidata):\n` +
      warnings.map((warning) => `  ${warning}`).join("\n")
  );
}
