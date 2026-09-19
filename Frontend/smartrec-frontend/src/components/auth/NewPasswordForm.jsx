import React, { useState } from "react";
import Button from "../common/Button";
import Input from "../common/Input";
import PasswordRequirements from "./PasswordRequirements";
import {
  validateConfirmPassword,
  isPasswordValid,
} from "../../utils/validators";

const NewPasswordForm = ({ onSubmit }) => {
  const [values, setValues] = useState({ password: "", confirmPassword: "" });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const validate = () => {
    const nextErrors = {
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
    return Object.keys(nextErrors).length === 0 && isPasswordValid(values.password);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitted(true);
    if (!validate()) {
      return;
    }

    setLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    setLoading(false);
    onSubmit();
  };

  const handleChange = (event) => {
    const { name, value } = event.target;
    setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: "" }));
  };

  return (
    <form
      className="auth-form new-password-form"
      onSubmit={handleSubmit}
      noValidate
    >
      <div className="auth-orb auth-orb-lock" aria-hidden="true">
        ▣
      </div>
      <div className="auth-copy">
        <h1>Tạo mật khẩu mới</h1>
        <p>Mật khẩu cần đáp ứng đầy đủ các điều kiện bảo mật</p>
      </div>
      <Input
        id="new-password"
        name="password"
        type="password"
        icon="123"
        placeholder="Mật khẩu mới"
        value={values.password}
        error={errors.password}
        onChange={handleChange}
        autoComplete="new-password"
      />
      <PasswordRequirements
        password={values.password}
        visible={Boolean(values.password) || submitted}
      />
      <Input
        id="confirm-new-password"
        name="confirmPassword"
        type="password"
        icon="123"
        placeholder="Xác nhận mật khẩu mới"
        value={values.confirmPassword}
        error={errors.confirmPassword}
        onChange={handleChange}
        autoComplete="new-password"
      />
      <Button type="submit" loading={loading}>
        Đặt lại mật khẩu
      </Button>
    </form>
  );
};

export default NewPasswordForm;
