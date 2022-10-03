import * as Discord from "discord.js";

function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue === undefined) {
      throw new Error(`Environment variable "${key}" is not defined.`);
    }
    return defaultValue;
  }
  return value;
}

const token = getEnv("DISCORD_TOKEN");

type CmdPayload =
  | {
      type: "create";
      name: string;
    }
  | {
      type: "join";
      channels: Array<number | string | null>;
    }
  | { type: "leave"; channels: Array<number | string | null> }
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

  const [prefix, ...cmds] = arr;

  const expectPrefix = "mc";

  if (prefix !== expectPrefix) {
    return null;
  }

  let payload: CmdPayload | null = null;
  if ((cmds[0] === "join" || cmds[0] === "leave") && cmds.length >= 2) {
    payload = {
      type: cmds[0],
      channels: cmds.slice(1).map((x) => {
        if (x === "*") {
          return null;
        }
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
      name: cmds[0].toLocaleLowerCase(),
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

const client = new Discord.Client({
  intents: [
    "GuildMessageReactions",
    "GuildMessages",
    "Guilds",
    "MessageContent",
  ],
});

client.on("ready", () => {});

client.on("messageCreate", async (message) => {
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
          filterManageChannel([...cmd.category.children.cache.values()])
            .map((channel, i) => `${i}: ${channel.name}`)
            .join("\n")
      );
    } else {
      const channelQuery = cmd.payload.channels;
      const channels = filterManageChannel([
        ...cmd.category.children.cache.values(),
      ]).filter((channel, i) =>
        channelQuery.some((query) =>
          query === null
            ? true
            : typeof query === "number"
            ? i === query
            : channel.name.includes(query)
        )
      );

      for (const channel of new Set(channels)) {
        const permission = channel.permissionOverwrites.cache.find(
          (x) =>
            x.type === Discord.OverwriteType.Member ||
            x.id === message.author.id
        );

        if (cmd.payload.type === "leave" && permission !== undefined) {
          await permission.delete();
        }

        if (cmd.payload.type === "join") {
          if (permission === undefined) {
            await channel.permissionOverwrites.create(message.author.id, {
              ViewChannel: true,
            });
          } else {
            await channel.permissionOverwrites.edit(message.author.id, {
              ViewChannel: true,
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

    const channel = await client.channels.fetch(data.channel_id, {
      force: true,
    });

    if (!(channel instanceof Discord.TextChannel)) {
      return;
    }

    const message = await channel.messages.fetch(data.message_id);

    const cmd = msgToCmd(message);
    if (cmd === null || cmd.payload.type !== "create") {
      return;
    }
    const cmdPayload = cmd.payload;

    const reaction = message.reactions.cache.find(
      (reaction) => reaction.emoji.name === "👍"
    );

    if (reaction === undefined) {
      return;
    }

    if (!(reaction.count !== null && reaction.count >= 4)) {
      return;
    }

    const already = channel.guild.channels.cache.find(
      (channel) => channel.name === cmdPayload.name
    );

    if (already !== undefined) {
      return;
    }

    const createChannel = await channel.guild.channels.create({
      type: Discord.ChannelType.GuildText,
      name: cmdPayload.name,
      parent: cmd.category,
    });

    await createChannel.permissionOverwrites.create(client.user!.id, {
      ViewChannel: true,
    });

    await createChannel.permissionOverwrites.edit(
      channel.guild.roles.everyone,
      {
        ViewChannel: false,
      }
    );

    const approveUsers = (await reaction.users.fetch())
      .filter((user) => !user.bot)
      .map((user) => user.id)
      .filter((id) => id !== message.author.id);

    for (const user of new Set([data.user_id, ...approveUsers])) {
      await createChannel.permissionOverwrites.create(user, {
        ViewChannel: true,
      });
    }

    await message.reply(
      `Created: <#${createChannel.id}> (by <@${
        message.author.id
      }>, and approved by ${approveUsers
        .map((userId) => `<@${userId}>`)
        .join(", ")}>)`
    );
  } catch (e) {
    console.log(e);
  }
});

client.login(token);
