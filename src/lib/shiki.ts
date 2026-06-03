/**
 * Lazy, singleton Shiki highlighter.
 *
 * Code is highlighted once with BOTH a light and dark theme using
 * `defaultColor: false`, which emits `--shiki-light` / `--shiki-dark` CSS
 * variables on each token. markdown.css then picks the right variable for the
 * active app theme, so theme switching needs no re-highlight.
 */
import { bundledLanguages, createHighlighter, type Highlighter } from "shiki";

const LIGHT_THEME = "github-light";
const DARK_THEME = "github-dark";

// A small set loaded up front; anything else is loaded on demand.
const PRELOAD = [
  "javascript",
  "typescript",
  "tsx",
  "jsx",
  "json",
  "bash",
  "python",
  "rust",
  "css",
  "html",
  "markdown",
];

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [LIGHT_THEME, DARK_THEME],
      langs: PRELOAD,
    });
  }
  return highlighterPromise;
}

function normalizeLang(lang: string): string {
  const l = lang.toLowerCase();
  const aliases: Record<string, string> = {
    sh: "bash",
    shell: "bash",
    zsh: "bash",
    js: "javascript",
    ts: "typescript",
    py: "python",
    rs: "rust",
    yml: "yaml",
    "c++": "cpp",
    "c#": "csharp",
  };
  return aliases[l] ?? l;
}

/** Return highlighted HTML for a code block, or null if the language is unknown. */
export async function highlightCode(
  code: string,
  rawLang: string,
): Promise<string | null> {
  const hl = await getHighlighter();
  const lang = normalizeLang(rawLang);

  if (!hl.getLoadedLanguages().includes(lang)) {
    if (lang in bundledLanguages) {
      try {
        await hl.loadLanguage(lang as keyof typeof bundledLanguages);
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }

  return hl.codeToHtml(code, {
    lang,
    themes: { light: LIGHT_THEME, dark: DARK_THEME },
    defaultColor: false,
  });
}
