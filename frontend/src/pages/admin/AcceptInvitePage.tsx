import { useState, useEffect, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { validateInvite, acceptInvite, isAuthenticated } from "../../api/auth";
import { ApiError } from "../../api/client";
import "./AdminLoginPage.css";

type Status = "loading" | "valid" | "invalid" | "expired";

export default function AcceptInvitePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";

  const [status, setStatus] = useState<Status>("loading");
  const [prefilledEmail, setPrefilledEmail] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated()) {
      navigate("/admin");
      return;
    }

    if (!token) {
      setStatus("invalid");
      return;
    }

    validateInvite(token)
      .then((result) => {
        if (result.valid) {
          setStatus("valid");
          if (result.email) {
            setPrefilledEmail(result.email);
            setEmail(result.email);
          }
        } else {
          setStatus("invalid");
        }
      })
      .catch(() => {
        setStatus("invalid");
      });
  }, [token, navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);

    try {
      await acceptInvite(token, email, password);
      navigate("/admin");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.responseMessage);
      } else {
        setError("An unexpected error occurred");
      }
    } finally {
      setLoading(false);
    }
  };

  if (status === "loading") {
    return (
      <div className="admin-login-page">
        <div className="admin-login-container">
          <p>Validating invite...</p>
        </div>
      </div>
    );
  }

  if (status === "invalid") {
    return (
      <div className="admin-login-page">
        <div className="admin-login-container">
          <h1>Invalid Invite</h1>
          <p className="setup-notice">
            This invite link is invalid, has already been used, or has expired.
            Please ask an admin for a new invite.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-login-page">
      <div className="admin-login-container">
        <h1>Create Admin Account</h1>
        <p className="setup-notice">
          You've been invited to join the Voices That Remain admin team.
        </p>
        <form onSubmit={handleSubmit} className="admin-login-form">
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              readOnly={!!prefilledEmail}
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <div className="form-group">
            <label htmlFor="confirm-password">Confirm Password</label>
            <input
              type="password"
              id="confirm-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          {error && <div className="error-message">{error}</div>}
          <button type="submit" className="login-button" disabled={loading}>
            {loading ? "Creating account..." : "Create Account"}
          </button>
        </form>
      </div>
    </div>
  );
}
