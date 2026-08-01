import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useLogin, useMe } from "../api/hooks";

export default function LoginPage() {
  const { data: me, isError } = useMe();
  const login = useLogin();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  if (me && !isError) return <Navigate to="/entities" replace />;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    login.mutate({ email, password }, { onSuccess: () => navigate("/entities") });
  }

  return (
    <div className="login-page">
      <form className="login-form" onSubmit={handleSubmit}>
        <h1>License Server</h1>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {login.isError && <p className="error-text">{(login.error as Error).message}</p>}
        <button type="submit" disabled={login.isPending}>
          {login.isPending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
