import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Button from "../common/Button";
import ErrorMessage from "../common/ErrorMessage";
import Input from "../common/Input";
import PasswordRequirements from "./PasswordRequirements";
import { useAuth } from "../../features/auth/AuthProvider.jsx";
import {
  validateConfirmPassword,
  validateEmail,
  formatFullName,
  validateFullName,
  validatePassword,
  validatePhone,
} from "../../utils/validators";

const initialValues = {
  fullName: "",
  phone: "",
  email: "",
  password: "",
  confirmPassword: "",
};

const RegisterForm = () => {
  const navigate = useNavigate();
  const { register } = useAuth();
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState("");

  const validate = () => {
    const nextErrors = {
      fullName: validateFullName(values.fullName),
      phone: validatePhone(values.phone),
      email: validateEmail(values.email),
      password: validatePassword(values.password),
      confirmPassword: validateConfirmPassword(
        values.confirmPassword,
        values.password,
      ),
    };
    Object.keys(nextErrors).forEach((key) => {
      if (!nextErrors[key]) {
        delete nextErrors[key];
      }
    });
    setErrors(nextErrors);
    return (
      Object.keys(nextErrors).length === 0 && isPasswordValid(values.password)
    );
  };

  const setBackendErrors = (error) => {
    const nextErrors = {};

    if (error.code === "EMAIL_ALREADY_EXISTS") {
      nextErrors.email = "Email này đã được đăng ký.";
    }
    if (error.code === "PHONE_ALREADY_EXISTS") {
      nextErrors.phone = "Số điện thoại này đã được đăng ký.";
    }

    if (error.code === "VALIDATION_ERROR" && Array.isArray(error.detail)) {
      error.detail.forEach((item) => {
        const [field, ...messageParts] = item.split(":");
        const fieldMap = {
          email: "email",
          phone: "phone",
          passWord: "password",
          password: "password",
          full_name: "fullName",
          fullName: "fullName",
        };
        const mappedField = fieldMap[field?.trim()];

        if (
          mappedField &&
          messageParts.length > 0 &&
          !nextErrors[mappedField]
        ) {
          nextErrors[mappedField] = messageParts.join(":").trim();
        }
      });
    }

    setErrors((current) => ({ ...current, ...nextErrors }));
    return Object.keys(nextErrors).length > 0;
  };

  const handleChange = (event) => {
    const { name, value } = event.target;
    const nextValue =
      name === "fullName"
        ? formatFullName(value)
        : name === "phone"
          ? value.replace(/\D/g, "").slice(0, 10)
          : value;

    setValues((current) => ({ ...current, [name]: nextValue }));
    setErrors((current) => ({ ...current, [name]: "" }));
    setFormError("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitted(true);
    if (!validate()) {
      return;
    }

    setLoading(true);
    setFormError("");
    try {
      await register(values);
      navigate("/login", {
        state: {
          authNotice:
            "Đăng ký tài khoản thành công. Vui lòng đăng nhập để tiếp tục.",
        },
      });
    } catch (error) {
      if (!setBackendErrors(error)) {
        setFormError(error.message || "Đăng ký thất bại. Vui lòng thử lại.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={handleSubmit} noValidate>
      <ErrorMessage message={formError} />
      <Input
        id="register-name"
        name="fullName"
        type="text"
        icon="♙"
        placeholder="Họ và tên"
        value={values.fullName}
        error={errors.fullName}
        onChange={handleChange}
        maxLength={50}
        autoComplete="name"
      />
      <Input
        id="register-phone"
        name="phone"
        type="tel"
        icon="☎"
        placeholder="Số điện thoại"
        value={values.phone}
        error={errors.phone}
        onChange={handleChange}
        maxLength={10}
        autoComplete="tel"
      />
      <Input
        id="register-email"
        name="email"
        type="email"
        icon="✉"
        placeholder="Email"
        value={values.email}
        error={errors.email}
        onChange={handleChange}
        maxLength={50}
        autoComplete="email"
      />
      <Input
        id="register-password"
        name="password"
        type={showPassword ? "text" : "password"}
        icon="123"
        placeholder="Mật khẩu"
        value={values.password}
        error={errors.password}
        onChange={handleChange}
        autoComplete="new-password"
        rightElement={
          <button
            type="button"
            className="ghost-dot-button"
            onClick={() => setShowPassword((current) => !current)}
            aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
          />
        }
      />
      <PasswordRequirements
        password={values.password}
        visible={Boolean(values.password) || submitted}
      />
      <Input
        id="register-confirm-password"
        name="confirmPassword"
        type={showPassword ? "text" : "password"}
        icon="123"
        placeholder="Xác nhận mật khẩu"
        value={values.confirmPassword}
        error={errors.confirmPassword}
        onChange={handleChange}
        autoComplete="new-password"
        rightElement={<span className="input-soft-dot" aria-hidden="true" />}
      />

      <Button type="submit" loading={loading}>
        Đăng ký
      </Button>

      <p className="auth-switch-text">
        Đã có tài khoản? <Link to="/login">Đăng nhập</Link>
      </p>
    </form>
  );
};

export default RegisterForm;
