// client/src/gameTypes.ts

export type GamePhase = "waiting" | "playing" | "finished";

export interface ShipCell {
  x: number;
  y: number;
  hit: boolean;
}

// Shot-Typ, wird durch Client zum Rendern genutzt (x/y + hit)
export interface Shot {
  x: number;
  y: number;
  hit: boolean;
}

export interface UserPublic {
  id: string;
  name: string;
}

export interface GameStateForClient {
  phase: GamePhase;
  you: UserPublic;
  opponent: UserPublic | null;
  currentTurnPlayerId: string | null;

  myShips: ShipCell[];
  enemyShotsOnMe: Shot[];
  myShots: Shot[];

  winnerId?: string;
}
