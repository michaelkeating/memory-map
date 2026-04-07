/** Matches [[Page Title]] and [[Page Title|display text]] */
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

/** Extract all wikilink targets from markdown content */
export function extractWikilinks(markdown: string): string[] {
  const links: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(WIKILINK_RE.source, WIKILINK_RE.flags);
  while ((match = re.exec(markdown)) !== null) {
    links.push(match[1].trim());
  }
  return [...new Set(links)]; // deduplicate
}
