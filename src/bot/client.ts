// src/bot/client.ts
import {
  Client,
  GatewayIntentBits,
  Events,
  Message,
  TextChannel,
} from 'discord.js';
import { getProjectByChannelId } from '../config/store.js';
import { ensureContainerRunning } from '../container/manager.js';
import { ClaudeSession } from '../bridge/session.js';
import {
  formatTextResponse,
  formatToolResult,
  containsQuestion,
} from '../bot/formatter.js';
import { AppConfig } from '../config/types.js';

// Active sessions: channelId -> ClaudeSession
const sessions = new Map<string, ClaudeSession>();

export function createClient(config: AppConfig): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.on(Events.MessageCreate, async (message: Message) => {
    // Ignore bot messages and messages from other users
    if (message.author.bot) return;
    if (message.author.id !== config.userId) return;

    // Check if this channel is a project channel
    const project = getProjectByChannelId(message.channelId);
    if (!project) return;

    // Ensure container is running
    const running = await ensureContainerRunning(project.config.containerName);
    if (!running) {
      await message.reply('Container is not running. Try `/restart` to fix.');
      return;
    }

    // Get or create session
    let session = sessions.get(message.channelId);
    if (!session || !session.isAlive()) {
      session = createSession(project.config.containerName, message.channelId, config, message.channel as TextChannel);
      sessions.set(message.channelId, session);
    }

    // Queue check - if session is busy, notify user
    if (session.isBusy()) {
      await message.reply('Claude is still working on the previous message. Please wait...');
      return;
    }

    // Show typing indicator
    const channel = message.channel as TextChannel;
    channel.sendTyping();
    const typingInterval = setInterval(() => channel.sendTyping(), 8000);

    // Store interval on session so we can clear it on response
    (session as any)._typingInterval = typingInterval;

    // Send message to Claude
    try {
      session.sendMessage(message.content);
    } catch (err) {
      clearInterval(typingInterval);
      await message.reply('Failed to send message to Claude. Try `/restart`.');
    }
  });

  client.on(Events.ClientReady, (c) => {
    console.log(`Bot logged in as ${c.user.tag}`);
  });

  return client;
}

function createSession(
  containerName: string,
  channelId: string,
  config: AppConfig,
  channel: TextChannel
): ClaudeSession {
  const session = new ClaudeSession(containerName);

  // Accumulate text chunks into a complete response
  let responseBuffer = '';
  let responseTimeout: NodeJS.Timeout | null = null;

  const flushResponse = async () => {
    if (!responseBuffer.trim()) return;
    const text = responseBuffer;
    responseBuffer = '';

    const mention = containsQuestion(text) ? `<@${config.userId}> ` : '';
    const formatted = formatTextResponse(mention + text);

    await channel.send({
      content: formatted.content,
      files: formatted.files,
    });
  };

  session.on('message', (text: string) => {
    responseBuffer += text;

    // Debounce: wait for more chunks before sending
    if (responseTimeout) clearTimeout(responseTimeout);
    responseTimeout = setTimeout(flushResponse, 500);
  });

  session.on('toolUse', (name: string, input: Record<string, unknown>) => {
    // Tool uses are reported when result comes back
    // For now just log that Claude is using a tool
    const formatted = formatToolResult(name, input);
    channel.send({
      content: formatted.content,
      files: formatted.files,
    });
  });

  session.on('result', async (_text: string, isError: boolean) => {
    // Clear typing indicator
    const interval = (session as any)._typingInterval;
    if (interval) clearInterval(interval);

    // Flush any remaining buffered text
    if (responseTimeout) clearTimeout(responseTimeout);
    await flushResponse();

    if (isError) {
      await channel.send('Claude encountered an error while processing.');
    }
  });

  session.on('error', (err: Error) => {
    console.error(`Session error for ${containerName}:`, err.message);
  });

  session.on('exit', async (code: number | null) => {
    const interval = (session as any)._typingInterval;
    if (interval) clearInterval(interval);

    if (code !== 0 && code !== null) {
      await channel.send('Claude session ended unexpectedly. Use `/restart` to start a new session.');
    }
    sessions.delete(channelId);
  });

  session.start();
  return session;
}

export function getSession(channelId: string): ClaudeSession | undefined {
  return sessions.get(channelId);
}

export function removeSession(channelId: string): void {
  const session = sessions.get(channelId);
  if (session) {
    session.stop();
    sessions.delete(channelId);
  }
}
