import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, DoorOpen, Edit3, LockKeyhole, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useLocation } from 'wouter';
import {
  getGetMyRoomsQueryKey,
  getGetMyRoomQueryKey,
  getGetPublicRoomsQueryKey,
  useCreateRoom,
  useDeleteMyRoom,
  useGetMyRooms,
  useGetPublicRooms,
} from '@workspace/api-client-react';
import { useAuth } from '@/contexts/auth-context';
import { useLanguage } from '@/contexts/language-context';

const DEFAULT_NEW_ROOM = {
  name: 'Mi rincón',
  tiles: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ],
  walls: [],
  floorTextureId: 'floor-wood',
  wallTextureId: 'wall-plaster',
  isPublic: true,
};

function formatRoomDate(value: string, lang: 'es' | 'en'): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return lang === 'en' ? 'Room available' : 'Sala disponible';

  return new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'es-CO', {
    day: 'numeric',
    month: 'short',
  }).format(date);
}

export default function Rooms() {
  const { token, player } = useAuth();
  const { t, lang } = useLanguage();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const myRoomsQuery = useGetMyRooms({
    query: {
      enabled: !!token,
      queryKey: getGetMyRoomsQueryKey(),
      retry: false,
    },
  });
  const roomsQuery = useGetPublicRooms({
    query: {
      enabled: !!token,
      queryKey: getGetPublicRoomsQueryKey(),
      refetchInterval: 10000,
      retry: false,
    },
  });
  const createRoomMutation = useCreateRoom({
    mutation: {
      onSuccess: async (room) => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getGetMyRoomsQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getGetMyRoomQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getGetPublicRoomsQueryKey() }),
        ]);
        setLocation(`/room-editor?room=${encodeURIComponent(room.id)}`);
      },
    },
  });
  const deleteRoomMutation = useDeleteMyRoom({
    mutation: {
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getGetMyRoomsQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getGetMyRoomQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getGetPublicRoomsQueryKey() }),
        ]);
      },
    },
  });

  useEffect(() => {
    if (!token) setLocation('/');
  }, [token, setLocation]);

  if (!token) return null;

  function handleDelete(roomId: string, roomName: string) {
    if (deleteRoomMutation.isPending) return;
    const confirmed = window.confirm(
      `¿Eliminar "${roomName}"? Esta acción no se puede deshacer.`,
    );
    if (confirmed) {
      deleteRoomMutation.mutate({ roomId });
    }
  }

  function handleCreateNewRoom() {
    if (createRoomMutation.isPending) return;
    createRoomMutation.mutate({ data: DEFAULT_NEW_ROOM });
  }

  const publicRooms = roomsQuery.data?.filter((room) => room.ownerId !== player?.id) ?? [];

  return (
    <main className="room-list-page">
      <section className="room-list-window" aria-labelledby="room-list-title">
        <header className="room-list-topbar">
          <button
            type="button"
            className="room-list-back"
            onClick={() => setLocation('/plaza')}
             aria-label={t('backToPlaza')}
          >
            <ArrowLeft size={18} />
          </button>
          <div className="room-list-brand">
            <div className="room-list-brand-mark" aria-hidden="true">
              <DoorOpen size={22} />
            </div>
            <div>
               <small>FarmCity / {t('communityRooms')}</small>
               <strong>{t('rooms')}</strong>
            </div>
          </div>
          <button
            type="button"
            className="room-list-refresh"
            onClick={() => void roomsQuery.refetch()}
            disabled={roomsQuery.isFetching}
             aria-label={t('refreshRooms')}
             title={t('refreshRooms')}
          >
            <RefreshCw size={17} className={roomsQuery.isFetching ? 'room-list-spinning' : ''} />
          </button>
        </header>

        <div className="room-list-content">
          <div className="room-list-heading">
             <span className="room-list-kicker">{t('exploreCorners')}</span>
             <h1 id="room-list-title">{t('communityRooms')}</h1>
             <p>{t('communityDescription')}</p>
            <button
              type="button"
              className="room-list-create"
              onClick={handleCreateNewRoom}
              disabled={createRoomMutation.isPending || (myRoomsQuery.data?.length ?? 0) >= 10}
              data-testid="button-create-new-room"
            >
               <Plus size={16} /> {createRoomMutation.isPending ? `${t('createNewRoom')}…` : t('createNewRoom')}
            </button>
            {createRoomMutation.isError && (
              <p className="room-list-inline-error" role="alert">
                No se pudo crear la sala. {createRoomMutation.error instanceof Error
                  ? createRoomMutation.error.message
                  : 'Inténtalo nuevamente.'}
              </p>
            )}
          </div>

          <section className="room-list-section" aria-labelledby="my-rooms-title">
            <div className="room-list-section-heading">
              <div>
                 <span className="room-list-kicker">{lang === 'en' ? 'Your collection' : 'Tu colección'}</span>
                 <h2 id="my-rooms-title">{t('myRooms')}</h2>
              </div>
              <span className="room-list-count">
                {myRoomsQuery.data?.length ?? 0}/10
              </span>
            </div>

            {myRoomsQuery.isLoading && (
              <div className="room-list-state" role="status">
                <span className="room-list-loader" aria-hidden="true" />
               {t('loadingRooms')}
              </div>
            )}

            {myRoomsQuery.isError && (
              <div className="room-list-state room-list-state-error" role="alert">
                No se pudieron cargar tus salas. Intenta actualizar nuevamente.
              </div>
            )}

            {!myRoomsQuery.isLoading && !myRoomsQuery.isError && myRoomsQuery.data?.length === 0 && (
              <div className="room-list-state room-list-empty">
                <span aria-hidden="true">🏡</span>
                 <strong>{t('noRooms')}</strong>
                 <span>{t('noRoomsHint')}</span>
              </div>
            )}

            {!!myRoomsQuery.data?.length && (
              <div className="room-list-owned-grid" aria-label="Mis salas">
                {myRoomsQuery.data.map((room) => (
                  <article key={room.id} className="room-list-owned-card">
                    <button
                      type="button"
                      className="room-list-owned-room-link"
                      onClick={() => setLocation(`/plaza?room=${encodeURIComponent(room.id)}`)}
                      data-testid={`button-enter-my-room-${room.id}`}
                    >
                      <span className="room-list-card-icon" aria-hidden="true">🏡</span>
                      <div className="room-list-card-copy">
                        <strong>{room.name}</strong>
                        <span className="room-list-owner">
                           {room.isPublic ? t('public') : t('private')} · {t('createdOn')} {formatRoomDate(room.createdAt, lang)}
                        </span>
                        <span className="room-list-id">
                          ID: <code>{room.id}</code>
                        </span>
                      </div>
                    </button>
                    <div className="room-list-owned-actions">
                      <button
                        type="button"
                        className="room-list-edit"
                        onClick={() => setLocation(`/room-editor?room=${encodeURIComponent(room.id)}`)}
                        data-testid={`button-edit-room-${room.id}`}
                      >
                         <Edit3 size={14} /> {t('edit')}
                      </button>
                      <button
                        type="button"
                        className="room-list-delete"
                        onClick={() => handleDelete(room.id, room.name)}
                        disabled={deleteRoomMutation.isPending}
                        data-testid={`button-delete-room-${room.id}`}
                      >
                         <Trash2 size={14} /> {t('delete')}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="room-list-section" aria-labelledby="public-rooms-title">
            <div className="room-list-section-heading">
              <div>
                 <span className="room-list-kicker">{t('exploreCorners')}</span>
                 <h2 id="public-rooms-title">{t('communityRooms')}</h2>
              </div>
              <span className="room-list-count">{publicRooms.length}</span>
            </div>

          {roomsQuery.isLoading && (
            <div className="room-list-state" role="status">
              <span className="room-list-loader" aria-hidden="true" />
               {t('loadingPublicRooms')}
            </div>
          )}

          {roomsQuery.isError && (
            <div className="room-list-state room-list-state-error" role="alert">
              No se pudieron cargar las salas. Intenta actualizar nuevamente.
            </div>
          )}

          {!roomsQuery.isLoading && !roomsQuery.isError && publicRooms.length === 0 && (
            <div className="room-list-state room-list-empty">
              <span aria-hidden="true">🌱</span>
               <strong>{t('noPublicRooms')}</strong>
               <span>{t('noPublicRoomsHint')}</span>
            </div>
          )}

          {!!publicRooms.length && (
            <div className="room-list-grid" aria-label="Salas públicas">
              {publicRooms.map((room) => (
                <button
                  key={room.id}
                  type="button"
                  className="room-list-card"
                  onClick={() => setLocation(`/plaza?room=${encodeURIComponent(room.id)}`)}
                  data-testid={`button-join-room-${room.id}`}
                >
                  <span className="room-list-card-icon" aria-hidden="true">🏡</span>
                  <span className="room-list-card-copy">
                    <strong>{room.name}</strong>
                    <span className="room-list-owner">Casa de {room.ownerUsername}</span>
                    <span className="room-list-id">
                      ID: <code>{room.id}</code>
                    </span>
                  </span>
                  <span className="room-list-card-meta">
                     <span>{formatRoomDate(room.createdAt, lang)}</span>
                    {room.hasPassword && (
                      <span title="Esta sala tiene una contraseña">
                        <LockKeyhole size={13} aria-label="Sala con contraseña" />
                      </span>
                    )}
                    <ArrowRight size={18} aria-hidden="true" />
                  </span>
                </button>
              ))}
            </div>
          )}
          </section>

          <footer className="room-list-footer">
             <span>{t('privateRoomsNote')}</span>
            <button type="button" onClick={() => setLocation('/plaza')}>
               <ArrowLeft size={14} /> {t('backToPlaza')}
            </button>
          </footer>
        </div>
      </section>
    </main>
  );
}