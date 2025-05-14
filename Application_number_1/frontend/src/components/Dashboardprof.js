import React, { useEffect, useState, useRef } from "react";
import api from "../api";
import { useNavigate } from "react-router-dom";
import "./Dashboard.css";

const Dashboard = () => {
  const [folders, setFolders] = useState([]);
  const [currentFolder, setCurrentFolder] = useState(null);
  const [files, setFiles] = useState([]);
  const [uploadFile, setUploadFile] = useState(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [fileDescription, setFileDescription] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState(null);
  const [feedbackMessage, setFeedbackMessage] = useState(null);
  const [announcements, setAnnouncements] = useState([]);
  const [showAnnouncementForm, setShowAnnouncementForm] = useState(false);
  const [newAnnouncement, setNewAnnouncement] = useState({
    title: "",
    content: "",
    author: "",
    target_folder: "",
    target_file: "",  // Nouveau champ pour le fichier cible
    event_date: ""
  });
  // Nouvel état pour stocker les fichiers disponibles pour le dossier sélectionné dans le formulaire d'annonce
  const [announcementFolderFiles, setAnnouncementFolderFiles] = useState([]);
  // New state for file metadata
  const [selectedFileMetadata, setSelectedFileMetadata] = useState(null);
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(false);
  const [showMetadataModal, setShowMetadataModal] = useState(false);
  const navigate = useNavigate();
  
  // Chat state (carried over from student dashboard)
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessage, setChatMessage] = useState("");
  const [chatMessages, setChatMessages] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const metadataModalRef = useRef(null);

  // For automated feedback messages
  useEffect(() => {
    if (feedbackMessage) {
      const timer = setTimeout(() => {
        setFeedbackMessage(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [feedbackMessage]);

    // Close modal when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (metadataModalRef.current && !metadataModalRef.current.contains(event.target)) {
        setShowMetadataModal(false);
      }
    }

    // Only add the event listener if the modal is shown
    if (showMetadataModal) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showMetadataModal]);

  // Scroll to bottom of chat messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  useEffect(() => {
    const checkAuthAndLoadData = async () => {
      try {
        const token = localStorage.getItem("access_token");
        if (!token) {
          navigate("/");
          return;
        }
        
        setIsLoading(true);
        await loadFolders();
        setIsLoading(false);
      } catch (err) {
        console.error("Error during initialization:", err);
        setError("Impossible de charger les données. Veuillez réessayer.");
        setIsLoading(false);
        setFolders([]); // Reset folders to empty array on error
        
        // Only redirect if it's an auth error
        if (err.response && err.response.status === 401) {
          navigate("/");
        }
      }
    };
    
    checkAuthAndLoadData();
  }, [navigate]);

  const loadFolders = async () => {
    try {
      const res = await api.get("/courses");
      const folderList = res.data.folders || []; // Ensure we always have an array
      setFolders(folderList);
      return folderList;
    } catch (error) {
      console.error("Error loading folders:", error);
      if (error.response && error.response.status === 401) {
        navigate("/");
      }
      setFolders([]); // Reset folders to empty array on error
      throw error;
    }
  };

  const openFolder = async (folder) => {
    try {
      setIsLoading(true);
      const res = await api.get(`/courses/${folder}/files`);
      setCurrentFolder(folder);
      setFiles(res.data.files || []); // Ensure files is always an array
    } catch (error) {
      console.error("Error opening folder:", error);
      setError(`Impossible d'ouvrir le dossier ${folder}.`);
      setFiles([]); // Reset files to empty array on error
    } finally {
      setIsLoading(false);
    }
  };

  // New function to fetch file metadata
  const fetchFileMetadata = async (filePath) => {
    try {
      setIsLoadingMetadata(true);
      const response = await api.get(`/files/${filePath}/metadata`);
      console.log("Métadonnées reçues:", response.data.metadata);
      // Nettoyage des valeurs NULL ou undefined
      const cleanedMetadata = {
        ...response.data.metadata,
        description: response.data.metadata.description || "",
        uploaded_by: response.data.metadata.uploaded_by || "Non spécifié"
      };
      setSelectedFileMetadata(cleanedMetadata);
      setShowMetadataModal(true);
    } catch (error) {
      console.error("Error fetching file metadata:", error);
      setFeedbackMessage({
        type: "error",
        text: "Impossible de récupérer les métadonnées du fichier"
      });
      setSelectedFileMetadata(null);
    } finally {
      setIsLoadingMetadata(false);
    }
  };

  // Nouvelle fonction pour charger les fichiers d'un dossier spécifique pour le formulaire d'annonce
  const loadFolderFiles = async (folder) => {
    if (!folder) {
      setAnnouncementFolderFiles([]);
      return;
    }
    
    try {
      const res = await api.get(`/courses/${folder}/files`);
      setAnnouncementFolderFiles(res.data.files || []);
    } catch (error) {
      console.error("Error loading folder files for announcement:", error);
      setAnnouncementFolderFiles([]);
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
      
      setFeedbackMessage({
        type: "success",
        text: "Téléchargement démarré"
      });
    } catch (error) {
      console.error("Download error:", error);
      setFeedbackMessage({
        type: "error",
        text: "Le téléchargement a échoué"
      });
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setUploadFile(e.target.files[0]);
    }
  };

  const handleFileUpload = async () => {
    if (!uploadFile || !currentFolder) {
      setFeedbackMessage({
        type: "error",
        text: "Veuillez sélectionner un fichier et un dossier"
      });
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", uploadFile);
    formData.append("folder", currentFolder);
    formData.append("description", fileDescription);

    try {
      await api.post("/upload", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
          "Authorization": 'Bearer ${localStorage.getItem("access_token")}'
        },
      });
      
      // Refresh the file list
      openFolder(currentFolder);
      setUploadFile(null);
      setFileDescription("");
      
      // Reset file input field
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      
      setFeedbackMessage({
        type: "success",
        text: "Fichier téléversé avec succès"
      });
    } catch (error) {
      console.error("Upload error:", error);
      setFeedbackMessage({
        type: "error",
        text: error.response?.data?.detail || "Échec du téléversement"
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteFile = async (filePath) => {
    if (window.confirm("Êtes-vous sûr de vouloir supprimer ce fichier ?")) {
      try {
        await api.delete(`/files/${filePath}`);
        
        // Refresh the file list
        openFolder(currentFolder);
        
        setFeedbackMessage({
          type: "success",
          text: "Fichier supprimé avec succès"
        });
      } catch (error) {
        console.error("Delete error:", error);
        setFeedbackMessage({
          type: "error",
          text: error.response?.data?.detail || "Échec de la suppression"
        });
      }
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName) {
      setFeedbackMessage({
        type: "error",
        text: "Veuillez entrer un nom de dossier"
      });
      return;
    }

    try {
      setIsLoading(true);
      await api.post("/folders", {
        path: newFolderName
      });
      
      // Refresh folder list
      await loadFolders();
      setNewFolderName("");
      
      setFeedbackMessage({
        type: "success",
        text: "Dossier créé avec succès"
      });
    } catch (error) {
      console.error("Folder creation error:", error);
      setFeedbackMessage({
        type: "error",
        text: error.response?.data?.detail || "Échec de la création du dossier"
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Chat functionality (from student dashboard)
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
        text: "Bonjour ! Comment puis-je vous aider avec la gestion de vos cours aujourd'hui ?", 
        isBot: true 
      }]);
    }
  };

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
  
  // Fonction pour gérer les changements dans le formulaire d'annonce
  const handleAnnouncementChange = (e) => {
    const { name, value } = e.target;
    setNewAnnouncement({
      ...newAnnouncement,
      [name]: value
    });
    
    // Si le dossier cible change, charger les fichiers correspondants
    if (name === "target_folder" && value) {
      loadFolderFiles(value);
      // Réinitialiser le fichier sélectionné lorsqu'on change de dossier
      setNewAnnouncement(prev => ({
        ...prev,
        target_file: ""
      }));
    }
  };

  const handleDeleteAnnouncement = async (announcementId) => {
  if (window.confirm("Êtes-vous sûr de vouloir supprimer cette annonce ?")) {
    try {
      await api.delete(`/announcements/${announcementId}`);
      
      // Remove the announcement from the state
      setAnnouncements(announcements.filter(a => a.id !== announcementId));
      
      setFeedbackMessage({
        type: "success",
        text: "Annonce supprimée avec succès"
      });
    } catch (error) {
      console.error("Delete announcement error:", error);
      setFeedbackMessage({
        type: "error",
        text: error.response?.data?.detail || "Échec de la suppression"
      });
    }
  }
};
  
  // Fonction pour soumettre une nouvelle annonce
  const handleAnnouncementSubmit = async (e) => {
    e.preventDefault();
    
    // Vérifier si les champs requis sont remplis
    if (!newAnnouncement.title || !newAnnouncement.content || !newAnnouncement.author) {
      setFeedbackMessage({
        type: "error",
        text: "Veuillez remplir tous les champs obligatoires"
      });
      return;
    }
    
    try {
      setIsLoading(true);
      const response = await api.post('/announcements', newAnnouncement);
      
      // Ajouter la nouvelle annonce à la liste
      setAnnouncements([response.data.announcement, ...announcements]);
      
      // Réinitialiser le formulaire
      setNewAnnouncement({
        title: "",
        content: "",
        author: "",
        target_folder: "",
        target_file: "",
        event_date: ""
      });
      
      // Réinitialiser les fichiers du dossier
      setAnnouncementFolderFiles([]);
      
      // Fermer le formulaire
      setShowAnnouncementForm(false);
      
      setFeedbackMessage({
        type: "success",
        text: "Annonce créée et envoyée avec succès"
      });
    } catch (error) {
      console.error("Error creating announcement:", error);
      setFeedbackMessage({
        type: "error",
        text: error.response?.data?.detail || "Échec de la création de l'annonce"
      });
    } finally {
      setIsLoading(false);
    }
  };
  
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

  // Check if folders is defined before using length
  if (isLoading && (!folders || folders.length === 0)) {
    return <div className="loading">Chargement des cours...</div>;
  }

  return (
    <div className="dashboard professor-dashboard">
      <h1>Espace Professeur</h1>
      
      {error && <div className="error-message">{error}</div>}
      {feedbackMessage && (
        <div className={`feedback-message ${feedbackMessage.type}`}>
          {feedbackMessage.type === "success" ? "✓ " : "✕ "}
          {feedbackMessage.text}
        </div>
      )}
      
      {/* Create new folder section */}
      <div className="card new-folder-section">
        <h3>Créer un nouveau dossier</h3>
        <div className="folder-form">
          <input 
            type="text" 
            placeholder="Nom du dossier (ex: filiere/semestre/module)" 
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
          />
          <button 
            className="primary-button"
            onClick={handleCreateFolder}
            disabled={isLoading || !newFolderName.trim()}
          >
            {isLoading ? "Création..." : "Créer"}
          </button>
        </div>
      </div>
      
      {/* Folders grid */}
      <h2>Mes dossiers</h2>
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
        <div className="empty-state">Aucun dossier disponible</div>
      )}

      {/* Upload file section */}
      {currentFolder && (
        <div className="card upload-section">
          <h3>Ajouter un fichier à {currentFolder}</h3>
          <div className="upload-form">
            <div className="file-input-container">
              <input 
                ref={fileInputRef}
                id="file-upload"
                type="file" 
                onChange={handleFileChange}
                disabled={isUploading}
              />
              <label className="file-label" htmlFor="file-upload">
                {uploadFile ? uploadFile.name : "Choisir un fichier"}
              </label>
            </div>
          </div>

          {uploadFile && (
            <div className="selected-file">
              <span>Fichier sélectionné: {uploadFile.name}</span>
              <span className="file-size">({formatFileSize(uploadFile.size)})</span>
            </div>
          )}

          {/* Champ pour la description du fichier */}
          {uploadFile && (
            <div className="file-description-container">
              <label htmlFor="file-description">Description du fichier (optionnel):</label>
              <textarea
                id="file-description"
                className="file-description-input"
                value={fileDescription}
                onChange={(e) => setFileDescription(e.target.value)}
                placeholder="Ajoutez une description pour ce fichier..."
                rows={3}
                disabled={isUploading}
              />
            </div>
          )}
          {uploadFile && (
            <div className="upload-button-container">
              <button 
                className="primary-button"
                onClick={handleFileUpload}
                disabled={isUploading}
              >
                {isUploading ? (
                  <span className="loading-spinner">
                    <span className="spinner-dot"></span>
                    <span className="spinner-dot"></span>
                    <span className="spinner-dot"></span>
                  </span>
                ) : (
                  "Téléverser"
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Files list */}
      {currentFolder && (
        <div className="card files-container">
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
                  <div className="file-actions">
                    <button 
                      className="action-button info-button"
                      onClick={() => fetchFileMetadata(`${currentFolder}/${file.name}`)}
                      disabled={isLoadingMetadata}
                    >
                      {isLoadingMetadata ? "..." : "Métadonnées"}
                    </button>
                    <button 
                      className="action-button download-button"
                      onClick={() => downloadFile(file.url)}
                    >
                      Télécharger
                    </button>
                    <button 
                      className="action-button delete-button"
                      onClick={() => handleDeleteFile(`${currentFolder}/${file.name}`)}
                    >
                      Supprimer
                    </button>
                  </div>
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
          <button 
            className="primary-button"
            onClick={() => setShowAnnouncementForm(!showAnnouncementForm)}
          >
            {showAnnouncementForm ? "Annuler" : "Nouvelle annonce"}
          </button>
        </div>
        
        {showAnnouncementForm && (
          <div className="card announcement-form">
            <h3>Créer une nouvelle annonce</h3>
            <form onSubmit={handleAnnouncementSubmit}>
              <div className="form-group">
                <label htmlFor="author">Votre nom</label>
                <input
                  type="text"
                  id="author"
                  name="author"
                  value={newAnnouncement.author}
                  onChange={handleAnnouncementChange}
                  placeholder="Prénom NOM"
                  required
                />
              </div>
              
              <div className="form-group">
                <label htmlFor="title">Titre</label>
                <input
                  type="text"
                  id="title"
                  name="title"
                  value={newAnnouncement.title}
                  onChange={handleAnnouncementChange}
                  placeholder="Titre de l'annonce"
                  required
                />
              </div>
              
              <div className="form-group">
                <label htmlFor="content">Contenu</label>
                <textarea
                  id="content"
                  name="content"
                  value={newAnnouncement.content}
                  onChange={handleAnnouncementChange}
                  placeholder="Détails de l'annonce"
                  rows={4}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="target_folder">Dossier associé (optionnel)</label>
                <select
                  id="target_folder"
                  name="target_folder"
                  value={newAnnouncement.target_folder}
                  onChange={handleAnnouncementChange}
                >
                  <option value="">Aucun dossier</option>
                  {folders.map((folder) => (
                    <option key={folder} value={folder}>
                      {folder}
                    </option>
                  ))}
                </select>
              </div>

              {newAnnouncement.target_folder && (
                <div className="form-group">
                  <label htmlFor="target_file">Fichier associé (optionnel)</label>
                  <select
                    id="target_file"
                    name="target_file"
                    value={newAnnouncement.target_file}
                    onChange={handleAnnouncementChange}
                  >
                    <option value="">Aucun fichier</option>
                    {announcementFolderFiles.map((file) => (
                      <option key={file.name} value={file.name}>
                        {file.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="form-group">
                <label htmlFor="event_date">Date de l'événement (optionnel)</label>
                <input
                  type="datetime-local"
                  id="event_date"
                  name="event_date"
                  value={newAnnouncement.event_date}
                  onChange={handleAnnouncementChange}
                />
              </div>
              
              <div className="form-actions">
                <button 
                  type="submit" 
                  className="primary-button"
                  disabled={isLoading}
                >
                  {isLoading ? "Envoi..." : "Publier l'annonce"}
                </button>
              </div>
            </form>
          </div>
        )}
        
        <div className="announcements-list">
          {announcements.length > 0 ? (
            announcements.map(announcement => (
              <div key={announcement.id} className="announcement-card">
                <div className="announcement-header">
                  <h3>{announcement.title}</h3>
                  <div className="announcement-actions">
                  <span className="announcement-date">
                    {formatDate(announcement.created_at)}
                  </span>
                  <button 
                    className="action-button delete-button"
                    onClick={() => handleDeleteAnnouncement(announcement.id)}
                  >
                    Supprimer
                  </button>
                </div>
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

      {/* Metadata Modal */}
      {showMetadataModal && selectedFileMetadata && (
        <div className="metadata-modal-overlay">
          <div className="metadata-modal" ref={metadataModalRef}>
            <div className="metadata-modal-header">
              <h3>Métadonnées du fichier</h3>
              <button 
                className="close-button"
                onClick={() => setShowMetadataModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="metadata-modal-content">
              <div className="metadata-item">
                <span className="metadata-label">Nom du fichier:</span>
                <span className="metadata-value">{selectedFileMetadata.original_filename || "Non disponible"}</span>
              </div>
              <div className="metadata-item">
                <span className="metadata-label">UUID:</span>
                <span className="metadata-value">{selectedFileMetadata.file_uuid || "Non disponible"}</span>
              </div>
              <div className="metadata-item">
                <span className="metadata-label">Chemin de stockage:</span>
                <span className="metadata-value">{selectedFileMetadata.storage_path || "Non disponible"}</span>
              </div>
              <div className="metadata-item">
                <span className="metadata-label">Type:</span>
                <span className="metadata-value">{selectedFileMetadata.content_type || "Non disponible"}</span>
              </div>
              <div className="metadata-item">
                <span className="metadata-label">Taille:</span>
                <span className="metadata-value">
                  {selectedFileMetadata.file_size ? formatFileSize(selectedFileMetadata.file_size) : "0"}
                </span>
              </div>
              <div className="metadata-item">
                <span className="metadata-label">Téléversé par:</span>
                <span className="metadata-value">{selectedFileMetadata.uploaded_by || "Non spécifié"}</span>
              </div>
              <div className="metadata-item">
                <span className="metadata-label">Date de téléversement:</span>
                <span className="metadata-value">
                  {selectedFileMetadata.upload_date ? formatDate(selectedFileMetadata.upload_date) : "Non disponible"}
                </span>
              </div>
              <div className="metadata-item">
                <span className="metadata-label">Description:</span>
                <span className="metadata-value">
                  {selectedFileMetadata.description ? selectedFileMetadata.description : "Aucune description"}
                </span>
              </div>
              {/* Ajoutez d'autres métadonnées au besoin */}
            </div>
          </div>
        </div>
      )}

      {/* Chat widget (from student dashboard) */}
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