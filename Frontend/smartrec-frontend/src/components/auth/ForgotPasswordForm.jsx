import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '../common/Button';
import Input from '../common/Input';
import { validateEmailOrPhone } from '../../utils/validators';

const ForgotPasswordForm = ({ onSubmit }) => {
  const [emailOrPhone, setEmailOrPhone] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const validationError = validateEmailOrPhone(emailOrPhone);
    setError(validationError);
    if (validationError) {
      return;
    }

    setLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 400));
    setLoading(false);
    onSubmit(emailOrPhone);
  };

  return (
    <form className="auth-form forgot-form" onSubmit={handleSubmit} noValidate>
      <div className="auth-orb auth-orb-key" aria-hidden="true">⌁</div>
      <div className="auth-copy">
        <h1>Quên mật khẩu?</h1>
        <p>Nhập email hoặc số điện thoại để nhận mã OTP</p>
      </div>
      <Input
        id="forgot-email"
        name="emailOrPhone"
        type="text"
        icon="✉"
        placeholder="Email hoặc số điện thoại"
        value={emailOrPhone}
        error={error}
        onChange={(event) => {
          setEmailOrPhone(event.target.value);
          setError('');
        }}
      />
      <Button type="submit" loading={loading}>
        Gửi mã OTP
      </Button>
      <Link className="auth-return-link" to="/login">Quay lại đăng nhập</Link>
    </form>
  );
};

export default ForgotPasswordForm;
