import * as Discord from "discord.js";
import * as fs from "fs";

type CmdPayload =
  | {
      type: "create";
      name: string;
    }
  | {
      type: "join";
      channels: Array<number | string>;
    }
  | { type: "leave"; channels: Array<number | string> }
  | { type: "list" };

type Cmd = {
  category: Discord.CategoryChannel;
  userId: string;
  payload: CmdPayload;
};

function msgToCmd(message: Discord.Message): Cmd | null {
  if (
    !(message.channel instanceof Discord.TextChannel) ||
    message.channel.topic === null ||
    !message.channel.topic.includes("<make-channel>") ||
    message.channel.parent === null ||
    message.author.bot
  ) {
    return null;
  }

  const botUser = client.user;
  if (botUser === null) {
    return null;
  }

  const arr = message.content
    .split(/[\s　\,]/g)
    .map((x) => x.trim())
    .filter((x) => x.length !== 0);
  if (arr.length < 2) {
    return null;
  }

  const [expectMention, ...cmds] = arr;

  const botMention = `<@!${botUser.id}>`;

  if (expectMention !== botMention) {
    return null;
  }

  let payload: CmdPayload | null = null;
  if ((cmds[0] === "join" || cmds[0] === "leave") && cmds.length >= 2) {
    payload = {
      type: cmds[0],
      channels: cmds.slice(1).map((x) => {
        const n = Number.parseInt(x);
        if (Number.isNaN(n)) {
          return x;
        } else {
          return n;
        }
      }),
    };
  } else if (cmds[0] === "list") {
    payload = {
      type: "list",
    };
  } else if (cmds.length === 1) {
    payload = {
      type: "create",
      name: cmds[0],
    };
  }

  if (payload !== null) {
    return {
      category: message.channel.parent,
      userId: message.author.id,
      payload,
    };
  } else {
    return null;
  }
}

function filterManageChannel(
  channels: Discord.GuildChannel[]
): Discord.TextChannel[] {
  return channels
    .map((channel) => {
      if (
        channel instanceof Discord.TextChannel &&
        (channel.topic === null || !channel.topic.includes("<make-channel>"))
      ) {
        return channel;
      } else {
        return null;
      }
    })
    .filter((x): x is Discord.TextChannel => x !== null);
}

const client = new Discord.Client();

client.on("ready", () => {});

client.on("message", async (message) => {
  try {
    const cmd = msgToCmd(message);

    if (cmd === null) {
      return;
    }

    if (cmd.payload.type === "create") {
      await message.react("👍");
    } else if (cmd.payload.type === "list") {
      await message.reply(
        "\n" +
          filterManageChannel(cmd.category.children.array())
            .map((channel, i) => `${i}: ${channel.name}`)
            .join("\n")
      );
    } else {
      const channelQuery = cmd.payload.channels;
      const channels = filterManageChannel(
        cmd.category.children.array()
      ).filter((channel, i) =>
        channelQuery.some((query) =>
          typeof query === "number" ? i === query : channel.name.includes(query)
        )
      );

      for (const channel of new Set(channels)) {
        const permission = channel.permissionOverwrites.find(
          (x) => x.type === "member" || x.id === message.author.id
        );

        if (cmd.payload.type === "leave" && permission !== undefined) {
          await permission.delete();
        }

        if (cmd.payload.type === "join") {
          if (permission === undefined) {
            await channel.createOverwrite(message.author.id, {
              VIEW_CHANNEL: true,
            });
          } else {
            await channel.updateOverwrite(message.author.id, {
              VIEW_CHANNEL: true,
            });
          }
        }
      }

      if (cmd.payload.type === "join") {
        await message.reply("権限を付与しました。");
      } else {
        await message.reply("権限を削除しました。");
      }
    }
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

    const cmd = msgToCmd(message);
    if (cmd === null || cmd.payload.type !== "create") {
      return;
    }
    const cmdPayload = cmd.payload;

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
      .find((channel) => channel.name === cmdPayload.name);

    if (already !== undefined) {
      return;
    }

    const createChannel = await channel.guild.channels.create(cmdPayload.name, {
      type: "text",
      parent: cmd.category,
    });

    await createChannel.createOverwrite(client.user!.id, {
      VIEW_CHANNEL: true,
    });

    await createChannel.updateOverwrite(channel.guild.roles.everyone, {
      VIEW_CHANNEL: false,
    });

    for (const user of new Set([
      data.user_id,
      ...(await reaction.users.fetch())
        .array()
        .filter((user) => !user.bot)
        .map((user) => user.id),
    ])) {
      await createChannel.createOverwrite(user, {
        VIEW_CHANNEL: true,
      });
    }

    await message.reply(`<#${createChannel.id}>`);
  } catch (e) {
    console.log(e);
  }
});

client.login(
  JSON.parse(fs.readFileSync("config.json", { encoding: "utf8" })).token
);
