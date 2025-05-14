import React, { useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import "./Signup.css";

const Signup = () => {
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    username: "",
    password: ""
  });

  const [error, setError] = useState("");
  const [passwordErrors, setPasswordErrors] = useState([]);
  const navigate = useNavigate();

  const validatePassword = (password, username) => {
    const errors = [];
    if (password.length < 8) errors.push("Must be at least 8 characters");
    if (!/[A-Z]/.test(password)) errors.push("Need uppercase letter");
    if (!/[a-z]/.test(password)) errors.push("Need lowercase letter");
    if (!/\d/.test(password)) errors.push("Need number");
    if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
      errors.push("Need special character");
    }
    if (password === username) errors.push("Can't be username");
    return errors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Final password check
    const finalErrors = validatePassword(formData.password, formData.username);
    if (finalErrors.length > 0) {
      setPasswordErrors(finalErrors);
      return;
    }

    try {
      await axios.post("http://localhost:8000/signup", {
        ...formData,
        enabled: false,
        emailVerified: true,
        role:"etudiant"
      });
      navigate("/?success=1");
    } catch (err) {
      setError(err.response?.data?.detail || "Erreur lors de l'inscription");
    }
  };

  return (
    <div className="signup-form">
      <h2>Inscription Étudiant</h2>
      {error && <div className="error">{error}</div>}
      
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Prénom</label>
          <input
            type="text"
            required
            onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
          />
        </div>

        <div className="form-group">
          <label>Nom</label>
          <input
            type="text"
            required
            onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
          />
        </div>

        <div className="form-group">
          <label>Email</label>
          <input
            type="email"
            required
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          />
        </div>

        <div className="form-group">
          <label>Nom d'utilisateur</label>
          <input
            type="text"
            required
            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
          />
        </div>

        <div className="form-group">
          <label>Mot de passe</label>
          <input
            type="password"
            required
            minLength="8"
            onChange={(e) => {
              const password = e.target.value;
              setFormData(prev => ({ ...prev, password }));
              setPasswordErrors(validatePassword(password, formData.username));
            }}
          />
          {passwordErrors.length > 0 && (
            <div className="password-errors">
              {passwordErrors.map((error, index) => (
                <div key={index} style={{ color: 'red', fontSize: '0.9rem' }}>
                  {error}
                </div>
              ))}
            </div>
          )}
        </div>

        <button type="submit" className="submit-btn">
          S'inscrire
        </button>
      </form>

      <p className="login-redirect">
        Déjà inscrit ? <a href="/login">Se connecter</a>
      </p>
    </div>
  );
};

export default Signup;
