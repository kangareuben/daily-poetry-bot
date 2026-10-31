export interface Poem {
  title: string;
  author: string;
  // Stanzas are separated by empty strings.
  lines: string[];
  // Where to read the full poem, if the source has a page for it.
  url?: string;
}

// Identifies the bot to the APIs it calls, as Wikimedia's policy asks.
export const USER_AGENT =
  "dailypoetrybot/1.0 (https://github.com/kangareuben/daily-poetry-bot)";
