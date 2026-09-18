import { useState } from 'react';
import { useUpdateProfile } from '@workspace/api-client-react';
import type { ErrorType } from '@workspace/api-client-react';
import type { PlayerData } from '@/contexts/auth-context';
import { useLanguage } from '@/contexts/language-context';
import { PanelBackdrop } from './panel-backdrop';

interface SettingsPanelProps {
  player: PlayerData;
  onClose: () => void;
  onSaved: (player: PlayerData, token: string) => void;
}

function getErrorMessage(error: unknown): string {
  const requestError = error as ErrorType<{ error?: string }>;
  return requestError.data?.error ?? requestError.message ?? 'No se pudieron guardar los cambios';
}

const fieldStyle = {
  width: '100%',
  border: '2px solid #9A6A35',
  background: '#FFFDF5',
  color: '#3D2010',
  padding: '8px 10px',
  fontFamily: 'VT323, monospace',
  fontSize: 18,
  outline: 'none',
};

export function SettingsPanel({ player, onClose, onSaved }: SettingsPanelProps) {
  const { t, lang, setLanguage } = useLanguage();
  const [username, setUsername] = useState(player.username);
  const [age, setAge] = useState(player.age ? String(player.age) : '');
  const [nickname, setNickname] = useState(player.nickname ?? '');
  const [status, setStatus] = useState(player.status ?? '');
  const [language, setFormLanguage] = useState<'es' | 'en'>(player.language ?? lang);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const updateProfile = useUpdateProfile({
    mutation: {
      onSuccess: (data) => {
        const updatedPlayer = data.player as unknown as PlayerData;
        setLanguage(updatedPlayer.language);
        onSaved(updatedPlayer, data.token);
        setSaved(true);
        setError('');
      },
      onError: (requestError) => {
        setSaved(false);
        setError(getErrorMessage(requestError));
      },
    },
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    const trimmedUsername = username.trim();
    const parsedAge = age.trim() ? Number(age) : null;

    if (trimmedUsername.length < 3 || trimmedUsername.length > 20) {
      setError('El nombre debe tener entre 3 y 20 caracteres');
      return;
    }
    if (parsedAge !== null && (!Number.isInteger(parsedAge) || parsedAge < 1 || parsedAge > 120)) {
      setError('La edad debe estar entre 1 y 120 años');
      return;
    }

    updateProfile.mutate({
      data: {
        username: trimmedUsername,
        age: parsedAge,
        nickname: nickname.trim() || null,
        status: status.trim() || null,
        language: language === 'en' ? 'en' : 'es',
      },
    });
  };

  return (
    <PanelBackdrop onClose={onClose}>
      <section
        className="w-full max-w-[380px] max-h-[calc(100vh-2rem)] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="farmcity-settings-title"
        style={{
          border: '4px solid #3D2010',
          background: '#FFF8E7',
          boxShadow: '0 6px 0 rgba(0,0,0,0.3)',
        }}
      >
        <header
          className="flex items-center justify-between px-4 py-3"
          style={{ background: '#7A4F1E', borderBottom: '3px solid #3D2010' }}
        >
          <div>
            <p className="font-['VT323'] text-xs tracking-[0.2em]" style={{ color: '#F6C453' }}>
              FARMCITY
            </p>
            <h2 id="farmcity-settings-title" className="font-['VT323'] text-2xl text-white">
              {t('settings')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="font-['VT323'] text-2xl leading-none text-white hover:text-yellow-300"
          >
            ×
          </button>
        </header>

        <form onSubmit={handleSubmit} className="space-y-3 p-4">
          <div
            className="px-3 py-2 font-['VT323'] text-lg"
            style={{ background: '#F3E1B5', border: '2px solid #D4A96A', color: '#5C3810' }}
          >
            {t('profile')}
          </div>

          <label className="block">
            <span className="mb-1 block font-['VT323'] text-base" style={{ color: '#7A4F1E' }}>
              {t('playerName')}
            </span>
            <input
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              maxLength={20}
              placeholder={t('namePlaceholder')}
              style={fieldStyle}
              data-testid="input-settings-username"
            />
            <small className="mt-1 block font-['VT323'] text-sm" style={{ color: '#8E7355' }}>
              {t('playerNameHint')}
            </small>
          </label>

          <div className="grid grid-cols-[1fr_1.6fr] gap-3">
            <label className="block">
              <span className="mb-1 block font-['VT323'] text-base" style={{ color: '#7A4F1E' }}>
                {t('age')}
              </span>
              <input
                type="number"
                min={1}
                max={120}
                value={age}
                onChange={(event) => setAge(event.target.value)}
                placeholder={t('agePlaceholder')}
                style={fieldStyle}
                data-testid="input-settings-age"
              />
            </label>

            <label className="block">
              <span className="mb-1 block font-['VT323'] text-base" style={{ color: '#7A4F1E' }}>
                {t('nickname')}
              </span>
              <input
                type="text"
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                maxLength={24}
                placeholder={t('nicknamePlaceholder')}
                style={fieldStyle}
                data-testid="input-settings-nickname"
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block font-['VT323'] text-base" style={{ color: '#7A4F1E' }}>
              {t('status')}
            </span>
            <textarea
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              maxLength={120}
              rows={3}
              placeholder={t('statusPlaceholder')}
              style={{ ...fieldStyle, resize: 'vertical' }}
              data-testid="input-settings-status"
            />
          </label>

          <label className="block">
            <span className="mb-1 block font-['VT323'] text-base" style={{ color: '#7A4F1E' }}>
              {t('language')}
            </span>
            <select
              value={language}
              onChange={(event) => setFormLanguage(event.target.value === 'en' ? 'en' : 'es')}
              style={fieldStyle}
              data-testid="select-settings-language"
            >
              <option value="es">{t('spanish')}</option>
              <option value="en">{t('english')}</option>
            </select>
            <small className="mt-1 block font-['VT323'] text-sm" style={{ color: '#8E7355' }}>
              {t('languageHint')}
            </small>
          </label>

          {error && (
            <div
              role="alert"
              className="font-['VT323'] text-base"
              style={{ color: '#A52F26', background: '#FDE4E1', border: '2px solid #D66A5E', padding: '7px 9px' }}
            >
              {error}
            </div>
          )}
          {saved && (
            <div
              role="status"
              className="font-['VT323'] text-base"
              style={{ color: '#276A32', background: '#E7F4E5', border: '2px solid #81B87D', padding: '7px 9px' }}
            >
              {t('saved')}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-3 py-2 font-['VT323'] text-lg"
              style={{ background: '#E9D6A7', border: '2px solid #9A6A35', color: '#5C3810' }}
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={updateProfile.isPending}
              className="flex-1 px-3 py-2 font-['VT323'] text-lg"
              style={{ background: '#2A5022', border: '2px solid #8DBF5A', color: '#FFF8E7' }}
              data-testid="button-settings-save"
            >
              {updateProfile.isPending ? t('saving') : t('save')}
            </button>
          </div>
        </form>
      </section>
    </PanelBackdrop>
  );
}