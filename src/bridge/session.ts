// src/bridge/session.ts
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

export interface StreamMessage {
  type: 'system' | 'assistant' | 'result';
  subtype?: string;
  message?: {
    content: Array<{
      type: 'text' | 'tool_use';
      text?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
  };
  result?: string;
  session_id?: string;
  is_error?: boolean;
}

export class ClaudeSession extends EventEmitter {
  private process: ChildProcess | null = null;
  private containerName: string;
  private sessionId: string | null = null;
  private buffer: string = '';
  private busy: boolean = false;

  constructor(containerName: string) {
    super();
    this.containerName = containerName;
  }

  isBusy(): boolean {
    return this.busy;
  }

  isAlive(): boolean {
    return this.process !== null && this.process.exitCode === null;
  }

  start(): void {
    this.process = spawn('docker', [
      'exec', '-i',
      this.containerName,
      'claude',
      '--print',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
    ]);

    this.process.stdout?.on('data', (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) {
        this.emit('error', new Error(text));
      }
    });

    this.process.on('exit', (code) => {
      this.busy = false;
      this.emit('exit', code);
    });

    this.process.on('error', (err) => {
      this.busy = false;
      this.emit('error', err);
    });
  }

  sendMessage(content: string): void {
    if (!this.process || !this.process.stdin) {
      throw new Error('Session not started');
    }

    this.busy = true;

    const message = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: content,
      },
      session_id: this.sessionId || 'default',
      parent_tool_use_id: null,
    });

    this.process.stdin.write(message + '\n');
  }

  stop(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
      this.sessionId = null;
      this.buffer = '';
      this.busy = false;
    }
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const msg = JSON.parse(trimmed) as StreamMessage;
        this.handleMessage(msg);
      } catch {
        // Skip non-JSON lines (e.g., debug output)
      }
    }
  }

  private handleMessage(msg: StreamMessage): void {
    // Capture session ID from any message that has it
    if (msg.session_id && msg.session_id !== 'default') {
      this.sessionId = msg.session_id;
    }

    switch (msg.type) {
      case 'system':
        // Init and hook messages - ignore for now
        break;

      case 'assistant':
        if (msg.message?.content) {
          for (const block of msg.message.content) {
            if (block.type === 'text' && block.text) {
              this.emit('message', block.text);
            } else if (block.type === 'tool_use' && block.name) {
              this.emit('toolUse', block.name, block.input || {});
            }
          }
        }
        break;

      case 'result':
        this.busy = false;
        this.emit('result', msg.result || '', msg.is_error || false);
        break;
    }
  }
}
