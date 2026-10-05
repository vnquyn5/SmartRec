import React from 'react';
import ErrorMessage from './ErrorMessage';

const Input = ({
  id,
  label,
  icon,
  error,
  rightElement,
  className = '',
  ...props
}) => {
  return (
    <div className={`sr-field ${className}`}>
      {label && <label htmlFor={id}>{label}</label>}
      <div className={`sr-input-wrap ${error ? 'is-error' : ''}`}>
        {icon && <span className="sr-input-icon">{icon}</span>}
        <input id={id} aria-invalid={Boolean(error)} {...props} />
        {rightElement && <div className="sr-input-action">{rightElement}</div>}
      </div>
      <ErrorMessage message={error} />
    </div>
  );
};

export default Input;
