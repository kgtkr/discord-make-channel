import * as Discord from "discord.js";
import * as fs from "fs";

function getNameAndCategory(
  message: Discord.Message
): {
  category: Discord.CategoryChannel;
  name: string;
} | null {
  if (
    !(
      message.channel instanceof Discord.TextChannel &&
      message.channel.topic !== null &&
      message.channel.topic.includes("<make-channel>")
    )
  ) {
    return null;
  }

  if (message.channel.parent === null) {
    return null;
  }

  const botUser = client.user;
  if (botUser === null) {
    return null;
  }

  const botMention = `<@!${botUser.id}>`;

  if (!message.content.startsWith(botMention)) {
    return null;
  }

  const name = message.content.slice(botMention.length).trim().toLowerCase();

  if (!(0 < name.length && name.length <= 15)) {
    return null;
  }

  return {
    category: message.channel.parent,
    name,
  };
}

const client = new Discord.Client();

client.on("ready", () => {});

client.on("message", async (message) => {
  try {
    if (getNameAndCategory(message) === null) {
      return;
    }

    await message.react("👍");
  } catch (e) {
    console.error(e);
  }
});

client.on("raw" as any, async (packet) => {
  try {
    if (packet.t !== "MESSAGE_REACTION_ADD") {
      return;
    }

    const data: {
      channel_id: string;
      message_id: string;
      emoji: {
        name: string;
      };
      user_id: string;
    } = packet.d;

    if (data.emoji.name !== "👍") {
      return;
    }

    const channel = await client.channels.fetch(data.channel_id, true);

    if (!(channel instanceof Discord.TextChannel)) {
      return;
    }

    const message = await channel.messages.fetch(data.message_id);

    const info = getNameAndCategory(message);
    if (info === null) {
      return;
    }

    const reaction = message.reactions.cache
      .array()
      .find((reaction) => reaction.emoji.name === "👍");

    if (reaction === undefined) {
      return;
    }

    if (!(reaction.count !== null && reaction.count >= 4)) {
      return;
    }

    const already = channel.guild.channels.cache
      .array()
      .find((channel) => channel.name === info.name);

    if (already !== undefined) {
      return;
    }

    const createChannel = await channel.guild.channels.create(info.name, {
      type: "text",
      parent: info.category,
    });

    await message.reply(`<#${createChannel.id}>`);
  } catch (e) {
    console.log(e);
  }
});

client.login(
  JSON.parse(fs.readFileSync("config.json", { encoding: "utf8" })).token
);
