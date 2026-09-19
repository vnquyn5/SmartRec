import React from 'react';
import AuthCard from '../../components/auth/AuthCard';
import RegisterForm from '../../components/auth/RegisterForm';

const RegisterPage = () => {
  return (
    <main className="auth-shell centered-auth-shell">
      <div className="auth-ambient auth-ambient-purple" aria-hidden="true" />
      <AuthCard className="register-card">
        <div className="auth-copy align-left">
          <h1>Tạo tài khoản SmartRec</h1>
          <p>Bắt đầu trải nghiệm trợ lý AI họp thông minh</p>
        </div>
        <RegisterForm />
      </AuthCard>
    </main>
  );
};

export default RegisterPage;
