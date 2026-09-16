import { Box, Text } from '@radix-ui/themes';
import MarkdownText from './MarkdownText';

/** Keep older research-heavy replies readable without changing saved content. */
export default function ConciergeMessage({ text }: { text: string }) {
  const paragraphs = text.trim().split(/\n\s*\n/);
  if (text.trim().split(/\s+/).length <= 150 || paragraphs.length < 2)
    return <MarkdownText text={text} />;
  const preview = [paragraphs[0]];
  let words = paragraphs[0].split(/\s+/).length;
  while (preview.length < paragraphs.length - 1) {
    const next = paragraphs[preview.length];
    if (words + next.split(/\s+/).length > 75) break;
    preview.push(next);
    words += next.split(/\s+/).length;
  }
  return (
    <>
      <MarkdownText text={preview.join('\n\n')} />
      <Box asChild mt="2">
        <details>
          <summary style={{ cursor: 'pointer', display: 'list-item' }}>
            <Text size="2" color="gray" weight="medium">
              Read the full response
            </Text>
          </summary>
          <MarkdownText text={paragraphs.slice(preview.length).join('\n\n')} />
        </details>
      </Box>
    </>
  );
}
