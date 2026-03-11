import type { ComponentPropsWithoutRef, JSX } from "react";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownRendererProps = {
  className?: string;
  content: string;
};

function InlineCode(props: ComponentPropsWithoutRef<"code">): JSX.Element {
  const { className, children, ...rest } = props;

  return (
    <code
      className={[
        "rounded border border-border/70 bg-background/70 px-1.5 py-0.5 font-mono text-[0.9em]",
        className || ""
      ].join(" ")}
      {...rest}
    >
      {children}
    </code>
  );
}

export function MarkdownRenderer({
  className,
  content
}: MarkdownRendererProps): JSX.Element {
  return (
    <div className={["markdown-renderer", className || ""].join(" ").trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ className: headingClassName, ...props }) => (
            <h1 className={["text-2xl font-semibold tracking-tight", headingClassName || ""].join(" ")} {...props} />
          ),
          h2: ({ className: headingClassName, ...props }) => (
            <h2 className={["mt-6 text-xl font-semibold tracking-tight", headingClassName || ""].join(" ")} {...props} />
          ),
          h3: ({ className: headingClassName, ...props }) => (
            <h3 className={["mt-5 text-lg font-semibold tracking-tight", headingClassName || ""].join(" ")} {...props} />
          ),
          h4: ({ className: headingClassName, ...props }) => (
            <h4 className={["mt-4 text-base font-semibold tracking-tight", headingClassName || ""].join(" ")} {...props} />
          ),
          p: ({ className: paragraphClassName, ...props }) => (
            <p className={["leading-7 text-foreground/95", paragraphClassName || ""].join(" ")} {...props} />
          ),
          ul: ({ className: listClassName, ...props }) => (
            <ul className={["ml-5 list-disc space-y-2", listClassName || ""].join(" ")} {...props} />
          ),
          ol: ({ className: listClassName, ...props }) => (
            <ol className={["ml-5 list-decimal space-y-2", listClassName || ""].join(" ")} {...props} />
          ),
          li: ({ className: itemClassName, ...props }) => (
            <li className={["pl-1", itemClassName || ""].join(" ")} {...props} />
          ),
          hr: ({ className: hrClassName, ...props }) => (
            <hr className={["my-6 border-border/80", hrClassName || ""].join(" ")} {...props} />
          ),
          blockquote: ({ className: quoteClassName, ...props }) => (
            <blockquote
              className={[
                "border-l-2 border-border/80 pl-4 text-muted-foreground",
                quoteClassName || ""
              ].join(" ")}
              {...props}
            />
          ),
          code(props) {
            const { className: codeClassName, children, ...rest } = props;
            const isBlock =
              typeof codeClassName === "string" && codeClassName.includes("language-");

            if (isBlock) {
              return (
                <code
                  className={[
                    "block overflow-x-auto rounded-lg border border-border/70 bg-background/80 p-4 font-mono text-sm",
                    codeClassName
                  ].join(" ")}
                  {...rest}
                >
                  {children}
                </code>
              );
            }

            return (
              <InlineCode className={codeClassName} {...rest}>
                {children}
              </InlineCode>
            );
          },
          pre: ({ className: preClassName, ...props }) => (
            <pre
              className={[
                "scroll-soft my-4 overflow-x-auto rounded-lg border border-border/70 bg-background/80 p-4",
                preClassName || ""
              ].join(" ")}
              {...props}
            />
          ),
          strong: ({ className: strongClassName, ...props }) => (
            <strong
              className={["font-semibold text-foreground", strongClassName || ""].join(" ")}
              {...props}
            />
          )
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
