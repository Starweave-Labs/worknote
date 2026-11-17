/** Markdown is stored as editable text; HTML output must be safe for direct browser rendering. */
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false, gfm: true, breaks: false }) as string;
  return sanitizeHtml(html, {
    allowedTags: [
      "p", "br", "hr", "strong", "em", "del", "s", "blockquote", "pre", "code",
      "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "a",
      "table", "thead", "tbody", "tfoot", "tr", "th", "td",
    ],
    allowedAttributes: { a: ["href", "title", "rel"], code: ["class"], th: ["colspan", "rowspan"], td: ["colspan", "rowspan"] },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noreferrer noopener" }),
    },
  });
}
