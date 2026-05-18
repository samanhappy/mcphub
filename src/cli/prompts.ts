import readline from 'node:readline';

export async function promptLine(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise<string>((resolve) => rl.question(question, resolve));
  } finally {
    rl.close();
  }
}

// Hidden-input prompt for passwords. Requires a TTY for raw mode; on a
// non-interactive stdin (pipes, CI) we just echo the question and read a line
// so the prompt is still usable in scripts.
export async function promptPassword(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return promptLine(question);
  }
  process.stdout.write(question);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  return new Promise<string>((resolve) => {
    let buf = '';
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        const code = ch.charCodeAt(0);
        if (ch === '\r' || ch === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(buf);
          return;
        }
        if (code === 3) {
          // Ctrl-C
          process.stdin.setRawMode(false);
          process.stdout.write('\n');
          process.exit(130);
        }
        if (code === 127 || code === 8) {
          // Backspace / DEL
          buf = buf.slice(0, -1);
          continue;
        }
        if (code < 32) {
          // Drop other control chars
          continue;
        }
        buf += ch;
      }
    };
    process.stdin.on('data', onData);
  });
}
