import React from 'react';

const ErrorMessage = ({ message }) => {
  if (!message) {
    return null;
  }

  return <p className="auth-error-message">{message}</p>;
};

export default ErrorMessage;
