// bot.js — RBX Press Reporter Token Bot
import { Client, GatewayIntentBits } from "discord.js";
import { createClient } from "@base44/sdk";
import crypto from "crypto";

// --- Config ---
const DISCORD_BOT_TOKEN = "MTUwMDIyNjgwNTIzNDEzOTE5Ng.GbKciZ.lE2Mei5DnLktW8G5acVFHGundwscRxDWilvmR8";
const GUILD_ID = "1500198344763641996";
const REPORTER_ROLE_ID = "1500198344763641997";
const BASE44_APP_ID = "69f657eef87bd972d6faeb58";
const CHECK_INTERVAL_MS = 2 * 60 * 1000;
const TOKEN_COOLDOWN_MS = 30 * 60 * 1000;

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
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

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

async function issueInitialTokens() {
  console.log("Checking for reporters without tokens...");
  const guild = await discord.guilds.fetch(GUILD_ID);
  const members = await guild.members.fetch();
  const reporters = members.filter((m) => m.roles.cache.has(REPORTER_ROLE_ID));

  for (const [userId, member] of reporters) {
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

async function checkAndReissue() {
  console.log("Running token reissue check...");
  const cutoff = new Date(Date.now() - TOKEN_COOLDOWN_MS).toISOString();
  const usedTokens = await base44.entities.Token.filter({ used: true });

  for (const t of usedTokens) {
    if (!t.used_at || t.used_at > cutoff) continue;

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

discord.once("ready", async () => {
  console.log(`Bot logged in as ${discord.user.tag}`);
  await issueInitialTokens();
  setInterval(checkAndReissue, CHECK_INTERVAL_MS);
});

discord.login(DISCORD_BOT_TOKEN);
