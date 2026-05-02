// bot.js — RBX Press Reporter Token Bot
// Deploy on Railway, Render, or any Node.js host
// 
// Required env vars:
//   DISCORD_BOT_TOKEN    — your bot token from discord.com/developers
//   DISCORD_GUILD_ID     — your server ID
//   DISCORD_REPORTER_ROLE_ID — the Reporter role ID
//   BASE44_APP_ID        — found in your Base44 editor URL (/apps/YOUR_APP_ID/editor)

import { Client, GatewayIntentBits } from "discord.js";
import { createClient } from "@base44/sdk";
import crypto from "crypto";

// --- Config ---
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const REPORTER_ROLE_ID = process.env.DISCORD_REPORTER_ROLE_ID;
const BASE44_APP_ID = process.env.BASE44_APP_ID;
const CHECK_INTERVAL_MS = 2 * 60 * 1000; // check every 2 minutes
const TOKEN_COOLDOWN_MS = 30 * 60 * 1000; // 30 min after use

// --- Clients ---
const discord = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const base44 = createClient({ appId: BASE44_APP_ID });

// --- Helpers ---
function generateToken() {
  return "RPT-" + crypto.randomBytes(12).toString("hex").toUpperCase();
}

async function issueToken(discordUserId, discordUsername) {
  const tokenValue = generateToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24hr expiry

  await base44.entities.Token.create({
    token_value: tokenValue,
    discord_user_id: discordUserId,
    discord_username: discordUsername,
    used: false,
    expires_at: expiresAt,
  });

  return tokenValue;
}

async function dmReporter(userId, tokenValue) {
  const user = await discord.users.fetch(userId);
  await user.send(
    `📰 **RBX Press — Reporter Token**\n\nHere is your token to submit your next article:\n\`\`\`\n${tokenValue}\n\`\`\`\nHead to the submission portal and paste this token to publish. It expires in 24 hours and can only be used once.`
  );
}

// --- On startup: issue tokens to all reporters who don't have one ---
async function issueInitialTokens() {
  console.log("Checking for reporters without tokens...");
  const guild = await discord.guilds.fetch(GUILD_ID);
  const members = await guild.members.fetch();

  const reporters = members.filter((m) => m.roles.cache.has(REPORTER_ROLE_ID));

  for (const [userId, member] of reporters) {
    // Check if they have an active unused token
    const existing = await base44.entities.Token.filter({
      discord_user_id: userId,
      used: false,
    });

    if (!existing || existing.length === 0) {
      try {
        const token = await issueToken(userId, member.user.username);
        await dmReporter(userId, token);
        console.log(`Issued initial token to ${member.user.username}`);
      } catch (err) {
        console.error(`Failed to DM ${member.user.username}:`, err.message);
      }
    }
  }
}

// --- Periodic check: re-issue tokens 30min after use ---
async function checkAndReissue() {
  console.log("Running token reissue check...");
  const cutoff = new Date(Date.now() - TOKEN_COOLDOWN_MS).toISOString();

  // Get all used tokens where used_at was 30+ mins ago
  const usedTokens = await base44.entities.Token.filter({ used: true });

  for (const t of usedTokens) {
    if (!t.used_at || t.used_at > cutoff) continue;

    // Check if they already have a fresh unused token
    const fresh = await base44.entities.Token.filter({
      discord_user_id: t.discord_user_id,
      used: false,
    });

    if (fresh && fresh.length > 0) continue;

    try {
      const newToken = await issueToken(t.discord_user_id, t.discord_username);
      await dmReporter(t.discord_user_id, newToken);
      console.log(`Re-issued token to ${t.discord_username}`);
    } catch (err) {
      console.error(`Failed to re-issue to ${t.discord_username}:`, err.message);
    }
  }
}

// --- Start ---
discord.once("ready", async () => {
  console.log(`Bot logged in as ${discord.user.tag}`);
  await issueInitialTokens();
  setInterval(checkAndReissue, CHECK_INTERVAL_MS);
});

discord.login(DISCORD_BOT_TOKEN);
