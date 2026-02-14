// src/bot/client.ts
import {
  Client,
  GatewayIntentBits,
  Events,
  Message,
  TextChannel,
  ThreadChannel,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ComponentType,
  EmbedBuilder,
} from 'discord.js';
import { getProjectByChannelId } from '../config/store.js';
import { ensureContainerRunning, writeFileToContainer } from '../container/manager.js';
import { ClaudeSession } from '../bridge/session.js';
import {
  formatTextResponse,
  containsQuestion,
  friendlyError,
} from './formatter.js';
import { AppConfig } from '../config/types.js';

// Active sessions: threadId -> ClaudeSession (each thread = independent session)
const sessions = new Map<string, ClaudeSession>();
// Typing indicator intervals per thread
const sessionTypingIntervals = new Map<string, NodeJS.Timeout>();
// Last user message per thread (for auto-retry after context overflow)
const lastUserMessages = new Map<string, string>();
// Original message ref per thread (for reactions on main channel message)
const originalMessages = new Map<string, Message>();
// Track which threads belong to which project: projectChannelId -> Set<threadId>
const projectThreads = new Map<string, Set<string>>();

function isAuthorized(message: Message, config: AppConfig): boolean {
  if (config.roleId && message.member?.roles.cache.has(config.roleId)) return true;
  if (config.userId && message.author.id === config.userId) return true;
  return false;
}

function trackThread(projectChannelId: string, threadId: string): void {
  let threads = projectThreads.get(projectChannelId);
  if (!threads) {
    threads = new Set();
    projectThreads.set(projectChannelId, threads);
  }
  threads.add(threadId);
}

export function createClient(config: AppConfig): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return;
    if (!isAuthorized(message, config)) return;

    // Resolve project channel
    const projectChannelId = message.channel.isThread()
      ? message.channel.parentId!
      : message.channelId;

    const project = getProjectByChannelId(projectChannelId);
    if (!project) return;

    const running = await ensureContainerRunning(project.config.containerName);
    if (!running) {
      await message.reply(friendlyError('Container is not running'));
      return;
    }

    const mainChannel = message.channel.isThread()
      ? await message.guild!.channels.fetch(projectChannelId) as TextChannel
      : message.channel as TextChannel;

    // Determine thread: create one if in main channel, or use existing
    let thread: ThreadChannel;
    let sessionId: string;

    if (!message.channel.isThread()) {
      await message.react('\u23F3');
      originalMessages.set(message.id, message);
      const threadName = message.content.substring(0, 97) + (message.content.length > 97 ? '...' : '');
      thread = await message.startThread({
        name: threadName,
        autoArchiveDuration: 60,
      });
      sessionId = thread.id;
      trackThread(projectChannelId, sessionId);
    } else {
      thread = message.channel as ThreadChannel;
      sessionId = thread.id;
      trackThread(projectChannelId, sessionId);
    }

    // Get or create session for this thread
    let session = sessions.get(sessionId);
    if (!session || !session.isAlive()) {
      session = createSession(
        project.config.containerName,
        sessionId,
        config,
        mainChannel,
        thread,
        message.author.id,
      );
      sessions.set(sessionId, session);
    }

    // Typing indicator
    if (!sessionTypingIntervals.has(sessionId)) {
      thread.sendTyping();
      const typingInterval = setInterval(() => thread.sendTyping(), 8000);
      sessionTypingIntervals.set(sessionId, typingInterval);
    }

    // Upload attachments
    const filePaths: string[] = [];
    for (const [, attachment] of message.attachments) {
      try {
        const res = await fetch(attachment.url);
        const buffer = Buffer.from(await res.arrayBuffer());
        const destPath = `/workspace/uploads/${attachment.name}`;
        await writeFileToContainer(project.config.containerName, destPath, buffer);
        filePaths.push(destPath);
      } catch {
        console.error(`Failed to upload attachment: ${attachment.name}`);
      }
    }

    let text = message.content;
    if (filePaths.length > 0) {
      const fileList = filePaths.map((p) => `  ${p}`).join('\n');
      text += `\n\n[Attached files uploaded to container:\n${fileList}\n]`;
    }

    lastUserMessages.set(sessionId, text);
    try {
      session.sendMessage(text);
    } catch {
      await thread.send(friendlyError('Failed to send message to Claude'));
    }
  });

  client.on(Events.ClientReady, (c) => {
    console.log(`Bot logged in as ${c.user.tag}`);
  });

  return client;
}

function createSession(
  containerName: string,
  sessionId: string,
  config: AppConfig,
  mainChannel: TextChannel,
  thread: ThreadChannel,
  userId: string,
): ClaudeSession {
  const session = new ClaudeSession(containerName);

  let responseBuffer = '';
  let questionBuffer = '';
  let questionTimeout: NodeJS.Timeout | null = null;
  let handledAskUser = false;

  const sendEmbed = async (text: string, color: number) => {
    if (!text.trim()) return;
    if (text.length <= 4096) {
      const embed = new EmbedBuilder().setDescription(text).setColor(color).setTimestamp();
      await thread.send({ embeds: [embed] });
    } else {
      const formatted = formatTextResponse(text, '');
      const embed = new EmbedBuilder()
        .setDescription(text.substring(0, 4093) + '...')
        .setColor(color)
        .setTimestamp();
      await thread.send({ embeds: [embed], files: formatted.files });
    }
  };

  const sendQuestion = async (text: string) => {
    if (!text.trim()) return;
    const prefix = `<@${userId}> `;
    const formatted = formatTextResponse(text, prefix);
    await thread.send({ content: formatted.content, files: formatted.files });
  };

  const flushQuestion = async () => {
    if (!questionBuffer.trim()) return;
    const text = questionBuffer;
    questionBuffer = '';
    await sendQuestion(text);
  };

  session.on('message', (text: string) => {
    responseBuffer += text;
    if (containsQuestion(responseBuffer)) {
      questionBuffer = responseBuffer;
      responseBuffer = '';
      if (questionTimeout) clearTimeout(questionTimeout);
      questionTimeout = setTimeout(flushQuestion, 500);
    }
  });

  session.on('toolUse', async (name: string, input: Record<string, unknown>) => {
    console.log(`[${containerName}] Tool: ${name}`);

    if (name === 'AskUserQuestion') {
      console.log(`[${containerName}] AskUserQuestion input:`, JSON.stringify(input));

      const questions = input.questions as Array<{
        question: string;
        options?: Array<{ label: string; description?: string }>;
      }> | undefined;

      if (!questions || questions.length === 0) {
        // Couldn't parse structured questions — let the text flow through normally
        console.log(`[${containerName}] AskUserQuestion: no parseable questions, falling back to text`);
        return;
      }

      // Clear text buffers only after confirming we can handle the question
      responseBuffer = '';
      questionBuffer = '';
      handledAskUser = true;
      if (questionTimeout) { clearTimeout(questionTimeout); questionTimeout = null; }

      for (const q of questions) {
        if (q.options && q.options.length > 0) {
          const buttons = q.options.map((opt, i) =>
            new ButtonBuilder()
              .setCustomId(`ask_${i}`)
              .setLabel(opt.label)
              .setStyle(ButtonStyle.Primary)
          );
          buttons.push(
            new ButtonBuilder()
              .setCustomId('ask_other')
              .setLabel('Other')
              .setStyle(ButtonStyle.Secondary)
          );

          const rows: ActionRowBuilder<ButtonBuilder>[] = [];
          for (let i = 0; i < buttons.length; i += 5) {
            rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(i, i + 5)));
          }

          const descriptions = q.options
            .filter((opt) => opt.description)
            .map((opt) => `**${opt.label}** — ${opt.description}`)
            .join('\n');
          const content = descriptions
            ? `<@${userId}> ${q.question}\n\n${descriptions}`
            : `<@${userId}> ${q.question}`;

          const msg = await thread.send({ content, components: rows });

          try {
            const interaction = await msg.awaitMessageComponent({
              componentType: ComponentType.Button,
              filter: (i) => i.user.id === userId,
              time: 300_000,
            });

            if (interaction.customId === 'ask_other') {
              await interaction.update({ content: q.question + `\n\n<@${userId}> Type your answer in this thread:`, components: [] });
              const collected = await thread.awaitMessages({
                filter: (m) => m.author.id === userId,
                max: 1,
                time: 300_000,
              });
              const answer = collected.first()?.content || 'skip';
              session.sendMessage(answer);
            } else {
              const idx = parseInt(interaction.customId.replace('ask_', ''), 10);
              const chosen = q.options[idx]?.label || 'skip';
              await interaction.update({ content: `${q.question}\n**${chosen}**`, components: [] });
              session.sendMessage(chosen);
            }
          } catch {
            await msg.edit({ content: q.question + '\n*No response — skipped.*', components: [] });
            session.sendMessage('skip');
          }
        } else {
          await sendQuestion(q.question);
        }
      }
    }
  });

  session.on('result', async (text: string, isError: boolean) => {
    const interval = sessionTypingIntervals.get(sessionId);
    if (interval) {
      clearInterval(interval);
      sessionTypingIntervals.delete(sessionId);
    }

    const fullText = responseBuffer + (text || '');
    const isContextOverflow = /prompt is too long/i.test(fullText);

    if (isContextOverflow) {
      responseBuffer = '';
      if (questionTimeout) clearTimeout(questionTimeout);

      session.stop();
      sessions.delete(sessionId);

      const lastMessage = lastUserMessages.get(sessionId);
      const newSession = createSession(containerName, sessionId, config, mainChannel, thread, userId);
      sessions.set(sessionId, newSession);

      if (lastMessage) {
        thread.sendTyping();
        const typingInterval = setInterval(() => thread.sendTyping(), 8000);
        sessionTypingIntervals.set(sessionId, typingInterval);
        newSession.sendMessage(lastMessage);
      }
      return;
    }

    if (questionTimeout) clearTimeout(questionTimeout);
    await flushQuestion();

    // React on original message
    const origMsg = originalMessages.get(sessionId);
    if (origMsg) {
      try {
        await origMsg.reactions.removeAll();
        await origMsg.react(isError ? '\u274C' : '\u2705');
      } catch { /* may lack permissions */ }
    }

    responseBuffer = '';
    if (handledAskUser) {
      // Question was already shown with buttons — don't duplicate as embed
      handledAskUser = false;
    } else if (isError) {
      await sendEmbed(friendlyError('Claude encountered an error while processing.'), 0xcc0000);
    } else if (text) {
      await sendEmbed(text, 0x00cc00);
    }

    try {
      const timestamp = Math.floor(Date.now() / 1000);
      await mainChannel.setTopic(`Last active <t:${timestamp}:R>`);
    } catch { /* may lack permissions */ }
  });

  session.on('error', (err: Error) => {
    console.error(`Session error for ${containerName}:`, err.message);
  });

  session.on('exit', async (code: number | null) => {
    console.log(`Session ${sessionId} for ${containerName} exited with code ${code}`);
    const interval = sessionTypingIntervals.get(sessionId);
    if (interval) {
      clearInterval(interval);
      sessionTypingIntervals.delete(sessionId);
    }

    if (code !== 0 && code !== null) {
      await thread.send(friendlyError(`Session exited with code ${code}`));
    }
    sessions.delete(sessionId);
  });

  session.start();
  return session;
}

export function getSession(channelId: string): ClaudeSession | undefined {
  return sessions.get(channelId);
}

// Remove a single thread's session
export function removeSession(threadOrChannelId: string): void {
  // Direct thread session
  const session = sessions.get(threadOrChannelId);
  if (session) {
    session.stop();
    sessions.delete(threadOrChannelId);
    sessionTypingIntervals.delete(threadOrChannelId);
    lastUserMessages.delete(threadOrChannelId);
    originalMessages.delete(threadOrChannelId);
    return;
  }

  // If it's a project channel ID, remove all thread sessions for that project
  const threads = projectThreads.get(threadOrChannelId);
  if (threads) {
    for (const threadId of threads) {
      const s = sessions.get(threadId);
      if (s) {
        s.stop();
        sessions.delete(threadId);
      }
      sessionTypingIntervals.delete(threadId);
      lastUserMessages.delete(threadId);
      originalMessages.delete(threadId);
    }
    projectThreads.delete(threadOrChannelId);
  }
}
