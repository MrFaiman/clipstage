import { ArrowRight, Clapperboard, Monitor } from "lucide-react";
import type { Clip, ClipStatus } from "@clipstage/contracts";

const stages = [
  {
    status: "INBOX",
    label: "New clips",
    hint: "Ready to pick up",
    number: "01",
  },
  {
    status: "EDITING",
    label: "In progress",
    hint: "On the timeline",
    number: "02",
  },
  {
    status: "IN_REVIEW",
    label: "In review",
    hint: "Needs a second look",
    number: "03",
  },
  {
    status: "APPROVED",
    label: "Approved",
    hint: "Ready for what's next",
    number: "04",
  },
] as const;

export function StudioOverview({
  clips,
  status,
  onStatus,
  onConnect,
}: {
  clips: Clip[];
  status: ClipStatus | "ALL";
  onStatus: (status: ClipStatus) => void;
  onConnect: () => void;
}) {
  return (
    <section
      className="studio-overview"
      aria-labelledby="studio-overview-heading"
    >
      <div className="studio-intro">
        <div>
          <span className="studio-kicker">
            <Clapperboard size={16} aria-hidden="true" /> THE PRODUCTION DESK
          </span>
          <h2 id="studio-overview-heading">From live moment to final cut.</h2>
          <p>
            A clear view of your team's work. Select a stage to find your next
            edit.
          </p>
        </div>
        <button className="studio-connect" onClick={onConnect}>
          <Monitor size={18} aria-hidden="true" /> Connect OBS{" "}
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
      <div
        className="production-pipeline"
        role="group"
        aria-label="Production stages"
      >
        {stages.map((stage) => (
          <button
            key={stage.status}
            className="pipeline-stage"
            aria-pressed={status === stage.status}
            onClick={() => onStatus(stage.status)}
          >
            <span className="pipeline-stage-top">
              <span>
                {stage.number} / {stage.label}
              </span>
              <ArrowRight size={16} aria-hidden="true" />
            </span>
            <strong>
              {clips.filter((clip) => clip.status === stage.status).length}
            </strong>
            <span className="pipeline-stage-hint">{stage.hint}</span>
          </button>
        ))}
      </div>
      <p className="pipeline-note">
        Counts reflect loaded clips, not the entire workspace.
      </p>
    </section>
  );
}
