// src/bot/formatter.ts
import { AttachmentBuilder } from 'discord.js';

const MAX_INLINE_CODE_LINES = 20;
const MAX_DISCORD_MESSAGE_LENGTH = 2000;

export interface FormattedResponse {
  content: string;
  files: AttachmentBuilder[];
}

export function formatTextResponse(text: string): FormattedResponse {
  const files: AttachmentBuilder[] = [];

  // If the message fits in Discord, send as-is
  if (text.length <= MAX_DISCORD_MESSAGE_LENGTH) {
    return { content: text, files };
  }

  // Message too long - truncate and attach full version
  const truncated = text.slice(0, MAX_DISCORD_MESSAGE_LENGTH - 100);
  const attachment = new AttachmentBuilder(Buffer.from(text, 'utf-8'), {
    name: 'full-response.md',
    description: 'Full response from Claude',
  });
  files.push(attachment);

  return {
    content: truncated + '\n\n*(full response attached)*',
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

export function containsQuestion(text: string): boolean {
  // Check if the text ends with a question (last non-empty line ends with ?)
  const lines = text.trim().split('\n');
  const lastLine = lines[lines.length - 1].trim();
  return lastLine.endsWith('?');
}
