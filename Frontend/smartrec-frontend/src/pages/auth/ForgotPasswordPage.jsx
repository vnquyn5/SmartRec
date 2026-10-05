import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import AuthCard from '../../components/auth/AuthCard';
import ForgotPasswordForm from '../../components/auth/ForgotPasswordForm';
import NewPasswordForm from '../../components/auth/NewPasswordForm';
import OtpForm from '../../components/auth/OtpForm';

const ForgotPasswordPage = () => {
  const [step, setStep] = useState('email');

  return (
    <main className="auth-shell centered-auth-shell">
      <div className="auth-ambient auth-ambient-blue" aria-hidden="true" />
      <AuthCard className={`forgot-card forgot-card-${step}`}>
        {step === 'email' && (
          <ForgotPasswordForm onSubmit={() => setStep('otp')} />
        )}
        {step === 'otp' && (
          <OtpForm
            onSubmit={() => setStep('new-password')}
            onBack={() => setStep('email')}
          />
        )}
        {step === 'new-password' && (
          <NewPasswordForm onSubmit={() => setStep('success')} />
        )}
        {step === 'success' && (
          <div className="forgot-success">
            <div className="success-ring" aria-hidden="true">
              <span />
            </div>
            <div className="auth-copy">
              <h1>Đặt lại mật khẩu thành công!</h1>
              <p>Mật khẩu của bạn đã được cập nhật. Bạn có thể đăng nhập với mật khẩu mới.</p>
            </div>
            <Link className="sr-button sr-button-primary" to="/login">Quay lại đăng nhập</Link>
          </div>
        )}
      </AuthCard>
    </main>
  );
};

export default ForgotPasswordPage;
