const special = /[.*+?^${}()|[\]\\/-]/g;

function bracket(pattern, i) {
  let j = i + 1;
  if (pattern[j] === '!' || pattern[j] === '^') j++;
  if (pattern[j] === ']') j++;
  j = pattern.indexOf(']', j);
  if (j === -1) return { text: '\\[', next: i + 1 };
  let body = pattern.slice(i + 1, j);
  const not = body[0] === '!' || body[0] === '^';
  if (not) body = body.slice(1);
  return { text: `[${not ? '^' : ''}${body.replace(/[\\\]^]/g, '\\$&')}]`, next: j + 1 };
}

function glob(pattern) {
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '[') {
      const found = bracket(pattern, i);
      out += found.text;
      i = found.next;
      continue;
    }
    if (ch === '*') out += '.*';
    else if (ch === '?') out += '.';
    else if (ch === '\\' && i + 1 < pattern.length) out += pattern[++i].replace(special, '\\$&');
    else out += ch.replace(special, '\\$&');
    i++;
  }
  return new RegExp(`^(?:${out})$`, 'i');
}

export function words(text) {
  return text.split(/[^\p{L}\p{N}_]+/u).filter(Boolean);
}

export function matcher(kind, mode, keyword) {
  if (mode === 'regex') {
    const re = new RegExp(keyword, 'i');
    return kind === 'whatis'
      ? (entry) => re.test(entry.topic)
      : (entry) => re.test(entry.topic) || re.test(entry.description);
  }
  if (mode === 'wildcard') {
    const re = glob(keyword);
    return kind === 'whatis'
      ? (entry) => re.test(entry.topic)
      : (entry) => re.test(entry.topic) || words(entry.description).some((w) => re.test(w));
  }
  const want = keyword.toLowerCase();
  return kind === 'whatis'
    ? (entry) => entry.topic.toLowerCase() === want
    : (entry) =>
        entry.topic.toLowerCase() === want ||
        words(entry.description).some((w) => w.toLowerCase() === want);
}

export function line(entry) {
  return `${`${entry.topic} (1)`.padEnd(20)} - ${entry.description}`.trimEnd();
}

export function cut(text, width) {
  const chars = Array.from(text);
  if (chars.length <= width) return text;
  return `${chars.slice(0, Math.max(width - 3, 0)).join('')}...`;
}

export function search(entries, matchers, all) {
  const hits = matchers.map(() => false);
  const found = [];
  for (const entry of entries) {
    const each = matchers.map((match) => match(entry));
    const ok = all ? each.every(Boolean) : each.some(Boolean);
    if (!ok) continue;
    found.push(entry);
    each.forEach((hit, n) => {
      if (hit) hits[n] = true;
    });
  }
  return { found, hits };
}
