type ParticipantFieldsProps = {
  participantAModel: string;
  participantBModel: string;
  synthesisModel: string;
  onParticipantAModelChange: (value: string) => void;
  onParticipantBModelChange: (value: string) => void;
  onSynthesisModelChange: (value: string) => void;
};

export function ParticipantFields({
  participantAModel,
  participantBModel,
  synthesisModel,
  onParticipantAModelChange,
  onParticipantBModelChange,
  onSynthesisModelChange
}: ParticipantFieldsProps) {
  return (
    <div className="stack">
      <div className="field-legend">Models</div>

      <div className="participant-card">
        <h3>Participant A</h3>
        <p>Opens the debate and sets the first pressure point.</p>
        <div className="field">
          <label htmlFor="participant-a-model">Model</label>
          <input
            id="participant-a-model"
            className="input mono"
            value={participantAModel}
            onChange={(event) => onParticipantAModelChange(event.target.value)}
            placeholder="openai/gpt-5.2"
          />
        </div>
      </div>

      <div className="participant-card">
        <h3>Participant B</h3>
        <p>Responds directly to A and drives the counter-position.</p>
        <div className="field">
          <label htmlFor="participant-b-model">Model</label>
          <input
            id="participant-b-model"
            className="input mono"
            value={participantBModel}
            onChange={(event) => onParticipantBModelChange(event.target.value)}
            placeholder="anthropic/claude-sonnet-4-6"
          />
        </div>
      </div>

      <div className="participant-card">
        <h3>Synthesis</h3>
        <p>Produces the final Markdown synthesis from the full transcript.</p>
        <div className="field">
          <label htmlFor="synthesis-model">Model</label>
          <input
            id="synthesis-model"
            className="input mono"
            value={synthesisModel}
            onChange={(event) => onSynthesisModelChange(event.target.value)}
            placeholder="openai/gpt-5.2"
          />
        </div>
      </div>
    </div>
  );
}
