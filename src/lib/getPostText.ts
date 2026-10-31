import { RichText } from "@atproto/api";
import type { AppBskyFeedPost } from "@atproto/api";
import type { Poem } from "./poem.js";
import { fetchPoetryDbPoems } from "./poetrydb.js";
import { getWikisourcePoem } from "./wikisource.js";

// The post text, plus a link card to the full poem when there's a page for it.
export type PostContent = Pick<AppBskyFeedPost.Record, "text" | "embed">;

const MAX_GRAPHEMES = 300;
const MAX_EXCERPT_LINES = 6;
const MIN_EXCERPT_LENGTH = 25;
// Most Wikisource poems yield an excerpt; the rest are prose poems, sheet
// music or pages in a format the extractor doesn't handle.
const WIKISOURCE_ATTEMPTS = 8;
const POETRYDB_ATTEMPTS = 5;

// A line ending with one of these (optionally followed by closing quotes or
// brackets) ends a sentence, so the next line is a good place to start.
const SENTENCE_END = /[.!?]["'’”)\]]*$/;
const CLAUSE_END = /[.!?;:]["'’”)\]]*$/;
const CONTINUES = /[,;:][—–-]?["'’”)\]]*$/;
const STARTS_UPPERCASE = /^["'‘“(]*\p{Lu}/u;
const HAS_LOWERCASE = /\p{Ll}/u;

function graphemeLength(text: string) {
  return new RichText({ text }).graphemeLength;
}

function formatPost(excerpt: string, poem: Poem): PostContent {
  const text = `${excerpt}\n\n— ${poem.author}, “${poem.title}”`;
  if (!poem.url) return { text };
  return {
    text,
    embed: {
      $type: "app.bsky.embed.external",
      external: {
        uri: poem.url,
        title: `${poem.title} by ${poem.author}`,
        description: "Read the full poem on Wikisource",
      },
    },
  };
}

// Find runs of lines that start at the beginning of a sentence and end at the
// end of a sentence or stanza, so the excerpt reads as a complete thought.
function findExcerpts(poem: Poem) {
  const lines = poem.lines.map((line) => line.replace(/\s+/g, " ").trim());
  const excerpts: string[] = [];

  for (let start = 0; start < lines.length; start++) {
    const previous = lines[start - 1];
    const startsSentence =
      previous === undefined || previous === "" || CLAUSE_END.test(previous);
    if (!startsSentence || !STARTS_UPPERCASE.test(lines[start])) continue;

    for (
      let end = start;
      end < lines.length && end < start + MAX_EXCERPT_LINES;
      end++
    ) {
      // Stanza breaks end the search: a sentence spanning one reads badly.
      if (lines[end] === "") break;

      // The end of a stanza or poem is a natural stopping point whatever the
      // punctuation, unless a trailing comma or similar shows the sentence
      // carries on.
      const next = lines[end + 1];
      const endsStanza = next === undefined || next === "";
      const complete =
        SENTENCE_END.test(lines[end]) ||
        (endsStanza && !CONTINUES.test(lines[end]));
      if (!complete) continue;

      const excerptLines = lines.slice(start, end + 1);
      const excerpt = excerptLines.join("\n");
      if (
        excerpt.length >= MIN_EXCERPT_LENGTH &&
        // All-caps lines are headings, epigraphs or speaker labels, not verse.
        excerptLines.every((line) => HAS_LOWERCASE.test(line)) &&
        graphemeLength(formatPost(excerpt, poem).text) <= MAX_GRAPHEMES
      ) {
        excerpts.push(excerpt);
      }
      break;
    }
  }

  return excerpts;
}

function pickRandom<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

async function fromWikisource() {
  for (let attempt = 1; attempt <= WIKISOURCE_ATTEMPTS; attempt++) {
    let poem: Poem | null;
    try {
      poem = await getWikisourcePoem();
    } catch (error) {
      console.warn(`Wikisource attempt ${attempt} failed:`, error);
      continue;
    }
    if (!poem) continue;

    const excerpts = findExcerpts(poem);
    if (excerpts.length > 0) {
      console.log(`Source: ${poem.url}`);
      return formatPost(pickRandom(excerpts), poem);
    }
  }
  return null;
}

async function fromPoetryDb() {
  let lastError: unknown;
  for (let attempt = 1; attempt <= POETRYDB_ATTEMPTS; attempt++) {
    let poems: Poem[];
    try {
      poems = await fetchPoetryDbPoems();
    } catch (error) {
      // A slow or failed request shouldn't cost the day's post; try again.
      console.warn(`PoetryDB attempt ${attempt} failed:`, error);
      lastError = error;
      continue;
    }

    // Pick a poem first, then an excerpt, so long poems with many candidate
    // excerpts aren't favoured.
    const usable = poems
      .map((poem) => ({ poem, excerpts: findExcerpts(poem) }))
      .filter(({ excerpts }) => excerpts.length > 0);
    if (usable.length > 0) {
      const { poem, excerpts } = pickRandom(usable);
      console.log("Source: PoetryDB");
      return formatPost(pickRandom(excerpts), poem);
    }
  }
  throw new Error(
    `No usable excerpt from PoetryDB after ${POETRYDB_ATTEMPTS} attempts`,
    { cause: lastError }
  );
}

// Wikisource has far more authors than PoetryDB, plus a page to link to, so
// it's the main source; PoetryDB is the fallback if Wikisource is down.
export default async function getPostText(): Promise<PostContent> {
  const post = await fromWikisource();
  if (post) return post;
  console.warn("No usable Wikisource poem; falling back to PoetryDB");
  return fromPoetryDb();
}
