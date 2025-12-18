import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { io } from "socket.io-client";
import type { GameStateForClient, ShipCell, Shot } from "./gameTypes";

const socket = io("http://localhost:3000");

// Storage Keys
const SS_NICKNAME = "sv.sessionNickname";      // pro Tab
const LS_LAST_NICKNAME = "sv.lastNickname";
const LS_LAST_STATE = "sv.lastGameState";
const LS_CHAT = "sv.chatMessages";

type User = { id: string; name: string };
const GRID_SIZE = 8;

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export default function App() {
  // Nickname: Input startet mit "letzter Nickname", Login-Status pro Tab via sessionStorage
  const [nickname, setNickname] = useState(() => localStorage.getItem(LS_LAST_NICKNAME) ?? "");
  const [isLoggedIn, setIsLoggedIn] = useState(() => {
    return (sessionStorage.getItem(SS_NICKNAME) ?? "").trim().length > 0;
  });

  const [me, setMe] = useState<User | null>(null);
  const [players, setPlayers] = useState<User[]>([]);

  // Chat
  const [chatText, setChatText] = useState("");
  const [messages, setMessages] = useState<string[]>(() =>
    safeJsonParse<string[]>(localStorage.getItem(LS_CHAT), [])
  );

  // Status
  const [status, setStatus] = useState("");

  // Spiel
  const [game, setGame] = useState<GameStateForClient | null>(() =>
    safeJsonParse<GameStateForClient | null>(localStorage.getItem(LS_LAST_STATE), null)
  );

  useEffect(() => {
    socket.on("server.login.ok", (d: { you: User; users: User[] }) => {
      // pro Tab
      sessionStorage.setItem(SS_NICKNAME, d.you.name);
      
      localStorage.setItem(LS_LAST_NICKNAME, d.you.name);

      setNickname(d.you.name);
      setMe(d.you);
      setPlayers(d.users);
      setIsLoggedIn(true);
      setStatus(`Angemeldet als ${d.you.name}`);
    });

    socket.on("server.login.fehler", (e: { code?: string; message?: string }) => {
      setStatus(`Login-Fehler: ${e.message ?? "Unbekannter Fehler"}`);
      setIsLoggedIn(false);
      setMe(null);
      sessionStorage.removeItem(SS_NICKNAME);
    });

    socket.on("server.users.update", (d: { users: User[] }) => {
      setPlayers(d.users);
    });

    socket.on("lobby.chat.empfangen", (m: { von: string; text: string }) => {
      setMessages((prev) => {
        const next = [...prev, `${m.von}: ${m.text}`];
        localStorage.setItem(LS_CHAT, JSON.stringify(next));
        return next;
      });
    });

    socket.on("lobby.chat.ok", () => {
      setStatus("Nachricht gesendet.");
    });

    socket.on("error", (e: any) => {
      setStatus(`${e.code ?? "Fehler"}: ${e.message ?? ""}`);
    });

    socket.on("game.state", (state: GameStateForClient) => {
      setGame(state);
      localStorage.setItem(LS_LAST_STATE, JSON.stringify(state));
    });

    // Auto-Login pro Tab (sessionStorage)
    const saved = (sessionStorage.getItem(SS_NICKNAME) ?? "").trim();
    if (saved) {
      socket.emit("client.login.senden", { name: saved });
      setStatus(`Angemeldet als ${saved}`);
      setIsLoggedIn(true);
    }

    return () => {
      socket.off("server.login.ok");
      socket.off("server.login.fehler");
      socket.off("server.users.update");
      socket.off("lobby.chat.empfangen");
      socket.off("lobby.chat.ok");
      socket.off("error");
      socket.off("game.state");
    };
  }, []);

  const anmelden = () => {
    const name = nickname.trim();
    if (!name) return setStatus("Bitte Nickname eingeben.");
    socket.emit("client.login.senden", { name });
  };

  const abmelden = () => {
    socket.emit("client.logout");
    sessionStorage.removeItem(SS_NICKNAME);

    setIsLoggedIn(false);
    setMe(null);
    setGame(null);
    setStatus("Abgemeldet.");
  };

  const sendenChat = () => {
    const txt = chatText.trim();
    if (!txt) return;
    socket.emit("lobby.chat.senden", { text: txt });
    setChatText("");
  };

  const feuern = (x: number, y: number) => {
    if (!game || !me) return;
    if (game.phase !== "playing") return setStatus("Spiel ist noch nicht im Spielmodus.");
    if (game.currentTurnPlayerId !== me.id) return setStatus("Nicht dein Zug.");
    socket.emit("game.shoot", { x, y });
  };

  const hasShipAt = (ships: ShipCell[], x: number, y: number) =>
    ships.some((s) => s.x === x && s.y === y);

  const shotAt = (shots: Shot[], x: number, y: number) =>
    shots.find((s) => s.x === x && s.y === y);

  const isInGame = useMemo(() => {
    if (!game || !me) return false;
    // Wenn Gegner null + keine Ships -> Einstufung als Lobby/Spectator durch Server 
    if (!game.opponent) return false;
    return true;
  }, [game, me]);

  const renderOwnBoard = () => {
    if (!game || !isInGame) return null;

    const rows = [];
    for (let y = 0; y < GRID_SIZE; y++) {
      const cells = [];
      for (let x = 0; x < GRID_SIZE; x++) {
        const hasShip = hasShipAt(game.myShips, x, y);
        const enemyShot = shotAt(game.enemyShotsOnMe, x, y);

        let bg = hasShip ? "#dbeafe" : "#0b4ea2";
        let marker = "";
        let color = "white";

        if (enemyShot) {
          marker = enemyShot.hit ? "●" : "○";
          color = enemyShot.hit ? "#ef4444" : "white";
        }

        cells.push(
          <div
            key={x}
            style={{
              width: 26,
              height: 26,
              background: bg,
              border: "1px solid #ffffff33",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
              color,
              borderRadius: 4,
            }}
          >
            {marker}
          </div>
        );
      }
      rows.push(
        <div key={y} style={{ display: "flex", gap: 2 }}>
          {cells}
        </div>
      );
    }

    return (
      <div>
        <h3 style={{ margin: "0 0 8px 0" }}>Dein Feld</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>{rows}</div>
      </div>
    );
  };

  const renderEnemyBoard = () => {
    if (!game || !me || !isInGame) return null;

    const canShoot = game.phase === "playing" && game.currentTurnPlayerId === me.id;

    const rows = [];
    for (let y = 0; y < GRID_SIZE; y++) {
      const cells = [];
      for (let x = 0; x < GRID_SIZE; x++) {
        const myShot = shotAt(game.myShots, x, y);

        let bg = "#0b4ea2";
        let marker = "";
        if (myShot) {
          marker = myShot.hit ? "●" : "○";
          bg = myShot.hit ? "#7a0000" : "#08418a";
        }

        cells.push(
          <div
            key={x}
            onClick={() => canShoot && feuern(x, y)}
            style={{
              width: 26,
              height: 26,
              background: bg,
              border: "1px solid #ffffff33",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
              color: "white",
              cursor: canShoot ? "pointer" : "not-allowed",
              opacity: canShoot ? 1 : 0.9,
              borderRadius: 4,
            }}
          >
            {marker}
          </div>
        );
      }
      rows.push(
        <div key={y} style={{ display: "flex", gap: 2 }}>
          {cells}
        </div>
      );
    }

    return (
      <div>
        <h3 style={{ margin: "0 0 8px 0" }}>Gegner</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>{rows}</div>
      </div>
    );
  };

  const renderGameInfo = () => {
    if (!game || !me) return null;

    // Spectator/Lobby
    if (!isInGame) {
      return (
        <p style={{ marginTop: 10, fontWeight: 700, color: "#b00" }}>
          Spielfeld noch nicht verfügbar. Tipp: Es können nur 2 Spieler gleichzeitig spielen.
        </p>
      );
    }

    let text = "";
    if (game.phase === "waiting") {
      text = "Warte auf zweite:n Spieler:in…";
    } else if (game.phase === "playing") {
      text = game.currentTurnPlayerId === me.id ? "🟢 Du bist am Zug" : "🔴 Gegner ist am Zug";
    } else if (game.phase === "finished") {
      text = game.winnerId === me.id ? "🏆 Du hast gewonnen!" : "❌ Du hast verloren.";
    }

    return <p style={{ marginTop: 10, fontWeight: 700, color: "#b00" }}>{text}</p>;
  };

  const clearLocal = () => {
    sessionStorage.removeItem(SS_NICKNAME);
    localStorage.removeItem(LS_LAST_NICKNAME);
    localStorage.removeItem(LS_LAST_STATE);
    localStorage.removeItem(LS_CHAT);

    setNickname("");
    setIsLoggedIn(false);
    setMe(null);
    setPlayers([]);
    setMessages([]);
    setGame(null);
    setStatus("Storage gelöscht. Bitte neu anmelden.");
  };

  const styles: Record<string, CSSProperties> = {
    page: {
      minHeight: "100vh",
      padding: 24,
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      background: "linear-gradient(135deg, #0b4ea2 0%, #1e3a8a 35%, #0ea5e9 100%)",
    },
    container: { maxWidth: 1080, margin: "0 auto" },
    header: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      color: "white",
      marginBottom: 18,
    },
    card: {
      background: "rgba(255,255,255,0.94)",
      borderRadius: 16,
      padding: 18,
      boxShadow: "0 10px 30px rgba(0,0,0,0.20)",
    },
    topRow: {
      display: "flex",
      justifyContent: "space-between",
      gap: 12,
      alignItems: "center",
      flexWrap: "wrap",
      marginBottom: 10,
    },
    buttonPrimary: {
      background: "#0b4ea2",
      border: "1px solid #0b4ea2",
      color: "white",
      padding: "8px 12px",
      borderRadius: 10,
      fontWeight: 600,
      cursor: "pointer",
      whiteSpace: "nowrap",
    },
    buttonGhost: {
      background: "transparent",
      border: "1px solid #0b4ea2",
      color: "#0b4ea2",
      padding: "8px 12px",
      borderRadius: 10,
      fontWeight: 600,
      cursor: "pointer",
      whiteSpace: "nowrap",
    },
    input: {
      width: "100%",
      maxWidth: 320,
      minWidth: 0,
      boxSizing: "border-box",
      padding: "10px 12px",
      borderRadius: 10,
      border: "1px solid #cbd5e1",
      outline: "none",
    },
    status: {
      margin: "8px 0 0 0",
      color: "#0f172a",
      background: "#e0f2fe",
      border: "1px solid #bae6fd",
      padding: "10px 12px",
      borderRadius: 12,
    },
    layout: { display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" },
    colGame: { flex: "1 1 520px" },
    colChat: { flex: "1 1 300px" },
    chatBox: {
      background: "#f1f5f9",
      border: "1px solid #e2e8f0",
      borderRadius: 12,
      padding: 10,
      height: 220,
      overflowY: "auto",
      marginBottom: 10,
    },
  };

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <span style={{ fontSize: 30 }}>⚓</span>
          <h1 style={{ margin: 0, fontSize: 36, fontWeight: 800 }}>Schiffe versenken</h1>
        </div>

        <div style={styles.card}>
          <div style={styles.topRow}>
            <div>
              {!isLoggedIn ? (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <input
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder="Nickname eingeben…"
                    onKeyDown={(e) => e.key === "Enter" && anmelden()}
                    style={styles.input}
                  />
                  <button onClick={anmelden} style={styles.buttonPrimary}>
                    Anmelden
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 700, color: "#0f172a" }}>
                    {me ? `Angemeldet als ${me.name}` : "Angemeldet"}
                  </div>
                  <button onClick={abmelden} style={styles.buttonPrimary}>
                    Abmelden
                  </button>
                </div>
              )}
            </div>

            <button onClick={clearLocal} style={styles.buttonGhost}>
              Storage löschen
            </button>
          </div>

          {status && <div style={styles.status}>{status}</div>}

          {isLoggedIn && (
            <div style={{ marginTop: 16 }}>
              <div style={styles.layout}>
                <div style={styles.colGame}>
                  <h2 style={{ margin: "0 0 10px 0" }}>Spielfeld</h2>

                  {isInGame ? (
                    <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
                      {renderOwnBoard()}
                      {renderEnemyBoard()}
                    </div>
                  ) : (
                    <div style={styles.status}>
                      Warten auf den Spielstart (maximal 2 Spieler gleichzeitig)
                    </div>
                  )}

                  {renderGameInfo()}
                </div>

                <div style={styles.colChat}>
                  <h2 style={{ margin: "0 0 10px 0" }}>Chat</h2>
                  <div style={styles.chatBox}>
                    {messages.map((m, i) => (
                      <div key={i} style={{ padding: "2px 0" }}>
                        {m}
                      </div>
                    ))}
                  </div>

                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      value={chatText}
                      onChange={(e) => setChatText(e.target.value)}
                      placeholder="Nachricht…"
                      onKeyDown={(e) => e.key === "Enter" && sendenChat()}
                      style={{ ...styles.input, width: "100%" }}
                    />
                    <button onClick={sendenChat} style={styles.buttonPrimary}>
                      Senden
                    </button>
                  </div>

                  <h2 style={{ marginTop: 14 }}>Spieler online</h2>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {players.map((p) => (
                      <li key={p.id}>
                        {p.name}
                        {me && p.id === me.id ? " (du)" : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={{ color: "rgba(255,255,255,0.85)", marginTop: 12, fontSize: 12 }}>
          Tipp: Bitte 2 Tabs öffnen → in jedem Tab anderer Name → spielen.
        </div>
      </div>
    </div>
  );
}
