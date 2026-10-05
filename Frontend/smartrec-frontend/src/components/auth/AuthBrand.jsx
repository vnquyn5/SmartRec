import React from 'react';

const AuthBrand = ({ compact = false }) => {
  return (
    <div className={`auth-brand ${compact ? 'auth-brand-compact' : ''}`}>
      <span className="auth-logo-mark" aria-hidden="true">
        <span />
      </span>
      <strong>Smart<span>Rec</span></strong>
    </div>
  );
};

export default AuthBrand;
