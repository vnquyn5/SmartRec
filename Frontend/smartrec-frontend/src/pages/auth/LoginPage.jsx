import React from "react";
import { Link, useLocation } from "react-router-dom";
import LoginForm from "../../components/auth/LoginForm";
import LoginVisual from "../../components/auth/LoginVisual";
import AuthBrand from "../../components/auth/AuthBrand";

const LoginPage = () => {
  const location = useLocation();
  const authNotice = location.state?.authNotice;

  return (
    <main className="auth-shell login-shell">
      <section className="login-panel">
        <div className="login-content">
          <div className="login-header-row">
            <AuthBrand />
            <div className="theme-dots" aria-hidden="true">
              <span />
              <span />
            </div>
          </div>

          <div className="login-copy">
            <h1>Welcome back to SmartRec</h1>
            <p>Your Smart AI Meeting Assistant</p>
          </div>

          {authNotice && (
            <div className="auth-success-message" role="status">
              {authNotice}
            </div>
          )}

          <LoginForm />

          <p className="login-footer-link">
            Chưa có tài khoản? <Link to="/register">Đăng ký</Link>
          </p>
        </div>
      </section>
      <LoginVisual />
    </main>
  );
};

export default LoginPage;
