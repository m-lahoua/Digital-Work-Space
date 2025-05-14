import React, { useEffect, useState, useRef } from "react";
import api from "../api";
import { useNavigate } from "react-router-dom";
import "./Dashboard.css";

const Dashboard = () => {
  const [folders, setFolders] = useState([]);
  const [currentFolder, setCurrentFolder] = useState(null);
  const [files, setFiles] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [announcements, setAnnouncements] = useState([]);
  const navigate = useNavigate();
  
  // Chat state
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessage, setChatMessage] = useState("");
  const [chatMessages, setChatMessages] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef(null);

  // Scroll to bottom of chat messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages]);


  useEffect(() => {
    const fetchAnnouncements = async () => {
      try {
        const response = await api.get('/announcements');
        setAnnouncements(response.data.announcements || []);
      } catch (error) {
        console.error("Error fetching announcements:", error);
      }
    };
    
    fetchAnnouncements();
    
    // Rafraîchir les annonces toutes les 5 minutes
    const intervalId = setInterval(fetchAnnouncements, 5 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, []);
  
  // Fonction pour formatter la date
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Check authentication
        if (!localStorage.getItem("access_token")) {
          navigate("/");
          return;
        }
        
        setIsLoading(true);
        const res = await api.get("/courses");
        setFolders(res.data.folders || []); // Ensure folders is always an array
        setIsLoading(false);
      } catch (err) {
        console.error("Error loading folders:", err);
        setError("Impossible de charger les cours. Veuillez réessayer.");
        setIsLoading(false);
        setFolders([]); // Reset folders to empty array on error
        
        // Only redirect if it's an auth error
        if (err.response && err.response.status === 401) {
          navigate("/");
        }
      }
    };
    
    fetchData();
  }, [navigate]);

  const openFolder = async (folder) => {
    try {
      setIsLoading(true);
      const res = await api.get(`/courses/${folder}/files`);
      setCurrentFolder(folder);
      setFiles(res.data.files || []); // Ensure files is always an array
      setIsLoading(false);
    } catch (err) {
      console.error("Error opening folder:", err);
      setError(`Impossible d'ouvrir le dossier ${folder}.`);
      setFiles([]); // Reset files to empty array on error
      setIsLoading(false);
    }
  };

  const downloadFile = async (fileUrl) => {
    try {
      // Get the presigned URL from backend
      const response = await api.get(fileUrl);
      const presignedUrl = response.data.url;

      // Create an invisible link to force download
      const link = document.createElement('a');
      link.href = presignedUrl;
      link.setAttribute('download', '');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error("Download error:", error);
      alert("Le téléchargement a échoué");
    }
  };

  const handleChatSubmit = async (e) => {
    e.preventDefault();
    const message = chatMessage.trim();
    if (!message || isSending) return;

    // Add user message to chat
    setChatMessages(prev => [...prev, { text: message, isBot: false }]);
    setChatMessage("");
    setIsSending(true);
    
    try {
      // Add a visual indicator that the bot is typing
      setChatMessages(prev => [...prev, { text: "...", isBot: true, isTyping: true }]);
      
      const response = await api.post('/chat', { message });
      
      // Remove typing indicator and add actual response
      setChatMessages(prev => {
        const filtered = prev.filter(msg => !msg.isTyping);
        return [...filtered, { text: response.data.response, isBot: true }];
      });
    } catch (error) {
      console.error('Chat error:', error);
      
      // Remove typing indicator and add error message
      setChatMessages(prev => {
        const filtered = prev.filter(msg => !msg.isTyping);
        return [...filtered, { 
          text: "Désolé, je ne peux pas répondre pour le moment.", 
          isBot: true,
          isError: true
        }];
      });
    } finally {
      setIsSending(false);
    }
  };

  const toggleChat = () => {
    setIsChatOpen(!isChatOpen);
    // Add welcome message if opening chat for first time
    if (!isChatOpen && chatMessages.length === 0) {
      setChatMessages([{ 
        text: "Bonjour ! Comment puis-je vous aider avec vos cours aujourd'hui ?", 
        isBot: true 
      }]);
    }
  };

  // Check if folders is defined and not empty
  if (isLoading && (!folders || folders.length === 0)) {
    return <div className="loading">Chargement des cours...</div>;
  }

  return (
    <div className="dashboard">
      <h1>Espace de cours</h1>
      
      {error && <div className="error-message">{error}</div>}
      
      {/* Folders grid */}
      {folders && folders.length > 0 ? (
        <div className="folders-grid">
          {folders.map((folder) => (
            <div 
              key={folder} 
              className={`folder-card ${currentFolder === folder ? 'active' : ''}`}
              onClick={() => openFolder(folder)}
            >
              <div className="folder-icon">📁</div>
              <div className="folder-name">{folder.replace('my-bucket/', '')}</div>
            </div>
          ))}
        </div>
      ) : !isLoading && (
        <div className="empty-state">Aucun cours disponible</div>
      )}

      {/* Files list */}
      {currentFolder && (
        <div className="files-container">
          <h2>
            <span className="folder-breadcrumb">{currentFolder}</span>
            <span className="file-count">({files && files.length} fichier{files && files.length !== 1 ? 's' : ''})</span>
          </h2>
          
          {files && files.length > 0 ? (
            <div className="files-list">
              {files.map((file) => (
                <div key={file.name} className="file-item">
                  <div className="file-info">
                    <span className="file-icon">📄</span>
                    <span className="file-name">{file.name}</span>
                    <span className="file-size">{formatFileSize(file.size)}</span>
                  </div>
                  <button 
                    className="download-button"
                    onClick={() => downloadFile(file.url)}
                  >
                    Télécharger
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">Aucun fichier dans ce dossier</div>
          )}
        </div>
      )}


      {/* Section Annonces */}
<div className="announcements-section">
  <div className="section-header">
    <h2>Annonces</h2>
  </div>
  
  <div className="announcements-list">
    {announcements.length > 0 ? (
      announcements.map(announcement => (
        <div key={announcement.id} className="announcement-card">
          <div className="announcement-header">
            <h3>{announcement.title}</h3>
            <span className="announcement-date">
              {formatDate(announcement.created_at)}
            </span>
          </div>
          <div className="announcement-author">
            Par: {announcement.author}
          </div>
          {announcement.target_folder && (
            <div className="announcement-target">
              Cours: {announcement.target_folder}
            </div>
          )}
          {/* Afficher le fichier associé s'il existe */}
          {announcement.target_file && (
            <div className="announcement-file">
              Fichier: <a href="#" onClick={(e) => {
                e.preventDefault();
                // Construire l'URL du fichier et le télécharger
                downloadFile(`/download/${announcement.target_folder}/${announcement.target_file}`);
              }}>{announcement.target_file}</a>
            </div>
          )}
          {announcement.event_date && (
            <div className="announcement-event-date">
              Date: {formatDate(announcement.event_date)}
            </div>
          )}
          <div className="announcement-content">
            {announcement.content}
          </div>
        </div>
      ))
    ) : (
      <div className="empty-state">Aucune annonce disponible</div>
    )}
  </div>
</div>

      {/* Chat widget */}
      <div className="chat-widget-container">
        <button 
          className={`chat-toggle ${isChatOpen ? 'active' : ''}`}
          onClick={toggleChat}
          aria-label="Ouvrir le chat"
        >
          {isChatOpen ? '✕' : '🤖'}
        </button>

        {isChatOpen && (
          <div className="chat-window">
            <div className="chat-header">
              <h3>Assistant IA</h3>
            </div>
            
            <div className="chat-messages">
              {chatMessages.map((msg, i) => (
                <div 
                  key={i} 
                  className={`message ${msg.isBot ? 'bot' : 'user'} ${msg.isTyping ? 'typing' : ''} ${msg.isError ? 'error' : ''}`}
                >
                  {msg.isTyping ? (
                    <div className="typing-indicator">
                      <span></span><span></span><span></span>
                    </div>
                  ) : msg.text}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            
            <form onSubmit={handleChatSubmit} className="chat-input-form">
              <input
                type="text"
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                placeholder="Posez votre question..."
                disabled={isSending}
              />
              <button 
                type="submit"
                disabled={isSending || !chatMessage.trim()}
              >
                {isSending ? '...' : '↑'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};

// Helper function to format file size
const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export default Dashboard;