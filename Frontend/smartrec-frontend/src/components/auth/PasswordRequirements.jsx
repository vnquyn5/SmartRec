import React from "react";
import {
  getPasswordRequirements,
  passwordRequirementLabels,
} from "../../utils/validators";

const PasswordRequirements = ({ password, visible = false }) => {
  if (!visible) {
    return null;
  }

  const requirements = getPasswordRequirements(password);

  return (
    <ul className="password-requirements" aria-live="polite">
      {Object.entries(passwordRequirementLabels).map(([key, label]) => {
        const isValid = requirements[key];
        return (
          <li key={key} className={isValid ? "is-valid" : "is-invalid"}>
            <span aria-hidden="true">{isValid ? "✓" : "✕"}</span>
            <span>{label}</span>
          </li>
        );
      })}
    </ul>
  );
};

export default PasswordRequirements;
