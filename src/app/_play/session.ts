import type { MoveResponse, PlayView } from "@/core/view";
import type { StartResponse } from "./actions";

export type SessionResult = { ok: true } | { ok: false; message: string };

const START_FAILED = "Couldn't start the game. Check your connection and try again.";
const MOVE_FAILED = "Couldn't reach the server. Try again.";
const MOVED_ELSEWHERE = "Updated from another session.";

/** JSON with every object's keys sorted, so a jsonb round trip (which reorders keys) compares equal. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** The parts of a view a play's progress is in: the same play of the same puzzle, as far as the board goes. */
function samePlay(a: PlayView, b: PlayView): boolean {
  return a.version === b.version && a.status === b.status && sameJson(a.state, b.state) && sameJson(a.puzzle, b.puzzle);
}

/**
 * One play's conversation with the server, without React (`useGameSession` renders it): the
 * authoritative view, Start and moves, and what the screen should say while they're out.
 *
 * Start is instant when the page brought `startingView` (the view the server makes for a new play):
 * the board shows at once and the server confirms behind it. A move made meanwhile waits for that
 * answer. If the start is refused (the day rolled over, too many requests, no connection) the board
 * goes back to the start screen with the reason; if the server already had a play (started in
 * another tab or on another device) its view replaces the starting one, and a move made on the
 * starting board is dropped, as for any move made on an outdated view.
 */
export function createPlaySession(options: {
  initialView: PlayView | null;
  /** The view a new play starts from, built by the server with the page; null to wait for Start's answer. */
  startingView: PlayView | null;
  startGame(): Promise<StartResponse>;
  submitMove(version: number, move: unknown): Promise<MoveResponse>;
  /** Called with whatever changed. */
  show(change: { view?: PlayView | null; pending?: boolean; notice?: string | null }): void;
}) {
  const { startingView, show } = options;
  let view = options.initialView;
  /** Start's answer while the starting board is already showing. */
  let starting: Promise<SessionResult> | null = null;

  function setView(next: PlayView | null) {
    view = next;
    show({ view: next });
  }

  async function confirmStart(): Promise<SessionResult> {
    try {
      const res = await options.startGame();
      if (res.ok) {
        if (!samePlay(res.view, startingView!)) setView(res.view);
        return { ok: true };
      }
      setView(null);
      show({ notice: res.message });
      return { ok: false, message: res.message };
    } catch {
      setView(null);
      show({ notice: START_FAILED });
      return { ok: false, message: START_FAILED };
    }
  }

  /** Starts the play; resolves once the server has answered (the board may be showing already). */
  async function start(): Promise<SessionResult> {
    if (starting) return starting;
    show({ notice: null });
    if (startingView) {
      setView(startingView);
      starting = confirmStart();
      const result = await starting;
      starting = null;
      return result;
    }
    show({ pending: true });
    try {
      const res = await options.startGame();
      if (res.ok) {
        setView(res.view);
        return { ok: true };
      }
      show({ notice: res.message });
      return { ok: false, message: res.message };
    } catch {
      show({ notice: START_FAILED });
      return { ok: false, message: START_FAILED };
    } finally {
      show({ pending: false });
    }
  }

  async function move(m: unknown): Promise<SessionResult> {
    if (!view) return { ok: false, message: "Start the game first." };
    // The board the player chose this move on.
    const seen = view;
    show({ pending: true, notice: null });
    try {
      if (starting) {
        const started = await starting;
        // A refused start has said why, and the start screen is back.
        if (!started.ok) return started;
        if (view !== seen) {
          show({ notice: MOVED_ELSEWHERE });
          return { ok: false, message: MOVED_ELSEWHERE };
        }
      }
      const res = await options.submitMove(seen.version, m);
      if (res.ok) {
        setView(res.view);
        return { ok: true };
      }
      if (res.view) setView(res.view);
      // Game-level rejections are shown by the game's UI; platform-level ones through `notice`.
      if (res.reason !== "invalid_move") show({ notice: res.message });
      return { ok: false, message: res.message };
    } catch {
      show({ notice: MOVE_FAILED });
      return { ok: false, message: MOVE_FAILED };
    } finally {
      show({ pending: false });
    }
  }

  return { start, move };
}
