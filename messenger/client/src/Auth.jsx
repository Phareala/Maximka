import React, { useState } from 'react';
import { LogIn, UserPlus, Sparkles } from 'lucide-react';

const API_URL = import.meta.env.PROD ? '' : 'http://localhost:3001';

export default function Auth({ onLogin }) {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';

    try {
      const res = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password })
      });

      // Сначала проверяем статус, а потом пытаемся читать JSON
      if (!res.ok) {
        // Если сервер прислал ошибку, пробуем прочитать тело,
        // но если там пусто (405 ошибка), выводим статус
        const errorData = await res.json().catch(() => ({ error: `Server error: ${res.status}` }));
        throw new Error(errorData.error || 'Authentication failed');
      }

      const data = await res.json();

      localStorage.setItem('maximka_token', data.token);
      onLogin(data.user, data.token);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px', color: 'var(--primary)' }}>
          <Sparkles size={48} />
        </div>
        <h1>Maximka</h1>
        <p>{isLogin ? 'Sign in to your account' : 'Create a new account'}</p>
        
        {error && <div style={{ color: '#ef4444', marginBottom: '16px', fontSize: '0.9rem' }}>{error}</div>}
        
        <form className="input-group" onSubmit={handleSubmit}>
          <input
            type="text"
            className="input-field"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            maxLength={20}
          />
          <input
            type="password"
            className="input-field"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={4}
          />
          <button type="submit" className="btn-primary" disabled={!username || !password}>
            {isLogin ? (
              <><LogIn size={18} /> Sign In</>
            ) : (
              <><UserPlus size={18} /> Sign Up</>
            )}
          </button>
        </form>
        
        <div style={{ marginTop: '24px', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
          {isLogin ? "Don't have an account? " : "Already have an account? "}
          <span 
            style={{ color: 'var(--primary)', cursor: 'pointer', fontWeight: 500 }}
            onClick={() => setIsLogin(!isLogin)}
          >
            {isLogin ? 'Register here' : 'Login here'}
          </span>
        </div>
      </div>
    </div>
  );
}
