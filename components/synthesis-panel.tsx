import type { DebateRunResult } from "@/lib/types";

type SynthesisPanelProps = {
  actions?: React.ReactNode;
  result: DebateRunResult | null;
};

export function SynthesisPanel({ actions, result }: SynthesisPanelProps) {
  return (
    <section className="panel panel-main">
      <div className="panel-header">
        <div>
          <div className="panel-kicker">Working Doc</div>
          <h2>Debate synthesis</h2>
          <p>Structured Markdown generated from the full transcript after the debate completes.</p>
        </div>
        <div className="panel-actions">
          {actions}
          {result ? <div className="pill mono">{result.synthesis.model}</div> : null}
        </div>
      </div>

      <div className="panel-body stack panel-body-main">
        {result ? (
          <div className="markdown-block">{result.synthesis.markdown}</div>
        ) : (
          <div className="doc-stage">
            <div className="doc-callout">
              Run a debate to generate a working synthesis in Markdown, then export it directly
              from the header.
            </div>
            <div className="doc-stage-fill" />
          </div>
        )}
      </div>
    </section>
  );
}
