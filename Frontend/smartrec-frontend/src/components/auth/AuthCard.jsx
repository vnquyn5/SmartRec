import React from 'react';
import AuthBrand from './AuthBrand';

const AuthCard = ({ children, className = '' }) => {
  return (
    <section className={`auth-card ${className}`}>
      <div className="auth-card-top">
        <AuthBrand compact />
        <span className="auth-card-dot" aria-hidden="true" />
      </div>
      {children}
    </section>
  );
};

export default AuthCard;
