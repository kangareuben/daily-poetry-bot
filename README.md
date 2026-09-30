# Daily Poetry Bot 🦋

A [Bluesky](https://bsky.app/) bot that posts a short excerpt of public domain poetry once a day, with attribution.

**Follow it at [@dailypoetry.bsky.social](https://bsky.app/profile/dailypoetry.bsky.social).**

```
While on my lonely couch I lie,
I seldom feel myself alone,
For fancy fills my dreaming eye
With scenes and pleasures of its own.

— Anne Bronte, “Dreams”
```

## How excerpts are chosen

Poems come from [PoetryDB](https://poetrydb.org/). Each run, the bot fetches 20 random poems and looks for excerpts that read as a complete thought:

- **Start** at the beginning of the poem, the beginning of a stanza, or after a line ending in `.`, `!`, `?`, `;` or `:`, on a line starting with a capital letter.
- **End** at the end of a sentence (`.`, `!` or `?`), or at the end of a stanza or the poem, unless that last line ends in `,`, `;` or `:`, which usually means the sentence carries on.
- **Stay** within a single stanza, at most 6 lines, and fit in Bluesky's 300-character limit together with the author and title.
- **Skip** lines with no lowercase letters, which are usually headings, epigraphs or speaker labels in verse dramas.

It then picks a random poem with at least one usable excerpt, and a random excerpt from that poem, so long poems aren't favoured. If none of the 20 poems work, it tries a fresh batch, up to 5 times.

PoetryDB's text is cleaned up along the way: `--` becomes an em dash, `_italic_` underscores are removed, and padding spaces are collapsed.

The logic lives in [`src/lib/getPostText.ts`](src/lib/getPostText.ts).

### Known limitations

- A stanza that ends mid-sentence with no punctuation can still produce a fragment.
- PoetryDB includes Middle English (Chaucer), which can be hard to read out of context.
- PoetryDB doesn't guarantee public domain status, though almost all of it is pre-20th century.
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

[`.github/workflows/post.yml`](.github/workflows/post.yml) runs the bot daily at 14:00 UTC, and can also be triggered manually from the Actions tab. Add `BSKY_HANDLE` and `BSKY_PASSWORD` as repository secrets under **Settings → Secrets and variables → Actions**.

Scheduled workflows on GitHub can run late and are disabled after 60 days without repository activity.

## Credits

Built on Phil Nash's [bsky-bot](https://github.com/philnash/bsky-bot) template. Poems from [PoetryDB](https://poetrydb.org/).
