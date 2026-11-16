// Keep step progress and CSS hooks compatible while assembling Frame's three-part mark.
const VIEW_BOX = "0 0 100 100";
const JIB_D = "M12 46V24A12 12 0 0 1 24 12H62V26H26V46Z";
const SAIL_D =
  "M41 36.6C41 34.4 43.4 33 45.3 34.2L66.2 47.4C68 48.5 68 51.2 66.2 52.3L45.3 65.8C43.4 67 41 65.6 41 63.4Z";
const HULL_D = "M88 54V76A12 12 0 0 1 76 88H38V74H74V54Z";

type Part = "hull" | "jib" | "sail";

/** Earned order. A hull is the first thing that exists, sails go up after. */
const BUILD_ORDER: readonly Part[] = ["hull", "jib", "sail"];
/** Paint order. The hull has to sit over the foot of both sails. */
const PAINT_ORDER: readonly Part[] = ["jib", "sail", "hull"];

export const BOAT_PARTS = BUILD_ORDER.length;

const PATH_OF: Record<Part, string> = { hull: HULL_D, jib: JIB_D, sail: SAIL_D };
const HOIST_OF: Record<Part, string> = {
  hull: "setup-hoist-hull",
  jib: "setup-hoist-jib",
  sail: "setup-hoist-sail",
};
const LAG = ["", "setup-lag-1", "setup-lag-2"];

/** How much of the boat a run of steps is worth, so a one-step queue still
    finishes with a whole boat and a skipped step never fakes one. */
export function boatBuilt(confirmed: number, total: number): number {
  if (total <= 0 || confirmed <= 0) return 0;
  return Math.min(BOAT_PARTS, Math.ceil((BOAT_PARTS * confirmed) / total));
}

export function SetupBoat({
  built,
  animate = "none",
  ghost,
  className,
}: {
  built: number;
  animate?: "none" | "latest" | "all";
  /** Draws the parts not yet earned at a whisper, so the shape the viewer is
      filling in is visible from the first screen and each hoist lands into
      something. Off at the finish, where a missing sail would only nag. */
  ghost?: boolean;
  className?: string;
}) {
  return (
    <span className={`setup-boat ${className ?? ""}`} aria-hidden>
      {PAINT_ORDER.map((part) => {
        const step = BUILD_ORDER.indexOf(part);
        const earned = step < built;
        if (!earned && !ghost) return null;
        const hoist = !earned
          ? "opacity-[0.11]"
          : animate === "all"
            ? `${HOIST_OF[part]} ${LAG[step]}`
            : animate === "latest" && step === built - 1
              ? HOIST_OF[part]
              : "";
        return (
          <svg
            key={part}
            viewBox={VIEW_BOX}
            fill="currentColor"
            className={`setup-boat-part ${hoist}`}
          >
            <path d={PATH_OF[part]} />
          </svg>
        );
      })}
    </span>
  );
}
