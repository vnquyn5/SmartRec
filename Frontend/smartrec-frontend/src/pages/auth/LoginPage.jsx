import React, { useState } from 'react';
import { useAuth } from '../../features/auth/AuthProvider.jsx';
import { useNavigate, useLocation } from 'react-router-dom';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const from = location.state?.from?.pathname || '/';

  const handleLogin = async (e) => {
    e.preventDefault();
    setIsLoggingIn(true);
    try {
      // Gọi API đăng nhập giả lập
      await login('admin@example.com', 'password123');
      navigate(from, { replace: true });
    } catch (err) {
      alert('Đăng nhập thất bại');
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <div style={{ 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center', 
      minHeight: '100vh', 
      background: 'var(--sr-bg, #0b1120)', 
      color: '#fff',
      fontFamily: 'Inter, system-ui, sans-serif'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '420px',
        padding: '48px 40px',
        background: '#151e32',
        borderRadius: '24px',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
        border: '1px solid rgba(255, 255, 255, 0.05)',
        textAlign: 'center'
      }}>
        {/* Logo SmartRec */}
        <div style={{
          width: '64px',
          height: '64px',
          background: 'linear-gradient(135deg, #3e89ff 0%, #00d1ff 100%)',
          borderRadius: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 24px',
          boxShadow: '0 8px 16px rgba(62, 137, 255, 0.3)'
        }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#fff' }}>
            <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
            <polyline points="2 17 12 22 22 17"></polyline>
            <polyline points="2 12 12 17 22 12"></polyline>
          </svg>
        </div>

        <h1 style={{ fontSize: '26px', fontWeight: '800', marginBottom: '8px', letterSpacing: '-0.5px' }}>Chào mừng trở lại</h1>
        <p style={{ fontSize: '14px', color: '#8d96aa', marginBottom: '32px' }}>Đăng nhập để tiếp tục sử dụng SmartRec</p>

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ textAlign: 'left' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#a0abc0', marginBottom: '8px' }}>Email</label>
            <input 
              type="email" 
              defaultValue="admin@example.com"
              required
              style={{
                width: '100%',
                padding: '14px 16px',
                background: 'rgba(0, 0, 0, 0.2)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '12px',
                color: '#fff',
                fontSize: '14px',
                outline: 'none',
                boxSizing: 'border-box',
                transition: 'border-color 0.2s'
              }}
              onFocus={(e) => e.target.style.borderColor = '#3e89ff'}
              onBlur={(e) => e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)'}
            />
          </div>
          
          <div style={{ textAlign: 'left', marginBottom: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <label style={{ fontSize: '13px', fontWeight: '600', color: '#a0abc0' }}>Mật khẩu</label>
              <a href="#" style={{ fontSize: '12px', color: '#3e89ff', textDecoration: 'none', fontWeight: '500' }}>Quên mật khẩu?</a>
            </div>
            <input 
              type="password" 
              defaultValue="password123"
              required
              style={{
                width: '100%',
                padding: '14px 16px',
                background: 'rgba(0, 0, 0, 0.2)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '12px',
                color: '#fff',
                fontSize: '14px',
                outline: 'none',
                boxSizing: 'border-box',
                transition: 'border-color 0.2s'
              }}
              onFocus={(e) => e.target.style.borderColor = '#3e89ff'}
              onBlur={(e) => e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)'}
            />
          </div>

          <button 
            type="submit"
            disabled={isLoggingIn}
            style={{ 
              width: '100%',
              padding: '14px', 
              background: 'linear-gradient(135deg, #3e89ff 0%, #2b6cb0 100%)', 
              border: 'none', 
              borderRadius: '12px', 
              color: '#fff', 
              fontSize: '15px',
              fontWeight: '600',
              cursor: isLoggingIn ? 'not-allowed' : 'pointer',
              opacity: isLoggingIn ? 0.7 : 1,
              transition: 'all 0.2s',
              boxShadow: '0 4px 12px rgba(62, 137, 255, 0.2)',
              marginTop: '8px'
            }}
          >
            {isLoggingIn ? 'Đang xử lý...' : 'Đăng nhập vào hệ thống'}
          </button>
        </form>
      </div>
    </div>
  );
}
