import { Fragment, type ReactNode } from 'react';

/** Source links may navigate only to ordinary public web pages. */
export function safeWebUrl(value: string | undefined): string | undefined {
  if (!value || /[\u0000-\u0020\u007f]/.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokens =
    /\[([^\]\n]+)\]\(([^\s()]*(?:\([^\s()]*\)[^\s()]*)*)\)|\*\*([^*\n]+)\*\*|`([^`\n]+)`/g;
  let cursor = 0;
  for (const match of text.matchAll(tokens)) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    if (match[1] !== undefined) {
      const href = safeWebUrl(match[2]);
      nodes.push(
        href ? (
          <a key={match.index} href={href} target="_blank" rel="noopener noreferrer">
            {match[1]}
          </a>
        ) : (
          match[1]
        ),
      );
    } else if (match[3] !== undefined) nodes.push(<strong key={match.index}>{match[3]}</strong>);
    else nodes.push(<code key={match.index}>{match[4]}</code>);
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

/** A small text-only Markdown renderer: no HTML, embedded media, or executable URL schemes. */
export default function MarkdownText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let index = 0;
  const listItem = (line: string) => line.match(/^\s*(?:(\d+)[.)]|([-*]))\s+(.+)$/);
  while (index < lines.length) {
    if (!lines[index].trim()) {
      index += 1;
      continue;
    }
    const heading = lines[index].match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      blocks.push(
        <p className="markdown-heading" key={index}>
          <strong>{inline(heading[1])}</strong>
        </p>,
      );
      index += 1;
      continue;
    }
    const item = listItem(lines[index]);
    if (item) {
      const start = index;
      const ordered = !!item[1];
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const next = listItem(lines[index]);
        if (!next || !!next[1] !== ordered) break;
        items.push(<li key={index}>{inline(next[3])}</li>);
        index += 1;
      }
      blocks.push(
        ordered ? (
          <ol key={start} start={Number(item[1])}>
            {items}
          </ol>
        ) : (
          <ul key={start}>{items}</ul>
        ),
      );
      continue;
    }
    const start = index;
    const paragraph = [lines[index++]];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !listItem(lines[index]) &&
      !/^#{1,6}\s/.test(lines[index])
    )
      paragraph.push(lines[index++]);
    blocks.push(
      <p key={start}>
        {paragraph.map((line, lineIndex) => (
          <Fragment key={lineIndex}>
            {lineIndex > 0 && <br />}
            {inline(line)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return <>{blocks}</>;
}
