import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LoginForm from "../../src/components/auth/LoginForm.jsx";
import RegisterForm from "../../src/components/auth/RegisterForm.jsx";
import ForgotPasswordForm from "../../src/components/auth/ForgotPasswordForm.jsx";
import { useAuth } from "../../src/features/auth/AuthProvider.jsx";

vi.mock("../../src/features/auth/AuthProvider.jsx", () => ({
  useAuth: vi.fn(),
}));

function renderAtRoute(path, element) {
  return render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path={path} element={element} />
        <Route path="/" element={<p>Dashboard page</p>} />
        <Route path="/login" element={<p>Login destination</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LoginForm", () => {
  let login;

  beforeEach(() => {
    login = vi.fn().mockResolvedValue(undefined);
    useAuth.mockReturnValue({ login });
  });

  it("shows validation errors and does not submit invalid credentials", async () => {
    const user = userEvent.setup();
    renderAtRoute("/login", <LoginForm />);

    await user.click(
      screen.getByRole("button", { name: "Đăng nhập vào Workspace" }),
    );

    expect(
      screen.getByText("Vui lòng nhập email hoặc số điện thoại"),
    ).toBeInTheDocument();
    expect(screen.getByText("Vui lòng nhập mật khẩu")).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it("logs in with valid credentials and navigates to the dashboard", async () => {
    const user = userEvent.setup();
    renderAtRoute("/login", <LoginForm />);

    await user.type(
      screen.getByPlaceholderText("Email hoặc số điện thoại"),
      "alice@example.com",
    );
    await user.type(screen.getByPlaceholderText("Mật khẩu"), "Aa1!aaaa");
    await user.click(
      screen.getByRole("button", { name: "Đăng nhập vào Workspace" }),
    );

    expect(login).toHaveBeenCalledWith("alice@example.com", "Aa1!aaaa");
    expect(await screen.findByText("Dashboard page")).toBeInTheDocument();
  });

  it("shows the authentication error and allows password visibility toggling", async () => {
    const user = userEvent.setup();
    login.mockRejectedValue(new Error("Invalid credentials"));
    renderAtRoute("/login", <LoginForm />);
    const password = screen.getByPlaceholderText("Mật khẩu");

    await user.type(
      screen.getByPlaceholderText("Email hoặc số điện thoại"),
      "alice@example.com",
    );
    await user.type(password, "Aa1!aaaa");
    await user.click(screen.getByRole("button", { name: "Hiện mật khẩu" }));

    expect(password).toHaveAttribute("type", "text");

    await user.click(
      screen.getByRole("button", { name: "Đăng nhập vào Workspace" }),
    );

    expect(await screen.findByText("Invalid credentials")).toBeInTheDocument();
    expect(password).toHaveAttribute("type", "text");
  });
});

describe("RegisterForm", () => {
  let register;

  beforeEach(() => {
    register = vi.fn().mockResolvedValue(true);
    useAuth.mockReturnValue({ register });
  });

  it("does not submit until all fields and passwords are valid", async () => {
    const user = userEvent.setup();
    renderAtRoute("/register", <RegisterForm />);

    await user.click(screen.getByRole("button", { name: "Đăng ký" }));

    expect(screen.getByText("Vui lòng nhập họ và tên")).toBeInTheDocument();
    expect(screen.getByText("Vui lòng nhập số điện thoại")).toBeInTheDocument();
    expect(screen.getByText("Vui lòng nhập email")).toBeInTheDocument();
    expect(screen.getByText("Vui lòng nhập mật khẩu")).toBeInTheDocument();
    expect(register).not.toHaveBeenCalled();
  });

  it("normalizes the name and phone, registers, and navigates to login", async () => {
    const user = userEvent.setup();
    renderAtRoute("/register", <RegisterForm />);

    await user.type(screen.getByPlaceholderText("Họ và tên"), "nGUYỄN   vĂN an");
    await user.type(screen.getByPlaceholderText("Số điện thoại"), "09123abc45678");
    await user.type(screen.getByPlaceholderText("Email"), "alice@example.com");
    await user.type(screen.getByPlaceholderText("Mật khẩu"), "Aa1!aaaa");
    await user.type(
      screen.getByPlaceholderText("Xác nhận mật khẩu"),
      "Aa1!aaaa",
    );
    await user.click(screen.getByRole("button", { name: "Đăng ký" }));

    expect(register).toHaveBeenCalledWith({
      fullName: "Nguyễn Văn An",
      phone: "0912345678",
      email: "alice@example.com",
      password: "Aa1!aaaa",
      confirmPassword: "Aa1!aaaa",
    });
    expect(await screen.findByText("Login destination")).toBeInTheDocument();
  });

  it("maps duplicate email errors to the email field", async () => {
    const user = userEvent.setup();
    register.mockRejectedValue(
      Object.assign(new Error("Email already exists"), {
        code: "EMAIL_ALREADY_EXISTS",
      }),
    );
    renderAtRoute("/register", <RegisterForm />);

    await user.type(screen.getByPlaceholderText("Họ và tên"), "Alice Smith");
    await user.type(screen.getByPlaceholderText("Số điện thoại"), "0912345678");
    await user.type(screen.getByPlaceholderText("Email"), "alice@example.com");
    await user.type(screen.getByPlaceholderText("Mật khẩu"), "Aa1!aaaa");
    await user.type(
      screen.getByPlaceholderText("Xác nhận mật khẩu"),
      "Aa1!aaaa",
    );
    await user.click(screen.getByRole("button", { name: "Đăng ký" }));

    expect(
      await screen.findByText("Email này đã được đăng ký."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Login destination")).not.toBeInTheDocument();
  });
});

describe("ForgotPasswordForm", () => {
  it("rejects an invalid identifier without advancing", async () => {
    const onSubmit = vi.fn();
    renderAtRoute(
      "/forgot-password",
      <ForgotPasswordForm onSubmit={onSubmit} />,
    );

    fireEvent.change(screen.getByPlaceholderText("Email hoặc số điện thoại"), {
      target: { value: "invalid" },
    });
    fireEvent.submit(
      screen.getByRole("button", { name: "Gửi mã OTP" }).closest("form"),
    );

    expect(
      screen.getByText("Email hoặc số điện thoại không hợp lệ"),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
