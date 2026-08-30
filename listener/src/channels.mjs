export function createNotificationChannel({
  discordWebhookUrl,
  telegramBotToken,
  telegramChatId,
  stdoutEnabled = false,
  fetchFn = fetch,
} = {}) {
  const channels = [];

  if (discordWebhookUrl) channels.push(discordChannel(discordWebhookUrl, fetchFn));
  if (telegramBotToken || telegramChatId) {
    if (!telegramBotToken || !telegramChatId) {
      throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be configured together");
    }
    channels.push(telegramChannel(telegramBotToken, telegramChatId, fetchFn));
  }
  if (stdoutEnabled) channels.push(stdoutChannel());
  if (channels.length === 0) {
    throw new Error("Configure DISCORD_WEBHOOK_URL or TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID");
  }

  return {
    name: channels.map((channel) => channel.name).join("+"),
    async send(message) {
      for (const channel of channels) await channel.send(message);
    },
  };
}

function discordChannel(webhookUrl, fetchFn) {
  return {
    name: "discord",
    async send(message) {
      const response = await fetchFn(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: message, allowed_mentions: { parse: [] } }),
      });
      if (!response.ok) throw new Error(`Discord delivery failed (${response.status})`);
    },
  };
}

function telegramChannel(token, chatId, fetchFn) {
  return {
    name: "telegram",
    async send(message) {
      const response = await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: message, disable_web_page_preview: true }),
      });
      if (!response.ok) throw new Error(`Telegram delivery failed (${response.status})`);
    },
  };
}

function stdoutChannel() {
  return {
    name: "stdout",
    async send(message) {
      console.log(`${message}\n`);
    },
  };
}
