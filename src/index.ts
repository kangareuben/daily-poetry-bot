import { env } from "node:process";
import Bot from "./lib/bot.js";
import getPostText from "./lib/getPostText.js";

const dryRun = env.DRY_RUN === "true";

const text = await Bot.run(getPostText, { dryRun });

console.log(
  `[${new Date().toISOString()}] ${dryRun ? "Dry run" : "Posted"}: "${text}"`
);
