// src/bot/formatter.ts
import { AttachmentBuilder } from 'discord.js';

const MAX_INLINE_CODE_LINES = 20;
const MAX_DISCORD_MESSAGE_LENGTH = 2000;

export interface FormattedResponse {
  content: string;
  files: AttachmentBuilder[];
}

export function formatTextResponse(text: string, prefix: string = ''): FormattedResponse {
  const files: AttachmentBuilder[] = [];
  const fullContent = prefix + text;

  // If the message fits in Discord, send as-is
  if (fullContent.length <= MAX_DISCORD_MESSAGE_LENGTH) {
    return { content: fullContent, files };
  }

  // Message too long - truncate and attach full version
  const suffix = '\n\n*(full response attached)*';
  const maxLength = MAX_DISCORD_MESSAGE_LENGTH - prefix.length - suffix.length;
  const truncated = prefix + text.slice(0, maxLength);
  const attachment = new AttachmentBuilder(Buffer.from(text, 'utf-8'), {
    name: 'full-response.md',
    description: 'Full response from Claude',
  });
  files.push(attachment);

  return {
    content: truncated + suffix,
    files,
  };
}

export function formatToolResult(
  toolName: string,
  input: Record<string, unknown>,
  output?: string
): FormattedResponse {
  const files: AttachmentBuilder[] = [];

  let summary = '';
  switch (toolName) {
    case 'Bash': {
      const cmd = (input.command as string) || 'unknown command';
      summary = `> Ran: \`${cmd.length > 100 ? cmd.slice(0, 100) + '...' : cmd}\``;
      break;
    }
    case 'Read':
      summary = `> Read: \`${input.file_path || 'unknown'}\``;
      break;
    case 'Edit':
      summary = `> Edited: \`${input.file_path || 'unknown'}\``;
      break;
    case 'Write':
      summary = `> Created: \`${input.file_path || 'unknown'}\``;
      break;
    case 'Glob':
      summary = `> Searched files: \`${input.pattern || 'unknown'}\``;
      break;
    case 'Grep':
      summary = `> Searched code: \`${input.pattern || 'unknown'}\``;
      break;
    default:
      summary = `> Used tool: ${toolName}`;
  }

  if (output) {
    const lines = output.split('\n');
    if (lines.length <= MAX_INLINE_CODE_LINES && output.length < 1500) {
      summary += `\n\`\`\`\n${output}\n\`\`\``;
    } else {
      const attachment = new AttachmentBuilder(Buffer.from(output, 'utf-8'), {
        name: `${toolName.toLowerCase()}-output.txt`,
        description: `Output from ${toolName}`,
      });
      files.push(attachment);
      summary += `\n*(${lines.length} lines - see attached)*`;
    }
  }

  return { content: summary, files };
}

export function formatErrorResponse(error: string): FormattedResponse {
  const files: AttachmentBuilder[] = [];
  const lines = error.split('\n');

  // First line is usually the error message, rest is stack trace
  const errorMessage = lines[0] || 'Unknown error';
  let content = `**Error:** ${errorMessage}`;

  if (lines.length > 5) {
    const attachment = new AttachmentBuilder(Buffer.from(error, 'utf-8'), {
      name: 'error-details.txt',
      description: 'Full error output',
    });
    files.push(attachment);
    content += '\n*(full stack trace attached)*';
  } else if (lines.length > 1) {
    content += `\n\`\`\`\n${error}\n\`\`\``;
  }

  return { content, files };
}

/**
 * Split text into chunks that fit within maxLen, breaking at paragraph
 * boundaries (\n\n). Falls back to line breaks, then hard-cuts.
 */
export function splitIntoChunks(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a paragraph break (\n\n) within limit
    let splitAt = remaining.lastIndexOf('\n\n', maxLen);
    if (splitAt > maxLen * 0.3) {
      // Found a good paragraph break — include the first \n as part of this chunk
      chunks.push(remaining.slice(0, splitAt).trimEnd());
      remaining = remaining.slice(splitAt + 2).trimStart();
      continue;
    }

    // Fall back to line break
    splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt > maxLen * 0.3) {
      chunks.push(remaining.slice(0, splitAt).trimEnd());
      remaining = remaining.slice(splitAt + 1).trimStart();
      continue;
    }

    // Hard cut at maxLen
    chunks.push(remaining.slice(0, maxLen));
    remaining = remaining.slice(maxLen);
  }

  return chunks.filter((c) => c.trim().length > 0);
}

export function containsQuestion(text: string): boolean {
  // Check if the text ends with a question (last non-empty line ends with ?)
  const lines = text.trim().split('\n');
  const lastLine = lines[lines.length - 1].trim();
  return lastLine.endsWith('?');
}

const ERROR_PATTERNS: Array<{ pattern: RegExp; friendly: string }> = [
  { pattern: /container is not running/i, friendly: "Claude's workspace isn't running. Use `/restart` to start it back up." },
  { pattern: /prompt is too long|context.*(overflow|window)/i, friendly: 'The conversation got too long — Claude is starting fresh and will retry your message.' },
  { pattern: /ECONNREFUSED|docker.*(socket|connect)|Cannot connect/i, friendly: "Can't connect to Docker. Make sure Docker Desktop is running on your computer." },
  { pattern: /exited? with code [1-9][0-9]*/i, friendly: 'Something went wrong. Try `/restart` to start a new conversation.' },
  { pattern: /image.*not found|build.*fail/i, friendly: 'Setting up the workspace for the first time — this may take a few minutes.' },
  { pattern: /ENOMEM|out of memory|OOM/i, friendly: 'The project ran out of memory. Try restarting with `/restart`.' },
  { pattern: /permission denied|EACCES/i, friendly: "Claude doesn't have permission to do that. This shouldn't happen — try `/restart`." },
];

export function friendlyError(error: string): string {
  for (const { pattern, friendly } of ERROR_PATTERNS) {
    if (pattern.test(error)) {
      return friendly;
    }
  }
  return `Something unexpected happened.\n||${error}||`;
}
