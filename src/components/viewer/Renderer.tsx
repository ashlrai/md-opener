import { isValidElement, memo, type ReactNode, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSlug from "rehype-slug";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { type DocKind, detectDocKind } from "../../lib/agent-detect";
import { type CalloutType, remarkCallouts } from "../../lib/remark-callouts";
import "../../styles/callouts.css";
import { Callout } from "./Callout";
import { CodeBlock } from "./CodeBlock";
import { MermaidBlock } from "./MermaidBlock";
import { TaskCheckbox } from "./TaskCheckbox";

const CALLOUT_TYPES: CalloutType[] = ["note", "tip", "warning", "important", "caution"];

/** Recursively collect plain text from React children (for fenced code). */
function textOf(node: ReactNode): string {
  if (node == null || node === false) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) {
    return textOf((node.props as { children?: ReactNode }).children);
  }
  return "";
}

/** Detect a `callout-<type>` class (className may be a string or an array). */
function calloutTypeOf(className: unknown): CalloutType | null {
  const classes = Array.isArray(className)
    ? (className as string[])
    : typeof className === "string"
      ? className.split(/\s+/)
      : [];
  const hit = classes.find((c) => c.startsWith("callout-"));
  const type = hit?.slice("callout-".length) as CalloutType | undefined;
  return type && CALLOUT_TYPES.includes(type) ? type : null;
}

const components: Components = {
  // Replace the default <pre> with our themed code block / mermaid renderer.
  pre({ children }) {
    const child = Array.isArray(children) ? children[0] : children;
    if (isValidElement(child)) {
      const props = child.props as { className?: string; children?: ReactNode };
      const match = /language-([\w+#-]+)/.exec(props.className ?? "");
      const lang = match?.[1]?.toLowerCase() ?? "text";
      const code = textOf(props.children).replace(/\n$/, "");
      if (lang === "mermaid") return <MermaidBlock code={code} />;
      return <CodeBlock code={code} lang={lang} />;
    }
    return <pre>{children}</pre>;
  },
  // Open links in a new context; strip the react-markdown `node` prop.
  a({ href, children, node: _node, ...rest }) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" {...rest}>
        {children}
      </a>
    );
  },
  // Interactive GFM task-list checkboxes (write back to the source file).
  input(props) {
    if (props.type === "checkbox") {
      return <TaskCheckbox node={props.node} checked={props.checked} />;
    }
    const { node: _node, ...rest } = props;
    return <input {...rest} />;
  },
  // Callout cards: remark-callouts marks blockquotes as <div class="callout callout-*">.
  div(props) {
    const { node: _node, className, children, ...rest } = props;
    const calloutType = calloutTypeOf(className);
    if (calloutType) {
      return (
        <Callout calloutType={calloutType} node={_node}>
          {children}
        </Callout>
      );
    }
    const cls = Array.isArray(className)
      ? (className as string[]).join(" ")
      : className;
    return (
      <div className={cls} {...rest}>
        {children}
      </div>
    );
  },
};

const KIND_LABEL: Record<NonNullable<DocKind>, string> = {
  plan: "Plan",
  diff: "Diff",
  "multi-file": "Multi-file",
  generic: "Agent output",
};

function DocKindBadge({
  kind,
  total,
  done,
}: {
  kind: NonNullable<DocKind>;
  total: number;
  done: number;
}) {
  const icon =
    kind === "plan" ? "✓" : kind === "diff" ? "±" : kind === "multi-file" ? "⊞" : "◈";
  return (
    <div className="doc-kind-badge" data-kind={kind}>
      <span className="doc-kind-badge-icon" aria-hidden="true">
        {icon}
      </span>
      {KIND_LABEL[kind]}
      {total > 0 && (
        <span className="doc-kind-badge-progress">
          {done}/{total}
        </span>
      )}
    </div>
  );
}

interface RendererProps {
  content: string;
}

export const Renderer = memo(function Renderer({ content }: RendererProps) {
  const info = useMemo(() => detectDocKind(content), [content]);

  return (
    <div className="markdown-body" data-doc-kind={info.kind ?? undefined}>
      {info.kind && (
        <DocKindBadge kind={info.kind} total={info.taskTotal} done={info.taskDone} />
      )}
      <ReactMarkdown
        remarkPlugins={[remarkFrontmatter, remarkGfm, remarkMath, remarkCallouts]}
        rehypePlugins={[rehypeRaw, rehypeKatex, rehypeSlug]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
