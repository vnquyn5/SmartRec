import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequireAuth } from "../../src/features/auth/RequireAuth.jsx";
import { useAuth } from "../../src/features/auth/AuthProvider.jsx";

vi.mock("../../src/features/auth/AuthProvider.jsx", () => ({
  useAuth: vi.fn(),
}));

function LoginRoute() {
  const location = useLocation();
  return <p>Login from {location.state?.from?.pathname}</p>;
}

function renderProtectedRoute(path = "/private") {
  return render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        <Route element={<RequireAuth />}>
          <Route path="/private" element={<p>Private content</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("RequireAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a loading state while authentication is bootstrapping", () => {
    useAuth.mockReturnValue({
      status: "bootstrapping",
      hasRole: vi.fn(),
    });

    renderProtectedRoute();

    expect(screen.getByText("Đang tải phiên làm việc...")).toBeInTheDocument();
  });

  it("redirects unauthenticated users to login and preserves the requested path", () => {
    useAuth.mockReturnValue({
      status: "unauthenticated",
      hasRole: vi.fn(),
    });

    renderProtectedRoute();

    expect(screen.getByText("Login from /private")).toBeInTheDocument();
  });

  it("renders the protected page for authenticated users", () => {
    useAuth.mockReturnValue({
      status: "authenticated",
      hasRole: vi.fn(),
    });

    renderProtectedRoute();

    expect(screen.getByText("Private content")).toBeInTheDocument();
  });
});
