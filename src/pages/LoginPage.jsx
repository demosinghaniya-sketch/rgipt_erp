import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { GraduationCap, Eye, EyeOff, LogIn, Loader2, Shield, Download } from 'lucide-react';
import { loginToErp, isLoggedIn } from '../services/api';

export default function LoginPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', password: '' });
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // If already logged in, go to dashboard
  useEffect(() => {
    if (isLoggedIn()) navigate('/dashboard', { replace: true });
  }, [navigate]);

  const handleChange = e => {
    setForm(p => ({ ...p, [e.target.name]: e.target.value }));
    setError('');
  };

  const handleSubmit = async e => {
    e.preventDefault();
    if (!form.username || !form.password) {
      setError('Please enter both username and password.');
      return;
    }
    setLoading(true);
    try {
      await loginToErp(form.username, form.password);
      navigate('/dashboard');
    } catch (err) {
      setError(err.message || 'Login failed. Check your credentials and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      {/* Animated background orbs */}
      <div className="login-bg-orb login-bg-orb--1" />
      <div className="login-bg-orb login-bg-orb--2" />
      <div className="login-bg-orb login-bg-orb--3" />
      <div className="login-bg-grid" />

      <div className="login-card">
        {/* Header */}
        <div className="login-card__header">
          <div className="login-logo">
            <GraduationCap size={32} />
          </div>
          <h1 className="login-title">RGIPT ERP</h1>
          <p className="login-subtitle">Rajiv Gandhi Institute of Petroleum Technology</p>
          <div className="login-secure-badge">
            <Shield size={12} />
            Secure Student Portal
          </div>
        </div>

        {/* Form */}
        <form className="login-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="username" className="form-label">Username / Roll Number</label>
            <input
              id="username"
              name="username"
              type="text"
              className="form-input"
              value={form.username}
              onChange={handleChange}
              placeholder="e.g. 21BTECH001"
              autoComplete="username"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="password" className="form-label">Password</label>
            <div className="input-wrapper">
              <input
                id="password"
                name="password"
                type={showPass ? 'text' : 'password'}
                className="form-input"
                value={form.password}
                onChange={handleChange}
                placeholder="Enter your password"
                autoComplete="current-password"
                disabled={loading}
              />
              <button
                type="button"
                className="input-suffix btn-icon"
                onClick={() => setShowPass(p => !p)}
                tabIndex={-1}
              >
                {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary btn-full login-btn"
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 size={18} className="spin" />
                Signing in…
              </>
            ) : (
              <>
                <LogIn size={18} />
                Sign In
              </>
            )}
          </button>
        </form>

        <div style={{ marginTop: '1.5rem', marginBottom: '1rem' }}>
          <a  
            href="https://github.com/codeXlucky12/rgipt_erp/releases/download/apkv0.0.1/RGIPT-nexus-v1.0.apk"
            download="RGIPT_ERP.apk"
            className="btn login-btn"
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              gap: '0.5rem',
              textDecoration: 'none',
              backgroundColor: '#10b981',
              color: 'white',
              width: '100%',
              padding: '0.75rem',
              borderRadius: '0.5rem',
              fontWeight: 500,
              boxShadow: '0 4px 6px -1px rgba(16, 185, 129, 0.4)'
            }}
          >
            <Download size={18} />
            Download Android APK
          </a>
        </div>

        <p className="login-footer">
          Custom UI designed by <strong>Lucky Singh</strong> for RGIPT ERP.{' '}
          <a
            href="https://rgipterp.com/erp/login.php"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open official ERP ↗
          </a>
        </p>
      </div>
    </div>
  );
}
