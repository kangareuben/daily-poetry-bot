import { RichText } from "@atproto/api";

interface Poem {
  title: string;
  author: string;
  lines: string[];
}

const POEMS_URL = "https://poetrydb.org/random/20";
const MAX_GRAPHEMES = 300;
const MAX_EXCERPT_LINES = 6;
const MIN_EXCERPT_LENGTH = 25;
const MAX_ATTEMPTS = 5;

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

function formatPost(excerpt: string, poem: Poem) {
  return `${excerpt}\n\n— ${poem.author}, “${poem.title}”`;
}

// Find runs of lines that start at the beginning of a sentence and end at the
// end of a sentence or stanza, so the excerpt reads as a complete thought.
function findExcerpts(poem: Poem) {
  // PoetryDB writes em dashes as "--", marks italics with underscores, and
  // sometimes pads lines with runs of spaces.
  const lines = poem.lines.map((line) =>
    line.trim().replaceAll("--", "—").replaceAll("_", "").replace(/\s+/g, " ")
  );
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
        graphemeLength(formatPost(excerpt, poem)) <= MAX_GRAPHEMES
      ) {
        excerpts.push(excerpt);
      }
      break;
    }
  }

  return excerpts;
}

async function fetchPoems(): Promise<Poem[]> {
  const response = await fetch(POEMS_URL, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`PoetryDB request failed: ${response.status}`);
  }
  return response.json();
}

function pickRandom<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

export default async function getPostText() {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Pick a poem first, then an excerpt, so long poems with many candidate
    // excerpts aren't favoured.
    const usable = (await fetchPoems())
      .map((poem) => ({ poem, excerpts: findExcerpts(poem) }))
      .filter(({ excerpts }) => excerpts.length > 0);
    if (usable.length > 0) {
      const { poem, excerpts } = pickRandom(usable);
      return formatPost(pickRandom(excerpts), poem);
    }
  }
  throw new Error(`No usable excerpt found after ${MAX_ATTEMPTS} attempts`);
}
