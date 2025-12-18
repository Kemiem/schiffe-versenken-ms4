import http from "http";
import { Server } from "socket.io";

const httpServer = http.createServer();
const io = new Server(httpServer, { cors: { origin: "*" } });



// Typen 
type GamePhase = "waiting" | "playing" | "finished";

interface User {
  id: string; // socket.id
  name: string;
}

interface BoardCell {
  hasShip: boolean;
  hit: boolean;
}

interface Shot {
  x: number;
  y: number;
  byId: string;
  hit: boolean;
}

interface Game {
  playerIds: string[];
  boards: Record<string, BoardCell[][]>;
  currentTurnPlayerId: string | null;
  phase: GamePhase;
  winnerId?: string;
  shots: Shot[];
}

interface ShipCell {
  x: number;
  y: number;
  hit: boolean;
}

interface ClientShot {
  x: number;
  y: number;
  hit: boolean;
}

interface GameStateForClient {
  phase: GamePhase;
  you: { id: string; name: string };
  opponent: { id: string; name: string } | null;
  currentTurnPlayerId: string | null;
  myShips: ShipCell[];
  enemyShotsOnMe: ClientShot[];
  myShots: ClientShot[];
  winnerId?: string;
}



// In-Memory State
const users: User[] = [];
let currentGame: Game | null = null;

const GRID = 8;
const FLEET = [4, 3, 2, 2, 1, 1];



// Board
function createEmptyBoard(size = GRID): BoardCell[][] {
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({ hasShip: false, hit: false }))
  );
}

function createRandomBoard(size = GRID): BoardCell[][] {
  const board = createEmptyBoard(size);

  function canPlace(x: number, y: number, len: number, horiz: boolean) {
    for (let i = 0; i < len; i++) {
      const xx = horiz ? x + i : x;
      const yy = horiz ? y : y + i;

      if (xx < 0 || yy < 0 || xx >= size || yy >= size) return false;
      if (board[yy][xx].hasShip) return false;
    }
    return true;
  }

  function place(x: number, y: number, len: number, horiz: boolean) {
    for (let i = 0; i < len; i++) {
      const xx = horiz ? x + i : x;
      const yy = horiz ? y : y + i;
      board[yy][xx].hasShip = true;
    }
  }

  for (const len of FLEET) {
    let placed = false;
    let tries = 0;

    while (!placed) {
      tries++;
      if (tries > 2000) return createRandomBoard(size); // Fallback

      const horiz = Math.random() < 0.5;
      const x = Math.floor(Math.random() * size);
      const y = Math.floor(Math.random() * size);

      if (canPlace(x, y, len, horiz)) {
        place(x, y, len, horiz);
        placed = true;
      }
    }
  }

  return board;
}


//Helper-Funktionen
function findUser(id: string) {
  return users.find((u) => u.id === id);
}

function removeUser(id: string) {
  const idx = users.findIndex((u) => u.id === id);
  if (idx >= 0) users.splice(idx, 1);
}



//Start und Reset Game
function resetGame() {
  currentGame = null;
}

function startGameIfPossible() {
  if (currentGame) return;
  if (users.length < 2) return;



  //Ersten zwei = Spieler 
  const [p1, p2] = users;

  currentGame = {
    playerIds: [p1.id, p2.id],
    boards: {
      [p1.id]: createRandomBoard(),
      [p2.id]: createRandomBoard(),
    },
    currentTurnPlayerId: p1.id,
    phase: "playing",
    shots: [],
  };

  console.log(`Neues Spiel gestartet: ${p1.name} vs ${p2.name}`);
  broadcastGameState();
}

function finishGame(winnerId: string) {
  if (!currentGame) return;
  currentGame.phase = "finished";
  currentGame.winnerId = winnerId;

  broadcastGameState();

  // TimeOut, damit Spiel Restart möglich
  setTimeout(() => {
    resetGame();
    startGameIfPossible();
    broadcastGameState();
  }, 1200);
}



// GameState -> Client Version
function buildGameStateFor(userId: string): GameStateForClient | null {
  const me = findUser(userId);
  if (!me) return null;

  if (!currentGame) {
    return {
      phase: "waiting",
      you: { id: me.id, name: me.name },
      opponent: null,
      currentTurnPlayerId: null,
      myShips: [],
      enemyShotsOnMe: [],
      myShots: [],
    };
  }

  // User:innen nicht Teil Spiels -> Lobby/Spectator
  if (!currentGame.playerIds.includes(userId)) {
    return {
      phase: "waiting",
      you: { id: me.id, name: me.name },
      opponent: null,
      currentTurnPlayerId: null,
      myShips: [],
      enemyShotsOnMe: [],
      myShots: [],
    };
  }

  const opponentId = currentGame.playerIds.find((id) => id !== userId) ?? null;
  const opponentUser = opponentId ? findUser(opponentId) : null;

  const myBoard = currentGame.boards[userId];
  if (!myBoard) return null;

  const myShips: ShipCell[] = [];
  myBoard.forEach((row, y) =>
    row.forEach((cell, x) => {
      if (cell.hasShip) myShips.push({ x, y, hit: cell.hit });
    })
  );

  const myShots: ClientShot[] = currentGame.shots
    .filter((s) => s.byId === userId)
    .map((s) => ({ x: s.x, y: s.y, hit: s.hit }));

  const enemyShotsOnMe: ClientShot[] = currentGame.shots
    .filter((s) => s.byId !== userId)
    .map((s) => ({ x: s.x, y: s.y, hit: s.hit }));

  return {
    phase: currentGame.phase,
    you: { id: me.id, name: me.name },
    opponent: opponentUser ? { id: opponentUser.id, name: opponentUser.name } : null,
    currentTurnPlayerId: currentGame.currentTurnPlayerId,
    myShips,
    enemyShotsOnMe,
    myShots,
    winnerId: currentGame.winnerId,
  };
}

function sendGameStateTo(userId: string) {
  const state = buildGameStateFor(userId);
  if (state) io.to(userId).emit("game.state", state);
}

function broadcastGameState() {
  // an alle verbundene User:innen, sehen Board
  users.forEach((u) => sendGameStateTo(u.id));
}

// Checks validity
function handleShot(shooterId: string, x: number, y: number) {
  if (!currentGame) {
    io.to(shooterId).emit("error", { code: "KEIN_SPIEL", message: "Es läuft aktuell kein Spiel." });
    return;
  }

  if (currentGame.phase !== "playing") {
    io.to(shooterId).emit("error", { code: "NICHT_SPIELPHASE", message: "Spiel ist nicht in der Spielphase." });
    return;
  }

  if (!currentGame.playerIds.includes(shooterId)) {
    io.to(shooterId).emit("error", { code: "NICHT_IM_SPIEL", message: "Du bist nicht Teil dieses Spiels." });
    return;
  }

  if (currentGame.currentTurnPlayerId !== shooterId) {
    io.to(shooterId).emit("error", { code: "NICHT_DRAN", message: "Du bist nicht am Zug." });
    return;
  }

  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= GRID || y >= GRID) {
    io.to(shooterId).emit("error", { code: "KOORD_UNGUELTIG", message: "Koordinaten ungültig." });
    return;
  }

  const enemyId = currentGame.playerIds.find((id) => id !== shooterId);
  if (!enemyId) {
    io.to(shooterId).emit("error", { code: "KEIN_GEGNER", message: "Kein Gegner vorhanden." });
    return;
  }

  const enemyBoard = currentGame.boards[enemyId];
  if (!enemyBoard) {
    io.to(shooterId).emit("error", { code: "KEIN_BOARD", message: "Gegner-Board nicht gefunden." });
    return;
  }

  const cell = enemyBoard[y][x];
  if (cell.hit) {
    io.to(shooterId).emit("error", { code: "BEREITS_GETROFFEN", message: "Dieses Feld wurde bereits beschossen." });
    return;
  }

  cell.hit = true;
  const hit = cell.hasShip;

  currentGame.shots.push({ x, y, byId: shooterId, hit });

  const enemyHasShipsLeft = enemyBoard.some((row) => row.some((c) => c.hasShip && !c.hit));
  if (!enemyHasShipsLeft) {
    finishGame(shooterId);
    return;
  }

  currentGame.currentTurnPlayerId = enemyId;
  broadcastGameState();
}




//Socket.IO
io.on("connection", (socket) => {
  console.log("Verbunden:", socket.id);

  socket.on("client.login.senden", ({ name }: { name?: string }) => {
    const nickname = String(name ?? "").trim();

    // Validity Checks
    if (!nickname) {
      socket.emit("server.login.fehler", { code: "NAME_LEER", message: "Name darf nicht leer sein." });
      return;
    }
    if (nickname.length > 20) {
      socket.emit("server.login.fehler", { code: "NAME_ZU_LANG", message: "Max. 20 Zeichen." });
      return;
    }
    const vergeben = users.some((u) => u.name.toLowerCase() === nickname.toLowerCase());
    if (vergeben) {
      socket.emit("server.login.fehler", { code: "NAME_BEREITS_VERGEBEN", message: "Name vergeben." });
      return;
    }

    const user: User = { id: socket.id, name: nickname };
    users.push(user);

    socket.emit("server.login.ok", { you: user, users });
    socket.broadcast.emit("server.users.update", { users });

    startGameIfPossible();
    sendGameStateTo(socket.id);
  });

  socket.on("client.logout", () => {
    removeUser(socket.id);
    io.emit("server.users.update", { users });

    // Spieler:in loggt sich aus dem Spiel -> andere Spieler:in gewinnt
    if (currentGame && currentGame.playerIds.includes(socket.id) && currentGame.phase === "playing") {
      const remaining = currentGame.playerIds.find((id) => id !== socket.id);
      if (remaining) finishGame(remaining);
      else resetGame();
    }

    broadcastGameState();
  });

  socket.on("lobby.chat.senden", ({ text }: { text?: string }) => {
    const u = findUser(socket.id);
    if (!u) {
      socket.emit("error", { code: "NICHT_EINGELOGGT", message: "Bitte zuerst einloggen." });
      return;
    }

    const msg = String(text ?? "").trim();
    if (!msg) {
      socket.emit("error", { code: "CHAT_LEER", message: "Nachricht darf nicht leer sein." });
      return;
    }

    io.emit("lobby.chat.empfangen", { von: u.name, text: msg });
    socket.emit("lobby.chat.ok", { received: true });
  });

  socket.on("game.shoot", ({ x, y }: { x?: number; y?: number }) => {
    handleShot(socket.id, Number(x), Number(y));
  });

  socket.on("disconnect", () => {
    const wasUser = findUser(socket.id);
    removeUser(socket.id);

    io.emit("server.users.update", { users });

    if (wasUser) console.log(`${wasUser.name} getrennt.`);
    else console.log(`Socket getrennt: ${socket.id}`);

    //Disconnect aus dem aktiven Spiel: Andere Spieler:in gewinnt
    if (currentGame && currentGame.playerIds.includes(socket.id) && currentGame.phase === "playing") {
      const remaining = currentGame.playerIds.find((id) => id !== socket.id);
      if (remaining) finishGame(remaining);
      else resetGame();
    }

    broadcastGameState();
  });
});

httpServer.listen(3000, () => {
  console.log("Server läuft auf http://localhost:3000");
});
