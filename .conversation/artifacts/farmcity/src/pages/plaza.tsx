import { useEffect, useRef, useState, useCallback } from 'react';
import { useLocation } from 'wouter';
import { Home as HomeIcon } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { useLanguage } from '@/contexts/language-context';
import { IsometricCanvas } from '@/components/isometric-canvas';
import type { LocalAction, RoomWall } from '@/components/isometric-canvas';
import { OwnAvatarPanel } from '@/components/panels/own-avatar-panel';
import { SettingsPanel } from '@/components/panels/settings-panel';
import { OtherPlayerPanel } from '@/components/panels/other-player-panel';
import { WorldObjectPanel } from '@/components/panels/world-object-panel';
import type { WorldObjectType } from '@/components/panels/world-object-panel';
import {
  getGetMyRoomQueryKey,
  getGetPlazaStatusQueryKey,
  useGetMyRoom,
  useGetPlazaStatus,
} from '@workspace/api-client-react';
import type { Avatar, PlayerSummary } from '@workspace/api-client-react';

interface WsPlayer {
  id: number;
  username: string;
  posX: number;
  posY: number;
  avatar?: Avatar;
}

interface ChatEntry {
  id?: number;
  username: string;
  message: string;
  createdAt: string;
  effect?: ChatEffect;
}

type ChatEffect = 'sparkles' | 'hearts' | 'faces' | 'music';
type ConnectionState = 'connecting' | 'connected' | 'reconnecting';
const DEFAULT_PLAZA_ROOM_ID = 'plaza';

const CHAT_EFFECT_OPTIONS: Array<{ id: ChatEffect; icon: string; label: string }> = [
  { id: 'sparkles', icon: '✨', label: 'Brillo' },
  { id: 'hearts', icon: '💖', label: 'Corazones' },
  { id: 'faces', icon: '😄', label: 'Caritas' },
  { id: 'music', icon: '🎵', label: 'Música' },
];

interface RoomSnapshot {
  id?: string;
  tiles?: Array<{ x: number; y: number }>;
  walls?: RoomWall[];
  floorTextureId?: string;
  players?: WsPlayer[];
}

type PanelState =
  | { kind: 'self' }
  | { kind: 'player'; player: WsPlayer }
  | { kind: 'object'; objectType: WorldObjectType };

export default function Plaza() {
  const { token, player: authPlayer, login, logout } = useAuth();
  const { t } = useLanguage();
  const [, setLocation] = useLocation();
  const roomIdFromUrl = new URLSearchParams(window.location.search).get('room');

  const [remotePlayers, setRemotePlayers] = useState<Record<number, WsPlayer>>({});
  // Position packets update this ref without forcing a React render. The
  // canvas consumes it on its own animation frame.
  const remotePlayersRef = useRef<Record<number, PlayerSummary>>({});
  // Transient actions are also renderer-owned state. Their expiry is relative
  // to each receiving client's clock, so the server only relays duration.
  const remoteActionsRef = useRef<Map<number, LocalAction>>(new Map());
  const [chatMessages, setChatMessages] = useState<ChatEntry[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [selectedChatEffect, setSelectedChatEffect] = useState<ChatEffect>('sparkles');
  const [isChatEffectPickerOpen, setIsChatEffectPickerOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [roomError, setRoomError] = useState<string | null>(null);
  const [roomRequiresPassword, setRoomRequiresPassword] = useState(false);
  const [roomPassword, setRoomPassword] = useState('');
  const [roomTiles, setRoomTiles] = useState<Array<{ x: number; y: number }> | undefined>(() => {
    if (roomIdFromUrl) return undefined;
    try {
      const saved = JSON.parse(window.localStorage.getItem('farmcity_current_room') ?? 'null') as RoomSnapshot | null;
      if (!saved?.tiles?.length) return undefined;
      const minX = Math.min(...saved.tiles.map((tile) => tile.x));
      const minY = Math.min(...saved.tiles.map((tile) => tile.y));
      return saved.tiles.map((tile) => ({ x: tile.x - minX, y: tile.y - minY }));
    } catch {
      return undefined;
    }
  });
  const [roomWalls, setRoomWalls] = useState<RoomWall[]>(() => {
    if (roomIdFromUrl) return [];
    try {
      const saved = JSON.parse(window.localStorage.getItem('farmcity_current_room') ?? 'null') as RoomSnapshot | null;
      if (!saved?.tiles?.length || !Array.isArray(saved.walls)) return [];
      const minX = Math.min(...saved.tiles.map((tile) => tile.x));
      const minY = Math.min(...saved.tiles.map((tile) => tile.y));
      return saved.walls.map((wall) => ({ ...wall, x: wall.x - minX, y: wall.y - minY }));
    } catch {
      return [];
    }
  });
  const [roomFloorTextureId, setRoomFloorTextureId] = useState<string | undefined>(() => {
    if (roomIdFromUrl) return undefined;
    try {
      const saved = JSON.parse(window.localStorage.getItem('farmcity_current_room') ?? 'null') as RoomSnapshot | null;
      return saved?.floorTextureId;
    } catch {
      return undefined;
    }
  });

  const wsRef = useRef<WebSocket | null>(null);
  const roomPasswordRef = useRef('');
  const chatInputRef = useRef<HTMLInputElement>(null);
  // Stable ref so handleSendChat doesn't need authPlayer as a dep
  const authPlayerRef = useRef(authPlayer);
  useEffect(() => { authPlayerRef.current = authPlayer; }, [authPlayer]);

  // Canvas action refs — mutated in place so the render loop reads them without re-renders
  const localActionRef = useRef<LocalAction>({ emote: null, anim: null });
  const canvasElemRef  = useRef<HTMLCanvasElement | null>(null);

  const { data: plazaStatus } = useGetPlazaStatus({
    query: { queryKey: getGetPlazaStatusQueryKey(), refetchInterval: 15000 },
  });
  const { data: savedRoom } = useGetMyRoom({
    query: {
      enabled: !!token,
      queryKey: getGetMyRoomQueryKey(),
      retry: false,
    },
  });
  const roomIdToJoin = roomIdFromUrl ?? savedRoom?.id ?? DEFAULT_PLAZA_ROOM_ID;

  useEffect(() => {
    // An explicit room URL is always authoritative. Its snapshot arrives
    // through WebSocket, so the latest personal-room query must not overwrite
    // it with stale data while React Query is revalidating.
    if (roomIdFromUrl || !savedRoom?.tiles?.length) return;
    const minX = Math.min(...savedRoom.tiles.map((tile) => tile.x));
    const minY = Math.min(...savedRoom.tiles.map((tile) => tile.y));
    setRoomTiles(savedRoom.tiles.map((tile) => ({ x: tile.x - minX, y: tile.y - minY })));
    setRoomWalls(
      savedRoom.walls.map((wall) => ({
        ...wall,
        x: wall.x - minX,
        y: wall.y - minY,
      })),
    );
    setRoomFloorTextureId(savedRoom.floorTextureId);
    try {
      window.localStorage.setItem('farmcity_current_room', JSON.stringify(savedRoom));
    } catch {
      // The server remains the source of truth when storage is unavailable.
    }
  }, [roomIdFromUrl, savedRoom]);

  // Redirect if not logged in
  useEffect(() => {
    if (!token) {
      setLocation('/');
    } else if (authPlayer && !authPlayer.avatar) {
      setLocation('/avatar');
    }
  }, [authPlayer, token, setLocation]);

  // WebSocket connection
  useEffect(() => {
    if (!token) {
      setConnectionState('connecting');
      remotePlayersRef.current = {};
      remoteActionsRef.current.clear();
      return;
    }

    let disposed = false;
    let reconnectTimer: number | undefined;
    let reconnectAttempt = 0;
    let activeSocket: WebSocket | null = null;

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== undefined) return;
      const delay = Math.min(1000 * 2 ** reconnectAttempt, 10000);
      reconnectAttempt += 1;
      setConnectionState('reconnecting');
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, delay);
    };

    const connect = () => {
      if (disposed) return;

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(wsUrl);
      activeSocket = ws;
      wsRef.current = ws;
      setConnectionState(reconnectAttempt === 0 ? 'connecting' : 'reconnecting');

      ws.onopen = () => {
        if (disposed || wsRef.current !== ws) return;
        reconnectAttempt = 0;
        setConnectionState('connected');
        setRoomError(null);
        setRoomRequiresPassword(false);
        // The server sends the latest persisted history after opening. Clear
        // the local list first so reconnects cannot duplicate old messages.
        setChatMessages([]);
        if (roomIdToJoin) {
          ws.send(JSON.stringify({
            type: 'room:join',
            data: { roomId: roomIdToJoin },
          }));
        }
      };

      ws.onclose = () => {
        if (wsRef.current !== ws) return;
        setConnectionState('reconnecting');
        remotePlayersRef.current = {};
        remoteActionsRef.current.clear();
        setRemotePlayers({});
        setChatMessages([]);
        scheduleReconnect();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as Record<string, unknown>;
          const type = msg.type as string;

          switch (type) {
            case 'players_update': {
              const players = Array.isArray(msg.players) ? msg.players as WsPlayer[] : [];
              const next: Record<number, WsPlayer> = {};
              for (const p of players) next[p.id] = p;
              remotePlayersRef.current = next;
              setRemotePlayers(next);
              break;
            }
            case 'room:state': {
              const snapshot = msg.data as RoomSnapshot | undefined;
              setRoomError(null);
              setRoomRequiresPassword(false);
              setRoomPassword('');
              roomPasswordRef.current = '';
              if (snapshot?.tiles?.length) {
                const minX = Math.min(...snapshot.tiles.map((tile) => tile.x));
                const minY = Math.min(...snapshot.tiles.map((tile) => tile.y));
                setRoomTiles(snapshot.tiles.map((tile) => ({
                  x: tile.x - minX,
                  y: tile.y - minY,
                })));
                setRoomWalls(
                  Array.isArray(snapshot.walls)
                    ? snapshot.walls.map((wall) => ({
                        ...wall,
                        x: wall.x - minX,
                        y: wall.y - minY,
                      }))
                    : [],
                );
                setRoomFloorTextureId(snapshot.floorTextureId);
              }
              if (Array.isArray(snapshot?.players)) {
                const next: Record<number, WsPlayer> = {};
                for (const player of snapshot.players) {
                  if (player.id !== authPlayerRef.current?.id) next[player.id] = player;
                }
                remotePlayersRef.current = next;
                setRemotePlayers(next);
                remoteActionsRef.current.clear();
                setPanel(null);
              }
              break;
            }
            case 'player:joined': {
              const data = msg.data as { player?: WsPlayer } | undefined;
              const p = data?.player;
              if (p?.id) {
                remotePlayersRef.current = { ...remotePlayersRef.current, [p.id]: p };
                setRemotePlayers((prev) => ({ ...prev, [p.id]: p }));
              }
              break;
            }
            case 'player:move': {
              const { playerId, posX, posY } = msg.data as {
                playerId: number;
                posX: number;
                posY: number;
              };
              const currentPlayer = remotePlayersRef.current[playerId];
              if (currentPlayer) {
                remotePlayersRef.current = {
                  ...remotePlayersRef.current,
                  [playerId]: { ...currentPlayer, posX, posY },
                };
              }
              // Also update panel if this player is being viewed
              setPanel((p) =>
                p?.kind === 'player' && p.player.id === playerId
                  ? { ...p, player: { ...p.player, posX, posY } }
                  : p,
              );
              break;
            }
            case 'player_action': {
              const { playerId, action, payload, duration } = msg as {
                type: string;
                playerId: number;
                action: string;
                payload?: string;
                duration?: number;
              };
              if (!Number.isInteger(playerId) || typeof action !== 'string') break;

              const now = performance.now();
              const actionDuration = typeof duration === 'number'
                ? Math.max(0, Math.min(60000, duration))
                : 0;
              const current = remoteActionsRef.current.get(playerId) ?? {
                anim: null,
                emote: null,
              };

              if (action === 'standup') {
                current.anim = null;
              } else if (
                action === 'dance' ||
                action === 'sit' ||
                action === 'dig' ||
                action === 'fish' ||
                action === 'axe' ||
                action === 'interact'
              ) {
                current.anim = { type: action, until: now + actionDuration };
              } else if (action === 'emote' && payload) {
                current.emote = { emoji: payload, until: now + actionDuration };
              }
              remoteActionsRef.current.set(playerId, current);
              break;
            }
            case 'chat_message': {
              const { id, username, message, createdAt, effect } = msg as {
                id?: number;
                type: string;
                username: string;
                message: string;
                createdAt: string;
                effect?: ChatEffect;
              };
              setChatMessages((prev) => {
                if (typeof id === 'number' && prev.some((entry) => entry.id === id)) return prev;
                return [...prev.slice(-49), { id, username, message, createdAt, effect }];
              });
              break;
            }
            case 'player:left': {
              const { playerId } = msg.data as { playerId: number };
              setRemotePlayers((prev) => {
                const next = { ...prev };
                delete next[playerId];
                return next;
              });
              const nextRemotePlayers = { ...remotePlayersRef.current };
              delete nextRemotePlayers[playerId];
              remotePlayersRef.current = nextRemotePlayers;
              remoteActionsRef.current.delete(playerId);
              setPanel((p) => (p?.kind === 'player' && p.player.id === playerId ? null : p));
              break;
            }
            case 'room:error': {
              const errorData = msg.data as { code?: string; message?: string } | undefined;
              const message = errorData?.message ?? 'No pudimos entrar a esta sala.';
              setRoomError(message);
              setRoomRequiresPassword(errorData?.code === 'INVALID_PASSWORD');
              setConnectionState('connected');
              remotePlayersRef.current = {};
              remoteActionsRef.current.clear();
              setRemotePlayers({});
              setPanel(null);
              console.warn(message);
              break;
            }
          }
        } catch {
          /* ignore parse errors */
        }
      };

      ws.onerror = () => {
        if (wsRef.current === ws) setConnectionState('reconnecting');
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      if (wsRef.current === activeSocket) wsRef.current = null;
      activeSocket?.close(1000, 'Cambio de plaza');
      setConnectionState('connecting');
    };
  }, [roomIdToJoin, token]);

  const handleMove = useCallback((posX: number, posY: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'player:move', data: { posX, posY } }));
    }
  }, []);

  const sendAction = useCallback((action: string, payload?: string, duration = 0) => {
    const socket = wsRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'action', action, payload, duration }));
    }
  }, []);

  const handlePlayerAction = useCallback((action: string, payload?: string) => {
    const now = performance.now();
    switch (action) {
      case 'change-costume':
        setLocation('/avatar');
        break;
      case 'dance':
        localActionRef.current = { ...localActionRef.current, anim: { type: 'dance', until: now + 8000 } };
        sendAction('dance', undefined, 8000);
        break;
      case 'dig':
        localActionRef.current = { ...localActionRef.current, anim: { type: 'dig', until: now + 8000 } };
        sendAction('dig', undefined, 8000);
        break;
      case 'fish':
        localActionRef.current = { ...localActionRef.current, anim: { type: 'fish', until: now + 10000 } };
        sendAction('fish', undefined, 10000);
        break;
      case 'axe':
        localActionRef.current = { ...localActionRef.current, anim: { type: 'axe', until: now + 8000 } };
        sendAction('axe', undefined, 8000);
        break;
      case 'sit':
        localActionRef.current = { ...localActionRef.current, anim: { type: 'sit', until: now + 60000 } };
        sendAction('sit', undefined, 60000);
        break;
      case 'standup':
        localActionRef.current = { ...localActionRef.current, anim: null };
        sendAction('standup');
        break;
      case 'emote':
        if (payload) {
          localActionRef.current = { ...localActionRef.current, emote: { emoji: payload, until: now + 3000 } };
          sendAction('emote', payload, 3000);
        }
        break;
      case 'photo':
        if (canvasElemRef.current) {
          try {
            const url = canvasElemRef.current.toDataURL('image/png');
            const a = document.createElement('a');
            a.href = url;
            a.download = `farmcity-${Date.now()}.png`;
            a.click();
          } catch {
            // cross-origin canvas restriction — silently ignore
          }
        }
        break;
      case 'settings':
        setPanel(null);
        setIsSettingsOpen(true);
        break;
      default:
        break;
    }
  }, [sendAction, setLocation]);

  const handleSendChat = useCallback(() => {
    const msg = chatInput.trim();
    const socket = wsRef.current;
    if (!msg || !authPlayerRef.current || socket?.readyState !== WebSocket.OPEN) return;

    // Show own message immediately (optimistic) — triggers the canvas bubble too
    setChatMessages((prev) => [
      ...prev.slice(-49),
      {
        username: authPlayerRef.current!.username,
        message: msg,
        createdAt: new Date().toISOString(),
        effect: selectedChatEffect,
      },
    ]);

    // Send to server; server will NOT echo back to sender to avoid duplicates
    socket.send(JSON.stringify({ type: 'chat', message: msg, effect: selectedChatEffect }));

    setChatInput('');
    chatInputRef.current?.blur();
  }, [chatInput, selectedChatEffect]);

  if (!authPlayer || !authPlayer.avatar) return null;

  // Shape remote players for the canvas
  const canvasPlayers = remotePlayers as unknown as Record<
    number,
    PlayerSummary & { posX: number; posY: number }
  >;
  const roomOnlineCount = connectionState === 'connected'
    ? Object.keys(remotePlayers).length + 1
    : plazaStatus?.onlineCount;
  const selectedEffectOption =
    CHAT_EFFECT_OPTIONS.find(({ id }) => id === selectedChatEffect) ?? CHAT_EFFECT_OPTIONS[0];

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: '#2A5022' }}>
      {/* Full-screen canvas */}
      <div
        className="absolute inset-0"
        onPointerDownCapture={() => chatInputRef.current?.blur()}
      >
        <IsometricCanvas
          localPlayerId={authPlayer.id}
          localAvatar={authPlayer.avatar as Avatar | undefined}
          localUsername={authPlayer.username}
          players={canvasPlayers}
          playersRef={remotePlayersRef}
          remoteActionsRef={remoteActionsRef}
          messages={chatMessages}
          localActionRef={localActionRef}
          onAction={handlePlayerAction}
          onMove={handleMove}
          onClickSelf={() => setPanel({ kind: 'self' })}
          onClickPlayer={(p) => setPanel({ kind: 'player', player: p as WsPlayer })}
          onClickObject={(type) => setPanel({ kind: 'object', objectType: type as WorldObjectType })}
          onCanvasMount={(el) => { canvasElemRef.current = el; }}
          roomTiles={roomTiles}
          roomWalls={roomWalls}
          roomFloorTextureId={roomFloorTextureId}
        />
      </div>

      {/* Top HUD */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-3 py-2 pointer-events-none">
        <div className="flex items-center gap-2">
          <span
            className="font-['VT323'] text-2xl text-yellow-300"
            style={{ textShadow: '2px 2px 0 #1A3A12' }}
          >
            🌾 FarmCity
          </span>
          <span
            className="font-['VT323'] text-xs px-2 py-0.5"
            style={{
               background: connectionState === 'connected' ? 'rgba(46,204,113,0.85)' : 'rgba(231,76,60,0.85)',
              color: '#fff',
              border: '1px solid rgba(0,0,0,0.3)',
            }}
          >
             {connectionState === 'connected'
               ? `● ${t('online')}`
               : connectionState === 'connecting'
                 ? `● ${t('connecting')}`
                 : `● ${t('reconnecting')}`}
          </span>
        </div>

        <div className="flex items-center gap-2 pointer-events-auto">
          {roomOnlineCount !== undefined && (
            <span
              className="font-['VT323'] text-sm text-green-200"
              style={{ textShadow: '1px 1px 0 #1A3A12' }}
              aria-label={`${roomOnlineCount} jugadores en esta sala`}
            >
              👥 {roomOnlineCount}
            </span>
          )}
          <button
            className="font-['VT323'] text-sm px-2 py-1 transition-colors hover:opacity-80"
            style={{
              background: 'rgba(61,32,16,0.85)',
              color: '#FFF8E7',
              border: '2px solid #7A4F1E',
            }}
            onClick={() => {
              logout();
              setLocation('/');
            }}
          >
             {t('logout')}
          </button>
        </div>
      </div>

      {/* Bottom HUD */}
      <div className="absolute bottom-0 left-0 right-0 pointer-events-none">

        {/* Chat input row */}
        <div
          className="flex items-center gap-0 pointer-events-auto"
          style={{ background: 'rgba(18,18,18,0.95)', borderTop: '3px solid #3D2010' }}
        >
          {/* Chat effect picker */}
          <div
            className="relative flex items-center px-2 flex-shrink-0"
            role="group"
            aria-label="Efecto del mensaje"
          >
            <button
              type="button"
              title="Elegir efecto"
              aria-label={`Efecto del mensaje: ${selectedEffectOption.label}`}
              aria-haspopup="true"
              aria-expanded={isChatEffectPickerOpen}
              onClick={() => setIsChatEffectPickerOpen((open) => !open)}
              className="flex items-center justify-center transition-all hover:scale-110 active:scale-95"
              style={{
                width: 36,
                height: 36,
                border: isChatEffectPickerOpen ? '2px solid #F6C453' : '1px solid rgba(255,255,255,0.18)',
                background: isChatEffectPickerOpen ? 'rgba(122,79,30,0.9)' : 'rgba(255,255,255,0.06)',
                boxShadow: isChatEffectPickerOpen ? '0 0 0 1px rgba(246,196,83,0.2)' : 'none',
                fontSize: 20,
                lineHeight: 1,
              }}
            >
              {selectedEffectOption.icon}
            </button>

            {isChatEffectPickerOpen && (
              <div
                className="absolute bottom-full left-1 mb-2 flex gap-1 p-2"
                role="menu"
                aria-label="Efectos disponibles"
                style={{
                  background: 'rgba(18,18,18,0.98)',
                  border: '2px solid #7A4F1E',
                  boxShadow: '0 4px 0 rgba(0,0,0,0.35)',
                  zIndex: 20,
                }}
              >
                {CHAT_EFFECT_OPTIONS.map(({ id, icon, label }) => (
                <button
                  key={id}
                  type="button"
                  title={label}
                  aria-label={`Efecto: ${label}`}
                  aria-pressed={selectedChatEffect === id}
                  role="menuitem"
                  onClick={() => {
                    setSelectedChatEffect(id);
                    setIsChatEffectPickerOpen(false);
                  }}
                  className="flex items-center justify-center transition-all hover:scale-110 active:scale-95"
                  style={{
                    width: 32,
                    height: 32,
                    border: selectedChatEffect === id ? '2px solid #F6C453' : '1px solid rgba(255,255,255,0.18)',
                    background: selectedChatEffect === id ? 'rgba(122,79,30,0.9)' : 'rgba(255,255,255,0.06)',
                    boxShadow: selectedChatEffect === id ? '0 0 0 1px rgba(246,196,83,0.2)' : 'none',
                    fontSize: 18,
                    lineHeight: 1,
                  }}
                >
                  {icon}
                </button>
                ))}
              </div>
            )}
          </div>

          {/* Text input */}
          <div className="flex items-center flex-1 px-3 py-2 gap-2">
            <input
              ref={chatInputRef}
              className="flex-1 bg-transparent font-['VT323'] text-base focus:outline-none"
              style={{ color: '#fff' }}
               placeholder={t('chatPlaceholder')}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && connectionState === 'connected') {
                  e.preventDefault();
                  handleSendChat();
                }
              }}
              maxLength={200}
            />
          </div>

          {/* Send */}
          <button
            onClick={handleSendChat}
            disabled={connectionState !== 'connected' || !chatInput.trim()}
            className="flex items-center justify-center flex-shrink-0 transition-opacity hover:opacity-80 active:scale-95"
            style={{
              width: 48, height: 48,
              background: '#2ECC71',
              border: 'none',
              borderLeft: '2px solid rgba(0,0,0,0.3)',
              color: '#fff',
              fontSize: 20,
            }}
          >
            ▶
          </button>
        </div>

        {/* Action toolbar */}
        <div
          className="flex items-center justify-around pointer-events-auto"
          style={{
            background: 'rgba(15,15,15,0.95)',
            borderTop: '2px solid #3D2010',
            paddingBottom: 'env(safe-area-inset-bottom, 4px)',
          }}
        >
          {[
             { icon: HomeIcon, label: t('myHouse'), badge: null, action: () => setLocation('/room-editor') },
             { emoji: '🚪', label: t('rooms'), badge: null, action: () => setLocation('/rooms') },
             { emoji: '🎒', label: t('inventory'), badge: null },
             { emoji: '📬', label: t('requests'), badge: 0 },
             { emoji: '⚙️', label: t('settingsShort'), badge: null, action: () => setIsSettingsOpen(true) },
          ].map(({ emoji, icon: ActionIcon, label, badge, action }) => (
            <button
              key={label}
              onClick={action}
              className="flex flex-col items-center justify-center py-2 px-4 gap-0.5 transition-opacity hover:opacity-70 active:scale-95 relative"
              style={{ background: 'transparent', border: 'none', minWidth: 64 }}
            >
              <span className="text-2xl leading-none relative">
                {ActionIcon ? <ActionIcon size={24} strokeWidth={1.8} /> : emoji}
                {badge !== null && badge > 0 && (
                  <span
                    className="absolute -top-1 -right-2 font-['VT323'] text-xs px-1 leading-none"
                    style={{ background: '#E74C3C', color: '#fff', borderRadius: 2 }}
                  >
                    {badge}
                  </span>
                )}
              </span>
              <span className="font-['VT323'] text-xs" style={{ color: '#ccc' }}>
                {label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {(roomError || roomRequiresPassword) && (
        <div
          className="absolute left-1/2 top-16 z-20 w-[min(92vw,28rem)] -translate-x-1/2 px-4 py-3 text-center"
          style={{
            background: 'rgba(61,32,16,0.95)',
            color: '#FFF8E7',
            border: '2px solid #F6C453',
            boxShadow: '0 4px 0 rgba(0,0,0,0.3)',
          }}
          role="alert"
        >
          <p className="font-['VT323'] text-xl">
            {roomRequiresPassword ? 'Sala protegida' : 'No pudimos entrar a esta sala'}
          </p>
          <p className="mt-1 font-['VT323'] text-base opacity-85">
            {roomError ?? 'Escribe la contraseña para entrar.'}
          </p>
          {roomRequiresPassword ? (
            <form
              className="mt-3 flex justify-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const password = roomPassword.trim();
                if (!password || wsRef.current?.readyState !== WebSocket.OPEN) return;
                roomPasswordRef.current = password;
                wsRef.current.send(JSON.stringify({
                  type: 'room:join',
                  data: { roomId: roomIdToJoin, password },
                }));
                setRoomError('Comprobando la contraseña…');
              }}
            >
              <input
                type="password"
                value={roomPassword}
                maxLength={100}
                autoFocus
                onChange={(event) => setRoomPassword(event.target.value)}
                placeholder="Contraseña"
                className="min-w-0 flex-1 px-2 py-1 font-['VT323'] text-base"
                aria-label="Contraseña de la sala"
              />
              <button
                type="submit"
                className="px-3 py-1 font-['VT323'] text-base"
                style={{ background: '#2A5022', border: '2px solid #8DBF5A' }}
                disabled={!roomPassword.trim()}
              >
                Entrar
              </button>
            </form>
          ) : (
            <div className="mt-3 flex justify-center gap-2">
              <button
                type="button"
                className="px-3 py-1 font-['VT323'] text-base"
                style={{ background: '#B86B2D', border: '2px solid #F6C453' }}
                onClick={() => setLocation('/rooms')}
              >
                Ver salas
              </button>
              <button
                type="button"
                className="px-3 py-1 font-['VT323'] text-base"
                style={{ background: '#2A5022', border: '2px solid #8DBF5A' }}
                onClick={() => {
                  setRoomError(null);
                  setLocation('/plaza');
                }}
              >
                Ir a la plaza
              </button>
            </div>
          )}
        </div>
      )}

      {/* Panels */}
      {panel?.kind === 'self' && authPlayer.avatar && (
        <OwnAvatarPanel
          username={authPlayer.username}
          nickname={authPlayer.nickname}
          status={authPlayer.status}
          age={authPlayer.age}
          avatar={authPlayer.avatar as Avatar}
          onClose={() => setPanel(null)}
          onAction={handlePlayerAction}
        />
      )}
      {panel?.kind === 'player' && (
        <OtherPlayerPanel
          player={panel.player as unknown as PlayerSummary}
          onClose={() => setPanel(null)}
        />
      )}
      {panel?.kind === 'object' && (
        <WorldObjectPanel
          objectType={panel.objectType}
          onClose={() => setPanel(null)}
        />
      )}
      {isSettingsOpen && (
        <SettingsPanel
          player={authPlayer}
          onClose={() => setIsSettingsOpen(false)}
          onSaved={(updatedPlayer, nextToken) => {
            login(nextToken, updatedPlayer);
          }}
        />
      )}
    </div>
  );
}
