import type { Context } from "@buzz/author";

type ReactLike = Context["react"];
type Node = ReturnType<ReactLike["createElement"]> | string;

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https:\/\/[^)\s]+\))/g;
const BULLET = /^\s*[-*] /;
const NUMBERED = /^\s*\d+[.)] /;
const HEADING = /^(#{1,6}) +(.*)$/;
const FENCE = /^\s*```/;

// Just enough Markdown for listing descriptions; everything renders as React text,
// never as HTML.
export function createMarkdown(React: ReactLike) {
  const inline = (text: string): Node[] =>
    text.split(INLINE).map((part, index) => {
      if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
      if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
      const link = /^\[([^\]]+)\]\((https:\/\/[^)\s]+)\)$/.exec(part);
      if (link)
        return (
          <a key={index} href={link[2]} target="_blank" rel="noreferrer">
            {link[1]}
          </a>
        );
      return part;
    });

  const items = (lines: string[], marker: RegExp) => {
    const out: string[] = [];
    for (const line of lines)
      if (marker.test(line)) out.push(line.replace(marker, ""));
      else out[out.length - 1] += ` ${line.trim()}`;
    return out;
  };

  return function Markdown({ text, inline: isInline }: { text: string; inline?: boolean }) {
    if (isInline) return <>{inline(text)}</>;
    const lines = text.trim().split("\n");
    const blocks: Node[] = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        i++;
        continue;
      }
      if (FENCE.test(line)) {
        const code: string[] = [];
        for (i++; i < lines.length && !FENCE.test(lines[i]); i++) code.push(lines[i]);
        i++;
        blocks.push(
          <pre key={blocks.length}>
            <code>{code.join("\n")}</code>
          </pre>,
        );
        continue;
      }
      const heading = HEADING.exec(line);
      if (heading) {
        i++;
        blocks.push(<h4 key={blocks.length}>{inline(heading[2])}</h4>);
        continue;
      }
      const marker = BULLET.test(line) ? BULLET : NUMBERED.test(line) ? NUMBERED : null;
      const run: string[] = [];
      while (i < lines.length && lines[i].trim() && !FENCE.test(lines[i]) && !HEADING.test(lines[i])) run.push(lines[i++]);
      if (marker) {
        const List = marker === BULLET ? "ul" : "ol";
        blocks.push(
          <List key={blocks.length}>
            {items(run, marker).map((item, key) => (
              <li key={key}>{inline(item)}</li>
            ))}
          </List>,
        );
      } else blocks.push(<p key={blocks.length}>{inline(run.join(" "))}</p>);
    }
    return <>{blocks}</>;
  };
}
