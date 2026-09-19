import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Button from "../common/Button";
import Input from "../common/Input";
import useAuth from "../../hooks/useAuth";
import { validateEmailOrPhone, validatePassword } from "../../utils/validators";

const initialValues = {
  emailOrPhone: "",
  password: "",
  remember: true,
};

const GoogleIcon = () => (
  <svg className="google-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      fill="#4285F4"
      d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.29h6.47c-.28 1.5-1.13 2.77-2.4 3.62v3.01h3.89c2.27-2.09 3.53-5.17 3.53-8.65z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.89-3.01c-1.08.72-2.46 1.15-4.06 1.15-3.13 0-5.78-2.11-6.73-4.95H1.25v3.1C3.23 21.31 7.3 24 12 24z"
    />
    <path
      fill="#FBBC05"
      d="M5.27 14.28A7.2 7.2 0 0 1 4.89 12c0-.79.14-1.56.38-2.28v-3.1H1.25A11.96 11.96 0 0 0 0 12c0 1.93.46 3.75 1.25 5.38l4.02-3.1z"
    />
    <path
      fill="#EA4335"
      d="M12 4.77c1.76 0 3.34.61 4.58 1.8l3.45-3.45C17.95 1.18 15.23 0 12 0 7.3 0 3.23 2.69 1.25 6.62l4.02 3.1C6.22 6.88 8.87 4.77 12 4.77z"
    />
  </svg>
);

const LoginForm = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const validate = () => {
    const nextErrors = {
      emailOrPhone: validateEmailOrPhone(values.emailOrPhone),
      password: validatePassword(values.password),
    };
    Object.keys(nextErrors).forEach((key) => {
      if (!nextErrors[key]) {
        delete nextErrors[key];
      }
    });
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleChange = (event) => {
    const { name, value, type, checked } = event.target;
    setValues((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : value,
    }));
    setErrors((current) => ({ ...current, [name]: "" }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!validate()) {
      return;
    }

    setLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await login(values);
    setLoading(false);
    navigate("/");
  };

  return (
    <form className="auth-form login-form" onSubmit={handleSubmit} noValidate>
      <Button variant="secondary" className="google-button">
        <GoogleIcon />
        <span>Continue with Google</span>
      </Button>

      <div className="auth-divider">
        <span>OR</span>
      </div>

      <Input
        id="login-email"
        name="emailOrPhone"
        type="text"
        placeholder="Email hoặc số điện thoại"
        value={values.emailOrPhone}
        error={errors.emailOrPhone}
        onChange={handleChange}
        autoComplete="username"
      />

      <Input
        id="login-password"
        name="password"
        type={showPassword ? "text" : "password"}
        placeholder="Mật khẩu"
        value={values.password}
        error={errors.password}
        onChange={handleChange}
        autoComplete="current-password"
        rightElement={
          <button
            type="button"
            className="ghost-icon-button"
            onClick={() => setShowPassword((current) => !current)}
            aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
          >
            {showPassword ? "Ẩn" : "Hiện"}
          </button>
        }
      />

      <div className="login-options">
        <label className="remember-control">
          <input
            type="checkbox"
            name="remember"
            checked={values.remember}
            onChange={handleChange}
          />
          <span>Ghi nhớ thiết bị này</span>
        </label>
        <Link to="/forgot-password">Quên mật khẩu?</Link>
      </div>

      <Button type="submit" loading={loading}>
        Đăng nhập vào Workspace
      </Button>
    </form>
  );
};

export default LoginForm;
