import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/auth-context';
import { useLanguage } from '@/contexts/language-context';
import type { PlayerData } from '@/contexts/auth-context';
import { useLogin, useRegister } from '@workspace/api-client-react';
import type { ErrorType } from '@workspace/api-client-react';

function getRequestError(error: unknown, fallback: string): string {
  const requestError = error as ErrorType<{ error?: string }>;
  const message = requestError.data?.error ?? requestError.message;
  if (!message || message === 'Failed to fetch' || message === 'NetworkError') {
    return 'No pudimos conectar con FarmCity. Revisa tu conexión e inténtalo de nuevo.';
  }
  return message || fallback;
}

export default function Home() {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login, player } = useAuth();
  const { t, lang } = useLanguage();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (player?.avatar) {
      setLocation('/plaza');
    } else if (player) {
      setLocation('/avatar');
    }
  }, [player, setLocation]);

  const loginMutation = useLogin({
    mutation: {
      onSuccess: (data) => {
        login(data.token, data.player as unknown as PlayerData);
        if (data.player.avatar) {
          setLocation('/plaza');
        } else {
          setLocation('/avatar');
        }
      },
      onError: (err) => {
        setError(getRequestError(err, 'Error al iniciar sesión'));
      },
    },
  });

  const registerMutation = useRegister({
    mutation: {
      onSuccess: (data) => {
        login(data.token, data.player as unknown as PlayerData);
        setLocation('/avatar');
      },
      onError: (err) => {
        setError(getRequestError(err, 'Error al registrarse'));
      },
    },
  });

  const isPending = loginMutation.isPending || registerMutation.isPending;

  if (player) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const normalizedUsername = username.trim();
    if (!normalizedUsername) {
      setError('Escribe tu nombre de jugador');
      return;
    }
    if (normalizedUsername.length < 3 || normalizedUsername.length > 20) {
      setError('El nombre debe tener entre 3 y 20 caracteres');
      return;
    }
    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres');
      return;
    }
    if (isRegister) {
      registerMutation.mutate({ data: { username: normalizedUsername, password } });
    } else {
      loginMutation.mutate({ data: { username: normalizedUsername, password } });
    }
  };

  return (
    <main className="farmcity-login-scene">
      <div className="farmcity-login-vignette" aria-hidden="true" />

      <section
        className="farmcity-login-shell"
        aria-labelledby="farmcity-login-title"
      >
        <img
          className="farmcity-login-frame"
          src="/assets/farmcity-login-frame.png"
          alt=""
          aria-hidden="true"
        />

        <div className="farmcity-login-content">
          <h1 id="farmcity-login-title" className="sr-only">
              {isRegister ? `${t('createAccount')} en FarmCity` : `${t('login')} a FarmCity`}
          </h1>

          <div
            className="farmcity-login-mode"
            role="tablist"
            aria-label="Modo de acceso"
          >
            <button
              type="button"
              role="tab"
              aria-selected={!isRegister}
              className={!isRegister ? 'is-active' : ''}
              onClick={() => {
                setIsRegister(false);
                setError('');
              }}
            >
              {t('login')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isRegister}
              className={isRegister ? 'is-active' : ''}
              onClick={() => {
                setIsRegister(true);
                setError('');
              }}
            >
              {t('createAccount')}
            </button>
          </div>

          <p className="farmcity-login-kicker">
            {isRegister
               ? t('createKicker')
               : t('waitingKicker')}
          </p>

          <form onSubmit={handleSubmit} className="farmcity-login-form">
            <div className="farmcity-login-field">
              <label htmlFor="farmcity-username">{t('playerName')}</label>
              <input
                id="farmcity-username"
                type="text"
                value={username}
                 onChange={(e) => {
                   setUsername(e.target.value);
                   if (error) setError('');
                 }}
                required
                minLength={3}
                maxLength={20}
                autoComplete="username"
                 placeholder={t('namePlaceholder')}
              />
            </div>

            <div className="farmcity-login-field">
              <label htmlFor="farmcity-password">{lang === 'en' ? 'Password' : 'Contraseña'}</label>
              <input
                id="farmcity-password"
                type="password"
                value={password}
                 onChange={(e) => {
                   setPassword(e.target.value);
                   if (error) setError('');
                 }}
                required
                minLength={6}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                 placeholder={lang === 'en' ? 'At least 6 characters' : 'Mínimo 6 caracteres'}
              />
            </div>

            {error && (
              <div className="farmcity-login-error" role="alert">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isPending}
               aria-busy={isPending}
              className="farmcity-login-submit"
            >
              {isPending
                ? 'Cargando…'
                : isRegister
                 ? t('createAccount')
                 : t('login')}
            </button>
          </form>

          <button
            type="button"
            className="farmcity-login-switch"
            onClick={() => {
              setIsRegister((current) => !current);
              setError('');
            }}
          >
            {isRegister
               ? (lang === 'en' ? 'Already have an account? Log in' : '¿Ya tienes una cuenta? Entrar')
               : (lang === 'en' ? 'Need an account? Sign up' : '¿No tienes cuenta? Regístrate')}
          </button>

          <p className="farmcity-login-note">
            Mundo multijugador en tiempo real
          </p>
        </div>
      </section>
    </main>
  );
}
