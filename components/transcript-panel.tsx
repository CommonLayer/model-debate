import type { DebateRunResult } from "@/lib/types";

type TranscriptPanelProps = {
  result: DebateRunResult | null;
};

export function TranscriptPanel({ result }: TranscriptPanelProps) {
  const wordCount = result
    ? result.transcript
        .flatMap((turn) => turn.text.split(/\s+/))
        .filter(Boolean).length
    : 0;

  return (
    <section className="panel panel-compact">
      <div className="panel-header">
        <div>
          <div className="panel-kicker">Transcript</div>
          <h2>Debate</h2>
          <p>Alternating turns, ordered round by round.</p>
        </div>
        <div className="metrics-block mono">
          <span>{result?.transcript.length ?? 0} turns</span>
          <span>{wordCount} words</span>
        </div>
      </div>

      <div className="panel-body">
        {!result ? (
          <div className="empty-state">
            The transcript appears here turn by turn. Each successful run returns exactly two turns
            per round, in strict A then B order.
          </div>
        ) : (
          <div className="turn-list">
            {result.transcript.map((turn) => (
              <article key={turn.id} className="turn-card">
                <div className="turn-meta">
                  <div className="pill">Round {turn.round}</div>
                  <div className="pill">Participant {turn.participant}</div>
                  <div className="pill mono">{turn.model}</div>
                </div>
                <div className="turn-body">{turn.text}</div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
