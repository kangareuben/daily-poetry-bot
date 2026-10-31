# Daily Poetry Bot 🦋

A [Bluesky](https://bsky.app/) bot that posts a short excerpt of public domain poetry once a day, with attribution and a link to the full poem.

**Follow it at [@dailypoetry.bsky.social](https://bsky.app/profile/dailypoetry.bsky.social).**

```
While on my lonely couch I lie,
I seldom feel myself alone,
For fancy fills my dreaming eye
With scenes and pleasures of its own.

— Anne Bronte, “Dreams”
```

## Where poems come from

Poems come from [English Wikisource](https://en.wikisource.org/), which only hosts texts that are public domain in the US (or freely licensed).

[`data/wikisource-poems.json`](data/wikisource-poems.json) lists about 3,400 poems by over 500 authors: every Wikisource page that [Wikidata](https://www.wikidata.org/) records as a poem, minus volunteer translations (which are Creative Commons licensed, not public domain). Refresh it occasionally with:

```sh
npm run build-poems
```

Each run, the bot picks an author at random and then one of their poems, so prolific authors like Emily Dickinson (about 700 poems) don't crowd out the hundreds of authors with just one. It then fetches the poem's page and extracts the text:

- Many pages are "versions" pages that only list the editions containing the poem. The bot follows the link to the most recent edition, which is the least likely to use archaic spelling.
- Wikisource formats poems in three ways (the `{{ppoem}}` template, the `<poem>` tag, or plain paragraphs with line breaks), and the extractor handles all three. Headers, page numbers, footnote markers and centred title-page text are dropped, as are pages of sheet music.
- Drop capitals (`THE show is not the show`) and the long s (`ſ`) are normalized.

If a page yields no usable excerpt, the bot tries another poem, up to 8 times. In testing about 80% of poems produce one. If Wikisource is down, it falls back to [PoetryDB](https://poetrydb.org/), which has about 3,200 poems by 129 authors.

The post includes a link card to the poem's Wikisource page. The code lives in [`src/lib/wikisource.ts`](src/lib/wikisource.ts) and [`src/lib/poetrydb.ts`](src/lib/poetrydb.ts).

## How excerpts are chosen

Within a poem, the bot looks for excerpts that read as a complete thought:

- **Start** at the beginning of the poem, the beginning of a stanza, or after a line ending in `.`, `!`, `?`, `;` or `:`, on a line starting with a capital letter.
- **End** at the end of a sentence (`.`, `!` or `?`), or at the end of a stanza or the poem, unless that last line ends in `,`, `;` or `:`, which usually means the sentence carries on.
- **Stay** within a single stanza, at most 6 lines, and fit in Bluesky's 300-character limit together with the author and title.
- **Skip** lines with no lowercase letters, which are usually headings, epigraphs or speaker labels in verse dramas.

It picks one of the poem's usable excerpts at random. The logic lives in [`src/lib/getPostText.ts`](src/lib/getPostText.ts).

### Known limitations

- A stanza that ends mid-sentence with no punctuation can still produce a fragment.
- Wikisource page layouts vary; an unusual one can occasionally produce a stray line from outside the poem.
- Translated poems are attributed to the original poet; the translator isn't named.
- Author names and titles come from Wikidata, so mistakes there show up in posts. `npm run build-poems` flags author names that look like misspellings of the author's Wikisource page name (for example "Phoebe Caryary" vs "Phoebe Cary"). Fix one by adding its Wikidata ID and the correct name to [`data/author-overrides.json`](data/author-overrides.json), and ideally on Wikidata too. An entry that repeats Wikidata's own name marks a flagged name as checked. Titles aren't checked.
- Nothing tracks what has been posted, so repeats are possible.

## Running locally

You need Node.js 22 and a Bluesky account for the bot (use an [App Password](https://bsky.app/settings/app-passwords), not the account password).

```sh
npm install
cp .env.example .env   # then fill in BSKY_HANDLE and BSKY_PASSWORD
npm run build
DRY_RUN=true npm run dev   # prints the post without publishing it
npm run dev                # publishes for real
```

A dry run still logs in to Bluesky, so it also checks your credentials.

## Deployment

[`.github/workflows/post.yml`](.github/workflows/post.yml) builds and runs the bot. Add `BSKY_HANDLE` and `BSKY_PASSWORD` as repository secrets under **Settings → Secrets and variables → Actions**. You can run it by hand from the Actions tab.

GitHub's built-in `schedule` trigger proved unreliable (runs were dropped entirely), so the workflow is started daily at 14:17 UTC by [cron-job.org](https://cron-job.org), which calls GitHub's API:

```
POST https://api.github.com/repos/kangareuben/daily-poetry-bot/actions/workflows/post.yml/dispatches
Authorization: Bearer <token>
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28

{"ref": "main"}
```

The token is a fine-grained personal access token limited to this repository with only the **Actions: Read and write** permission. It expires, so it needs replacing periodically.

## Credits

Built on Phil Nash's [bsky-bot](https://github.com/philnash/bsky-bot) template. Poems from [Wikisource](https://en.wikisource.org/), indexed through [Wikidata](https://www.wikidata.org/), with [PoetryDB](https://poetrydb.org/) as a fallback.
