import { useMemo, useState, type ReactNode } from "react";
import hljs from "highlight.js/lib/core";
import type { LanguageFn } from "highlight.js";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import graphql from "highlight.js/lib/languages/graphql";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import less from "highlight.js/lib/languages/less";
import lua from "highlight.js/lib/languages/lua";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import objectivec from "highlight.js/lib/languages/objectivec";
import perl from "highlight.js/lib/languages/perl";
import php from "highlight.js/lib/languages/php";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import r from "highlight.js/lib/languages/r";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scala from "highlight.js/lib/languages/scala";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { cn } from "@/lib/utils";

const REGISTERED_LANGUAGES: Array<[string, LanguageFn]> = [
  ["bash", bash],
  ["c", c],
  ["cpp", cpp],
  ["csharp", csharp],
  ["css", css],
  ["diff", diff],
  ["dockerfile", dockerfile],
  ["go", go],
  ["graphql", graphql],
  ["ini", ini],
  ["java", java],
  ["javascript", javascript],
  ["json", json],
  ["kotlin", kotlin],
  ["less", less],
  ["lua", lua],
  ["makefile", makefile],
  ["markdown", markdown],
  ["objectivec", objectivec],
  ["perl", perl],
  ["php", php],
  ["powershell", powershell],
  ["python", python],
  ["r", r],
  ["ruby", ruby],
  ["rust", rust],
  ["scala", scala],
  ["sql", sql],
  ["swift", swift],
  ["typescript", typescript],
  ["xml", xml],
  ["yaml", yaml],
];

for (const [name, language] of REGISTERED_LANGUAGES) {
  if (!hljs.getLanguage(name)) {
    hljs.registerLanguage(name, language);
  }
}

const AUTO_DETECT_LANGUAGES = REGISTERED_LANGUAGES.map(([name]) => name);

export type HighlightLanguage = (typeof AUTO_DETECT_LANGUAGES)[number];

function highlightText(text: string, language?: HighlightLanguage): string {
  if (!text) return "";

  if (language && hljs.getLanguage(language)) {
    try {
      return hljs.highlight(text, { language, ignoreIllegals: true }).value;
    } catch {
      // Fallback to auto-detection.
    }
  }

  try {
    return hljs.highlightAuto(text, AUTO_DETECT_LANGUAGES).value;
  } catch {
    return text;
  }
}

function domNodesToReact(nodes: NodeList): ReactNode[] {
  const result: ReactNode[] = [];
  let key = 0;
  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (text) result.push(text);
    } else if (node.nodeType === Node.ELEMENT_NODE && node.nodeName === "SPAN") {
      const el = node as Element;
      result.push(
        <span key={key} className={el.getAttribute("class") ?? undefined}>
          {domNodesToReact(el.childNodes)}
        </span>,
      );
    } else {
      // Non-span element — render its text content only, never its markup
      const text = node.textContent ?? "";
      if (text) result.push(text);
    }
    key++;
  }
  return result;
}

function parseHljsHtml(html: string): ReactNode {
  if (!html) return null;
  const doc = new DOMParser().parseFromString(`<span>${html}</span>`, "text/html");
  const root = doc.body.firstChild;
  if (!root) return null;
  return domNodesToReact(root.childNodes);
}

function HighlightedCode({
  text,
  language,
  error,
}: {
  text: string;
  language?: HighlightLanguage;
  error?: boolean;
}) {
  const nodes = useMemo(() => parseHljsHtml(highlightText(text, language)), [text, language]);

  return (
    <pre className="whitespace-pre-wrap text-[11px] leading-relaxed font-mono">
      <code className={cn("hljs", "bg-transparent p-0", error && "text-red-200/90")}>
        {nodes}
      </code>
    </pre>
  );
}

function TruncatedText({
  text,
  maxLines = 20,
  language,
  error,
  className,
}: {
  text: string;
  maxLines?: number;
  language?: HighlightLanguage;
  error?: boolean;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split("\n");
  const truncated = !expanded && lines.length > maxLines;
  const displayText = truncated ? lines.slice(0, maxLines).join("\n") : text;

  return (
    <div className={className}>
      <HighlightedCode text={displayText} language={language} error={error} />
      {truncated && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-0.5 text-[10px] text-muted-foreground hover:text-foreground"
        >
          +{lines.length - maxLines} lines
        </button>
      )}
      {expanded && lines.length > maxLines && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mt-0.5 text-[10px] text-muted-foreground hover:text-foreground"
        >
          collapse
        </button>
      )}
    </div>
  );
}

export function CodePanel({
  text,
  maxLines = 25,
  mono = true,
  language,
  error,
}: {
  text: string;
  maxLines?: number;
  mono?: boolean;
  language?: HighlightLanguage;
  error?: boolean;
}) {
  return (
    <div className={cn(mono && "font-mono")}>
      <TruncatedText
        text={text}
        maxLines={maxLines}
        language={language}
        error={error}
        className="border-border/50 border-l pl-2"
      />
    </div>
  );
}
