import React from 'react';

const Button = ({
  children,
  type = 'button',
  variant = 'primary',
  loading = false,
  disabled = false,
  className = '',
  ...props
}) => {
  return (
    <button
      type={type}
      className={`sr-button sr-button-${variant} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? 'Đang xử lý...' : children}
    </button>
  );
};

export default Button;
