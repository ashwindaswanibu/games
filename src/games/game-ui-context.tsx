"use client";

import { createContext, useContext, type ComponentType } from "react";
import type { AnyGameUi, AnyImmersiveGameUi, GameUiProps, ImmersiveGameUiProps } from "@/core/view";

/**
 * How a game's UI gets its props without the play page's client code knowing every game.
 *
 * The play page (a server component) picks the game's UI and renders it as a child of the game
 * host, which supplies the live props through this context. So the browser only ever loads the UI
 * of the game it is showing: no client chunk maps game ids to UIs, and players never learn the
 * code, rules or names of games still in testing.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- type-erased, like AnyGameUi
const GameUiContext = createContext<GameUiProps<any> | null>(null);

export const GameUiProvider = GameUiContext.Provider;

/** Wraps a game's UI so the server can render it with no props; the host provides them. */
export function connectGameUi(Ui: AnyGameUi): ComponentType {
  function ConnectedGameUi() {
    const props = useContext(GameUiContext);
    if (!props) throw new Error("A game UI must be rendered inside the game host");
    return <Ui {...props} />;
  }
  ConnectedGameUi.displayName = `Connected(${Ui.displayName ?? Ui.name ?? "GameUi"})`;
  return ConnectedGameUi;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- type-erased, like AnyImmersiveGameUi
const ImmersiveGameUiContext = createContext<ImmersiveGameUiProps<any> | null>(null);
export const ImmersiveGameUiProvider = ImmersiveGameUiContext.Provider;

/** `connectGameUi` for games that own the whole screen (see `ImmersiveGameUiProps`). */
export function connectImmersiveGameUi(Ui: AnyImmersiveGameUi): ComponentType {
  function ConnectedImmersiveGameUi() {
    const props = useContext(ImmersiveGameUiContext);
    if (!props) throw new Error("A full-screen game UI must be rendered inside the immersive game host");
    return <Ui {...props} />;
  }
  ConnectedImmersiveGameUi.displayName = `ConnectedImmersive(${Ui.displayName ?? Ui.name ?? "GameUi"})`;
  return ConnectedImmersiveGameUi;
}
