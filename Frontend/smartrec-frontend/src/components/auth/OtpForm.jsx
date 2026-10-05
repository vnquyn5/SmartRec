import React, { useRef, useState } from 'react';
import Button from '../common/Button';
import ErrorMessage from '../common/ErrorMessage';
import { validateOtp } from '../../utils/validators';

const OtpForm = ({ onSubmit, onBack }) => {
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState('Mã OTP không đúng. Vui lòng thử lại.');
  const [loading, setLoading] = useState(false);
  const inputsRef = useRef([]);

  const handleChange = (index, value) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const nextDigits = [...digits];
    nextDigits[index] = digit;
    setDigits(nextDigits);
    setError('');
    if (digit && index < inputsRef.current.length - 1) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index, event) => {
    if (event.key === 'Backspace' && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const otp = digits.join('');
    const validationError = validateOtp(otp);
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 400));
    setLoading(false);
    onSubmit(otp);
  };

  return (
    <form className="auth-form otp-form" onSubmit={handleSubmit} noValidate>
      <div className="auth-orb auth-orb-shield" aria-hidden="true">♢</div>
      <div className="auth-copy">
        <h1>Xác thực OTP</h1>
        <p>Nhập mã 6 số đã gửi đến email/SĐT của bạn</p>
      </div>

      <div className="otp-input-row">
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={(node) => {
              inputsRef.current[index] = node;
            }}
            value={digit}
            onChange={(event) => handleChange(index, event.target.value)}
            onKeyDown={(event) => handleKeyDown(index, event)}
            inputMode="numeric"
            aria-label={`OTP digit ${index + 1}`}
            maxLength={1}
          />
        ))}
      </div>

      <ErrorMessage message={error} />

      <Button type="submit" loading={loading}>
        Xác nhận
      </Button>
      <button type="button" className="text-button" onClick={onBack}>
        Không nhận được mã? Gửi lại
      </button>
    </form>
  );
};

export default OtpForm;
