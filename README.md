# Daily Poetry Bot 🦋

A [Bluesky](https://bsky.app/) bot that posts a short excerpt of public domain poetry once a day, with attribution.

Poems come from [PoetryDB](https://poetrydb.org/). The bot fetches a batch of random poems, finds excerpts that start and end on sentence boundaries (so they read as complete thoughts), and posts one that fits in Bluesky's 300-character limit along with the author and title.

Built on Phil Nash's [bsky-bot](https://github.com/philnash/bsky-bot) template.

## Running locally

You need Node.js 22 and a Bluesky account for the bot (use an [App Password](https://bsky.app/settings/app-passwords), not the account password).

```sh
npm install
cp .env.example .env   # then fill in BSKY_HANDLE and BSKY_PASSWORD
npm run build
DRY_RUN=true npm run dev   # prints the post without publishing it
npm run dev                # publishes for real
```

## Deployment

[`.github/workflows/post.yml`](.github/workflows/post.yml) runs the bot daily at 14:00 UTC, and can also be triggered manually from the Actions tab. Add `BSKY_HANDLE` and `BSKY_PASSWORD` as repository secrets under **Settings → Secrets and variables → Actions**.

Scheduled workflows on GitHub can run late and are disabled after 60 days without repository activity.
