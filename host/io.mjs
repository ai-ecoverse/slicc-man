import { writeSync } from 'node:fs';

export function say(fd, text) {
  const data = Buffer.from(text);
  let at = 0;
  while (at < data.length) {
    try {
      at += writeSync(fd, data, at, data.length - at);
    } catch (error) {
      if (error.code === 'EAGAIN') continue;
      if (error.code === 'EPIPE') return;
      throw error;
    }
  }
}
