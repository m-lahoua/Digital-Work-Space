import React from "react";
import { useNavigate } from "react-router-dom";
import "./Home.css"; // Créez ce fichier CSS pour le styling

const Home = () => {
  const navigate = useNavigate();

  return (
    <div className="home-container">
      <h1>Bienvenue sur l'espace de chat</h1>
      
      <div className="role-selection">
        <h2>Appuyez ci-dessous afin de vous connecter</h2>
        
        <button 
          className="role-btn student-btn"
          onClick={() => navigate("/login")}
        >
          Login
        </button>

      
      </div>
    </div>
  );
};

export default Home;