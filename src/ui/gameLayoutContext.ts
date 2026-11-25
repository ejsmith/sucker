import { createContext, useContext } from 'react';
import type { GameLayout } from './gameLayout';

// The game screen's scale, shared with pieces drawn outside it, like a past
// game's scorecard.
export const GameLayoutContext = createContext<GameLayout | null>(null);

export function useGameLayout() {
  const layout = useContext(GameLayoutContext);
  if (!layout) {
    throw new Error('Game layout components must be rendered inside GameLayoutContext.');
  }

  return layout;
}
