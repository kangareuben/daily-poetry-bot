import type { Poem } from "./poem.js";

const POEMS_URL = "https://poetrydb.org/random/20";

// Fetches a batch of random poems from PoetryDB.
export async function fetchPoetryDbPoems(): Promise<Poem[]> {
  // PoetryDB routinely takes 5-10 seconds to return a batch of poems.
  const response = await fetch(POEMS_URL, {
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    throw new Error(`PoetryDB request failed: ${response.status}`);
  }
  const poems: Poem[] = await response.json();
  // PoetryDB writes em dashes as "--" and marks italics with underscores.
  return poems.map((poem) => ({
    ...poem,
    lines: poem.lines.map((line) =>
      line.replaceAll("--", "—").replaceAll("_", "")
    ),
  }));
}
