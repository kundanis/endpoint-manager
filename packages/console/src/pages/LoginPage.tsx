import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { TriangleAlert } from "lucide-react";
import { useLogin, useMe } from "../api/hooks";
import Logo from "../components/Logo";

export default function LoginPage() {
  const { data: me, isError } = useMe();
  const login = useLogin();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Also require !isError — react-query keeps the last successful `data` around
  // during a background refetch even if that refetch then errors, so checking
  // `me` alone could redirect to /endpoints on stale cached data right after logout.
  if (me && !isError) return <Navigate to="/dashboard" replace />;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    login.mutate({ email, password }, { onSuccess: () => navigate("/dashboard") });
  }

  return (
    <div className="app-login">
      <form className="ep-card app-login-card" onSubmit={handleSubmit}>
        <div className="ep-brandrow">
          <Logo size={28} />
          <div>
            <b>Endpoint One</b>
          </div>
        </div>
        <div className="ep-section">
          <h1>Sign in</h1>
          {login.isError && (
            <div className="ep-alert ep-alert-critical" role="alert">
              <TriangleAlert size={16} strokeWidth={1.7} className="ep-ic" aria-hidden />
              <div>{(login.error as Error).message}</div>
            </div>
          )}
          <div className="ep-field">
            <label className="ep-label" htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              className="ep-input"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="ep-field">
            <label className="ep-label" htmlFor="login-password">
              Password
            </label>
            <input
              id="login-password"
              className="ep-input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="ep-btn ep-btn-primary" disabled={login.isPending}>
            {login.isPending ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </form>
    </div>
  );
}
