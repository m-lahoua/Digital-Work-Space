import React from "react";
import { useNavigate } from "react-router-dom";
import "./Home.css"; // Créez ce fichier CSS pour le styling

const Signupglobal = () => {
  const navigate = useNavigate();

  return (
    <div className="home-container">
      <h1>Choisissez votre rôle</h1>
      
      <div className="role-selection">
        <h2>Je suis :</h2>
        
        <button 
          className="role-btn student-btn"
          onClick={() => navigate("/signup")}
        >
          Étudiant
        </button>

        <button
          className="role-btn teacher-btn"
          onClick={() => navigate("/signupprof")}
        >
          Enseignant
        </button>
      </div>

      <div className="signup-link">
        <p>
          Deja inscrit ?{" "}
          <span onClick={() => navigate("/")}>
            Login
          </span>
        </p>
      </div>
    </div>
  );
};

export default Signupglobal;