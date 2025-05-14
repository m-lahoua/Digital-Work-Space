import React from "react";
import { useNavigate } from "react-router-dom";
import "./Home.css"; // Créez ce fichier CSS pour le styling

const Home = () => {
  const navigate = useNavigate();

  return (
    <div className="home-container">
      <h1>Bienvenue sur l'espace numérique de travail</h1>
      
      <div className="role-selection">
        <h2>Appuyez ci-dessous afin de vous connecter</h2>
        
        <button 
          className="role-btn student-btn"
          onClick={() => navigate("/login")}
        >
          Login
        </button>

      
      </div>

      <div className="signup-link">
        <p>
          Nouveau utilisateur ?{" "}
          <span onClick={() => navigate("/signupglobal")}>
            Créer un compte
          </span>
        </p>
        <p>
          Application de chat{" "}
          <a href="http://localhost:3001">
            Naviguer vers l'application
          </a>
        </p>
      </div>
    </div>
  );
};

export default Home;