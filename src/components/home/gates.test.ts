import { describe, expect, it } from "vitest";
import { decideMoments, PREPAINT_CSS_SRC, PREPAINT_DECIDE_SRC, preSetInCss, prePaintScript, type GateConfig } from "./gates";

/** The pre-paint script's copy of the decision, evaluated as the browser would. */
const prepaintDecide = new Function(`return (${PREPAINT_DECIDE_SRC})`)() as typeof decideMoments;
const prepaintCss = new Function(`return (${PREPAINT_CSS_SRC})`)() as typeof preSetInCss;

function store(entries: Record<string, string>): Pick<Storage, "getItem"> {
  return { getItem: (k: string) => (k in entries ? entries[k] : null) };
}

const DAY_START = Date.parse("2026-10-07T04:00:00Z");
const cfg: GateConfig = {
  date: "2026-10-07",
  dayStart: DAY_START,
  finished: [
    ["number-hunt", DAY_START + 9 * 3600e3],
    ["fade-to-color", DAY_START + 13.6 * 3600e3],
  ],
};

const throwing: Pick<Storage, "getItem"> = {
  getItem() {
    throw new Error("blocked");
  },
};

const cases: [string, GateConfig, Pick<Storage, "getItem"> | null, boolean][] = [
  ["first visit ever: the opening, no set-in", cfg, store({}), false],
  ["opening already seen today, no record", cfg, store({ "home.opening.v1:2026-10-07": "1" }), false],
  [
    "back from a game: the newest finish since the last visit",
    cfg,
    store({ "home.opening.v1:2026-10-07": "1", "home.seen.v1": JSON.stringify({ date: "2026-10-07", at: DAY_START + 8 * 3600e3, setIn: [] }) }),
    false,
  ],
  [
    "a set-in already played is not repeated",
    cfg,
    store({ "home.opening.v1:2026-10-07": "1", "home.seen.v1": JSON.stringify({ date: "2026-10-07", at: DAY_START + 8 * 3600e3, setIn: ["fade-to-color"] }) }),
    false,
  ],
  [
    "a record from yesterday counts from the start of today",
    cfg,
    store({ "home.seen.v1": JSON.stringify({ date: "2026-10-06", at: DAY_START - 3600e3, setIn: ["fade-to-color"] }) }),
    false,
  ],
  ["storage that throws: no opening, no set-in", cfg, throwing, false],
  ["no storage at all", cfg, null, false],
  ["reduced motion: no opening", cfg, store({}), true],
  ["QA forces both", { ...cfg, forceOpening: true, forceSetIn: "number-hunt" }, store({ "home.opening.v1:2026-10-07": "1" }), false],
  ["a corrupt record", cfg, store({ "home.seen.v1": "{nope" }), false],
];

describe("decideMoments", () => {
  it.each(cases)("%s: the pre-paint copy decides the same", (_label, c, s, rm) => {
    expect(prepaintDecide(c, s, rm)).toEqual(decideMoments(c, s, rm));
  });

  it("plays the opening once a day and nothing else on a first visit", () => {
    expect(decideMoments(cfg, store({}), false)).toEqual({ opening: true, setIn: null, candidates: [] });
  });

  it("sets in the most recent finish since the last visit, and marks every newer one", () => {
    const s = store({ "home.opening.v1:2026-10-07": "1", "home.seen.v1": JSON.stringify({ date: "2026-10-07", at: DAY_START + 8 * 3600e3, setIn: [] }) });
    expect(decideMoments(cfg, s, false)).toEqual({ opening: false, setIn: "fade-to-color", candidates: ["number-hunt", "fade-to-color"] });
  });

  it("treats broken storage as seen", () => {
    expect(decideMoments(cfg, throwing, false)).toEqual({ opening: false, setIn: null, candidates: [] });
  });
});

describe("the pre-paint script", () => {
  it("holds the same pre-state CSS as the client", () => {
    expect(prepaintCss("fade-to-color")).toBe(preSetInCss("fade-to-color"));
    expect(preSetInCss('x"]{}*{')).not.toContain('"]{}');
  });

  it("is the same string for the same day (server and browser HTML match)", () => {
    expect(prePaintScript(cfg)).toBe(prePaintScript({ ...cfg }));
    expect(prePaintScript({ ...cfg, date: "</script>" as string })).not.toContain("</script>");
  });

  it("parses", () => {
    expect(() => new Function(prePaintScript(cfg))).not.toThrow();
  });
});
