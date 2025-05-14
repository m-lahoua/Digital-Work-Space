from fastapi import FastAPI, HTTPException, Response, Depends, Request, File, UploadFile, Form
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv
import requests
import io
import uuid
import shortuuid
import os
from minio import Minio
from minio.error import S3Error
from minio.commonconfig import REPLACE
from datetime import timedelta, datetime
from jose import JWTError
import jwt
from jwt import PyJWKClient, get_unverified_header
import logging
from fastapi import BackgroundTasks
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import List, Optional
import psycopg2
from psycopg2.extras import RealDictCursor
from contextlib import contextmanager

app = FastAPI()
load_dotenv()
security = HTTPBearer()

@contextmanager
def get_db_connection():
    """Context manager for database connections"""
    conn = None
    try:
        conn = psycopg2.connect(
            host=os.getenv("DB_HOST"),
            database=os.getenv("DB_NAME"),
            user=os.getenv("DB_USER"),
            password=os.getenv("DB_PASSWORD")
        )
        conn.autocommit = True
        yield conn
    except Exception as e:
        logger.error(f"Database connection error: {str(e)}")
        raise
    finally:
        if conn is not None:
            conn.close()

@contextmanager
def get_metadata_db_connection():
    """Context manager for metadata database connections"""
    conn = None
    try:
        conn = psycopg2.connect(
            host=os.getenv("DB_HOST"),
            database=os.getenv("DB_NAME2"),  # Using the metadata database
            user=os.getenv("DB_USER"),
            password=os.getenv("DB_PASSWORD")
        )
        conn.autocommit = True
        yield conn
    except Exception as e:
        logger.error(f"Metadata database connection error: {str(e)}")
        raise
    finally:
        if conn is not None:
            conn.close()


# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Configuration CORS (à ajouter avant les routes)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # Adresse de votre frontend React
    allow_credentials=True,
    allow_methods=["*"],  # Autoriser toutes les méthodes (POST, GET, etc.)
    allow_headers=["*"],  # Autoriser tous les headers
)


# Définir le modèle d'annonce
class Announcement(BaseModel):
    id: str = Field(default_factory=lambda: shortuuid.uuid())
    title: str
    content: str
    author: str
    created_at: datetime = Field(default_factory=datetime.now)
    target_folder: Optional[str] = None  # Pour cibler un cours spécifique (optionnel)
    event_date: Optional[datetime] = None  # Date de l'événement (optionnel, pour les examens)



# Modèle Pydantic pour les credentials
class LoginRequest(BaseModel):
    username: str
    password: str

KEYCLOAK_URL = os.getenv("KEYCLOAK_URL")
REALM = os.getenv("KEYCLOAK_REALM")
ADMIN_USER = os.getenv("KEYCLOAK_ADMIN")
ADMIN_PASSWORD = os.getenv("KEYCLOAK_ADMIN_PASSWORD")
KEYCLOAK_CLIENT_SECRET = os.getenv("KEYCLOAK_CLIENT_SECRET")



async def get_admin_token():
    data = {
        "grant_type": "password",
        "client_id": "admin-cli",
        "username": ADMIN_USER,
        "password": ADMIN_PASSWORD
    }
    response = requests.post(
        f"{KEYCLOAK_URL}/realms/master/protocol/openid-connect/token",
        data=data
    )
    return response.json()["access_token"]


async def get_current_user_roles(request: Request, credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        token = credentials.credentials
        logger.debug(f"Processing token: {token[:10]}...")
        
        # Try to extract roles directly from JWT without verification (for debugging)
        try:
            unverified_payload = jwt.decode(token, options={"verify_signature": False})
            logger.debug(f"Unverified payload: {unverified_payload}")
        except Exception as e:
            logger.debug(f"Could not decode unverified token: {str(e)}")
        
        # Now perform the real verification
        try:
            jwks_url = f"{KEYCLOAK_URL}/realms/{REALM}/protocol/openid-connect/certs"
            logger.debug(f"JWKS URL: {jwks_url}")
            
            jwks_client = PyJWKClient(jwks_url)
            signing_key = jwks_client.get_signing_key_from_jwt(token)
            
            payload = jwt.decode(
                token,
                key=signing_key.key,
                algorithms=["RS256"],
                options={
                    "verify_aud": False,  # For debugging, we'll be less strict
                    "verify_exp": True,
                    "verify_signature": True
                }
            )
            
            roles = payload.get("realm_access", {}).get("roles", [])
            logger.debug(f"Extracted roles: {roles}")
            return roles
        except Exception as e:
            logger.error(f"JWT verification error: {str(e)}")
            raise
            
    except JWTError as e:
        logger.error(f"JWT Error: {str(e)}")
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")
    except Exception as e:
        logger.error(f"Authentication error: {str(e)}")
        raise HTTPException(status_code=401, detail=f"Not authenticated: {str(e)}")



# Configuration email
EMAIL_HOST = os.getenv("EMAIL_HOST", "smtp.gmail.com")
EMAIL_PORT = int(os.getenv("EMAIL_PORT", "587"))
EMAIL_USERNAME = os.getenv("EMAIL_USERNAME")
EMAIL_PASSWORD = os.getenv("EMAIL_PASSWORD")
EMAIL_FROM = os.getenv("EMAIL_FROM", EMAIL_USERNAME)


async def get_student_emails():
    try:
        # Obtenir le token admin pour accéder à l'API Keycloak
        admin_token = await get_admin_token()
        headers = {"Authorization": f"Bearer {admin_token}"}
        
        # Récupérer les utilisateurs avec le rôle "etudiant"
        # 1. D'abord, obtenez l'ID du rôle "etudiant"
        role_response = requests.get(
            f"{KEYCLOAK_URL}/admin/realms/{REALM}/roles/etudiant",
            headers=headers
        )
        if role_response.status_code != 200:
            logger.error("Impossible de récupérer le rôle 'etudiant'")
            return []
            
        etudiant_role_id = role_response.json()["id"]
        
        # 2. Récupérer les utilisateurs qui ont ce rôle
        users_response = requests.get(
            f"{KEYCLOAK_URL}/admin/realms/{REALM}/roles/etudiant/users",
            headers=headers
        )
        
        if users_response.status_code != 200:
            logger.error("Impossible de récupérer les utilisateurs avec le rôle 'etudiant'")
            return []
        
        # Extraire les emails
        student_emails = []
        for user in users_response.json():
            if "email" in user and user["email"]:
                student_emails.append(user["email"])
                
        return student_emails
        
    except Exception as e:
        logger.error(f"Erreur lors de la récupération des emails étudiants: {str(e)}")
        return []


async def send_notification_email(background_tasks: BackgroundTasks, folder: str, file_name: str):
    student_emails = await get_student_emails()
    
    if not student_emails:
        logger.warning("Aucun email étudiant trouvé pour l'envoi de notifications")
        return
    
    # Envoi des emails en arrière-plan pour ne pas bloquer la réponse API
    background_tasks.add_task(
        send_emails_to_students,
        student_emails, 
        folder, 
        file_name
    )
    
async def send_emails_to_students(recipients: list, folder: str, file_name: str):
    try:
        # Configuration du serveur SMTP
        server = smtplib.SMTP(EMAIL_HOST, EMAIL_PORT)
        server.starttls()
        server.login(EMAIL_USERNAME, EMAIL_PASSWORD)
        
        # Création du message
        subject = f"Nouveau document disponible : {file_name}"
        body = f"""
        <html>
        <body>
            <h2>Nouveau document disponible</h2>
            <p>Un nouveau document a été ajouté au dossier <b>{folder}</b> :</p>
            <p><b>{file_name}</b></p>
            <p>Vous pouvez le consulter en vous connectant à la plateforme.</p>
        </body>
        </html>
        """
        
        # Envoi à tous les destinataires (utiliser BCC pour la confidentialité)
        msg = MIMEMultipart()
        msg['From'] = EMAIL_FROM
        msg['Subject'] = subject
        msg['Bcc'] = ", ".join(recipients)  # Utiliser BCC pour masquer les adresses
        
        msg.attach(MIMEText(body, 'html'))
        
        server.send_message(msg)
        server.quit()
        
        logger.info(f"Notification envoyée à {len(recipients)} étudiants")
        
    except Exception as e:
        logger.error(f"Erreur lors de l'envoi des emails: {str(e)}")



@app.get("/api/check-role/{required_role}")
async def check_role(required_role: str, roles: list = Depends(get_current_user_roles)):
    if required_role not in roles:
        raise HTTPException(status_code=403, detail="Accès refusé")
    return {"status":"success"}



# Endpoint de login
@app.post("/login")
async def login(credentials: LoginRequest, response:Response):
    try:
        # Appel à Keycloak
        keycloak_response = requests.post(
            f"{os.getenv('KEYCLOAK_URL')}/realms/{os.getenv('KEYCLOAK_REALM')}/protocol/openid-connect/token",
            data={
                "grant_type": "password",
                "client_id": "ENT",
                "client_secret": os.getenv("KEYCLOAK_CLIENT_SECRET"),
                "username": credentials.username,
                "password": credentials.password
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"}
        )
        keycloak_response.raise_for_status()
        token_data=keycloak_response.json()

        # Définir le cookie HTTP-Only
        response.set_cookie(
            key="access_token",
            value=token_data["access_token"],
            httponly=True,
            secure=True,  # En production uniquement (HTTPS)
            samesite="Lax",
            max_age=3600  # Expiration en secondes
        )
        return token_data

    except requests.exceptions.HTTPError as e:
        error_msg = e.response.json().get("error_description", "")
        
        # Gestion des erreurs spécifiques
        if "Account disabled" in error_msg:
            raise HTTPException(
                status_code=403,
                detail="Votre compte n'est pas encore activé"
            )
            
        raise HTTPException(
            status_code=400,
            detail="Identifiants incorrects"
        )

	



@app.post("/signup")
async def signup(user_data: dict):
    try:
        # 1. Création de l'utilisateur
        admin_token = await get_admin_token()
        headers = {
            "Authorization": f"Bearer {admin_token}",
            "Content-Type": "application/json"
        }
        
        # Validation des données
        required_fields = ["username", "email", "firstName", "lastName", "password", "role"]
        for field in required_fields:
            if field not in user_data:
                raise HTTPException(status_code=400, detail=f"Champ manquant: {field}")

        # 2. Création du payload utilisateur
        user_payload = {
            "username": user_data["username"],
            "email": user_data["email"],
            "firstName": user_data["firstName"],
            "lastName": user_data["lastName"],
            "enabled": user_data.get("enabled", False),
            "emailVerified": user_data.get("emailVerified", False),
            "credentials": [{
                "type": "password",
                "value": user_data["password"],
                "temporary": False
            }]
        }

        # 3. Création de l'utilisateur dans Keycloak
        response = requests.post(
            f"{KEYCLOAK_URL}/admin/realms/{REALM}/users",
            json=user_payload,
            headers=headers
        )
        
        if response.status_code != 201:
            error = response.json().get("errorMessage", "Erreur inconnue de Keycloak")
            raise HTTPException(status_code=400, detail=error)

        # 4. Récupération de l'ID utilisateur
        user_id = response.headers["Location"].split("/")[-1]

        # 5. Gestion des rôles
        role_name = user_data["role"]
        allowed_roles = ["etudiant", "prof"]
        
        if role_name not in allowed_roles:
            raise HTTPException(status_code=400, detail="Rôle invalide. Choix possibles: etudiant, prof")

        # Récupération du rôle depuis Keycloak
        role_response = requests.get(
            f"{KEYCLOAK_URL}/admin/realms/{REALM}/roles/{role_name}",
            headers=headers
        )
        
        if role_response.status_code != 200:
            raise HTTPException(status_code=400, detail="Ce rôle n'existe pas dans Keycloak")

        role_data = role_response.json()

        # Assignation du rôle
        assignment_response = requests.post(
            f"{KEYCLOAK_URL}/admin/realms/{REALM}/users/{user_id}/role-mappings/realm",
            json=[role_data],
            headers=headers
        )

        if assignment_response.status_code != 204:
            raise HTTPException(status_code=500, detail="Échec de l'assignation du rôle")

        return {"status": "success", "message": "Utilisateur créé avec succès"}

    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur serveur: {str(e)}")

# Configuration MinIO
minio_client = Minio(
    "localhost:9000",
    access_key=os.getenv("MINIO_ROOT_USER"),
    secret_key=os.getenv("MINIO_ROOT_PASSWORD"),
    secure=False
)

@app.get("/courses")
async def list_courses():
    try:
        folders = set()
        objects = minio_client.list_objects("my-bucket", recursive=True)
        for obj in objects:
            parts = obj.object_name.split('/')
            if len(parts) > 1:
                # Récupère le chemin complet du dossier parent
                folder_path = '/'.join(parts[:-1])
                folders.add(folder_path)
        return {"folders": list(folders)}
    except S3Error as e:
        raise HTTPException(status_code=500, detail=str(e))




@app.get("/courses/{folder:path}/files")
async def list_files(folder: str):
    try:
        files = []
        objects = minio_client.list_objects("my-bucket", prefix=f"{folder}/")
        for obj in objects:
            files.append({
                "name": obj.object_name.split('/')[-1],
                "size": obj.size,
                "url": f"/download/{obj.object_name}"
            })
        return {"files": files}
    except S3Error as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/download/{file_path:path}")
async def generate_download_url(file_path: str):
    try:
        file_name = file_path.split('/')[-1]
        url = minio_client.get_presigned_url(
            "GET",
            "my-bucket",
            file_path,
	    response_headers={
                "response-content-disposition":f"attachement; filename={file_name}"
            },
            expires=timedelta(hours=1))
        return {"url": url}
    except S3Error as e:
        raise HTTPException(status_code=404, detail="File not found")


# Endpoint pour uploader un fichier
@app.post("/upload")
async def upload_file(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...), 
    folder: str = Form(...),
    description: str = Form(""),  
    roles: list = Depends(get_current_user_roles)
):
    
    logger.debug(f"Upload attempt: file={file.filename}, folder={folder}, roles={roles}")

    # Verify if user is a professor
    if "prof" not in roles:
        logger.warning(f"Unauthorized upload attempt with roles: {roles}")
        raise HTTPException(status_code=403, detail="Seuls les professeurs peuvent téléverser des fichiers")
    
    try:
        # Generate unique identifier to avoid name collisions
        file_uuid = shortuuid.uuid()[:8]
        file_name = f"{file_uuid}_{file.filename}"
        file_path = f"{folder}/{file_name}"
        
        # Read file content
        content = await file.read()
        file_size = len(content)
        
        # Upload file to MinIO
        minio_client.put_object(
            bucket_name="my-bucket",
            object_name=file_path,
            data=io.BytesIO(content),
            length=file_size,
            content_type=file.content_type
        )

        # Extract username from JWT token (assuming we have access to it)
        auth_header = request.headers.get("Authorization")
        token = None
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]
        
        # S'assurer que l'uploader n'est jamais null
        uploader = "unknown"
        if token:
            try:
                payload = jwt.decode(token, options={"verify_signature": False}, algorithms=["RS256"])
                uploader = payload.get("name") or payload.get("sub") or "unknown"
                logger.debug(f"Uploader extrait : {uploader}")
            except Exception as e:
                logger.error(f"Erreur lors de l'extraction du nom d'utilisateur: {str(e)}")
            
            
        # S'assurer que description n'est jamais null
        if description is None:
            description = ""
        
        # Store metadata in database
        with get_metadata_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO files_metadata 
                    (file_uuid, original_filename, storage_path, file_size, 
                     content_type, uploaded_by, folder_path, description)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id;
                """, (
                    file_uuid, 
                    file.filename, 
                    file_path, 
                    file_size, 
                    file.content_type, 
                    uploader, 
                    folder, 
                    description
                ))
                metadata_id = cur.fetchone()[0]
                logger.debug(f"File metadata stored with ID: {metadata_id}")

        # Send notification to students
        await send_notification_email(background_tasks, folder, file.filename)
        
        logger.debug(f"File uploaded successfully: {file_path}")
        return {"status": "success", "path": file_path, "metadata_id": metadata_id}
    
    except S3Error as e:
        logger.error(f"MinIO error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Erreur MinIO: {str(e)}")
    except psycopg2.Error as e:
        logger.error(f"Database error: {str(e)}")
        # Try to delete the file from MinIO if metadata storage fails
        try:
            minio_client.remove_object("my-bucket", file_path)
        except:
            pass
        raise HTTPException(status_code=500, detail=f"Erreur de base de données: {str(e)}")
    except Exception as e:
        logger.error(f"Server error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Erreur serveur: {str(e)}")

# Endpoint pour supprimer un fichier
@app.delete("/files/{file_path:path}")
async def delete_file(file_path: str, roles: list = Depends(get_current_user_roles)):
    logger.debug(f"Delete request for file: {file_path}")
    logger.debug(f"User roles: {roles}")
    
    # Check professor role
    if "prof" not in roles:
        logger.warning(f"Unauthorized delete attempt with roles: {roles}")
        raise HTTPException(status_code=403, detail="Seuls les professeurs peuvent supprimer des fichiers")
    
    try:
        logger.debug(f"Checking if file exists: {file_path}")
        
        # Check if file exists first
        try:
            minio_client.stat_object("my-bucket", file_path)
            logger.debug("File found, proceeding with deletion")
        except S3Error as e:
            logger.error(f"MinIO error when checking file: {str(e)}")
            if e.code == 'NoSuchKey' or e.code == 'NoSuchObject':
                raise HTTPException(status_code=404, detail=f"Fichier non trouvé: {file_path}")
            raise
        
        # Extract file_uuid from the file_path
        # The format is folder/file_uuid_original_filename
        try:
            path_parts = file_path.split('/')
            file_name_parts = path_parts[-1].split('_', 1)
            file_uuid = file_name_parts[0]
            logger.debug(f"Extracted file_uuid: {file_uuid}")
        except Exception as e:
            logger.error(f"Error extracting file_uuid: {str(e)}")
            file_uuid = None
        
        # Delete metadata from database if we have a file_uuid
        if file_uuid:
            try:
                with get_metadata_db_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute("""
                            DELETE FROM files_metadata 
                            WHERE file_uuid = %s AND storage_path = %s
                            RETURNING id;
                        """, (file_uuid, file_path))
                        
                        result = cur.fetchone()
                        if result:
                            logger.debug(f"Deleted metadata with ID: {result[0]}")
                        else:
                            logger.warning(f"No metadata found for file_uuid: {file_uuid}")
            except Exception as e:
                logger.error(f"Error deleting metadata: {str(e)}")
                # Continue with file deletion even if metadata deletion fails
        
        # Delete the file from MinIO
        logger.debug("Attempting to remove file from storage")
        minio_client.remove_object("my-bucket", file_path)
        logger.debug("File deleted successfully")
        
        return {"status": "success", "message": "Fichier et métadonnées supprimés avec succès"}
    
    except HTTPException as e:
        raise e
    except S3Error as e:
        logger.error(f"MinIO error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Erreur MinIO: {str(e)}")
    except Exception as e:
        logger.error(f"Server error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Erreur serveur: {str(e)}")

# Endpoint pour créer un nouveau dossier (optionnel mais utile)
@app.post("/folders")
async def create_folder(folder_data: dict, roles: list = Depends(get_current_user_roles)):
    # Vérifier si l'utilisateur est un professeur
    if "prof" not in roles:
        raise HTTPException(status_code=403, detail="Seuls les professeurs peuvent créer des dossiers")
    
    try:
        folder_path = folder_data.get("path")
        if not folder_path:
            raise HTTPException(status_code=400, detail="Chemin du dossier manquant")
        
        # En MinIO, les dossiers sont virtuels, on crée donc un fichier vide avec un nom de chemin
        minio_client.put_object(
            bucket_name="my-bucket",
            object_name=f"{folder_path}/.folder",  # Fichier caché pour représenter le dossier
            data=io.BytesIO(b""),
            length=0
        )
        
        return {"status": "success", "path": folder_path}
    
    except S3Error as e:
        raise HTTPException(status_code=500, detail=f"Erreur MinIO: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur serveur: {str(e)}")


@app.post("/chat")
async def chat_endpoint(
    request: dict, 
    roles: list = Depends(get_current_user_roles)
):
    message = request.get("message")
    if not message:
        raise HTTPException(status_code=400, detail="Message is required")
    
    # Optional: chat history management
    conversation_id = request.get("conversation_id", str(uuid.uuid4()))
    
    logger.debug(f"Chat request from user with roles: {roles}")
    
    try:
        # Send request to Ollama API
        logger.debug(f"Sending request to Ollama API with model: tinyllama")
        response = requests.post(
            "http://localhost:11434/api/generate",
            json={
                "model": "tinyllama",
                "prompt": message,
                "stream": False
                # You could add context here if implementing history
                # "context": previous_context
            },
            timeout=30  # Add timeout to prevent hanging requests
        )
        
        if response.status_code != 200:
            logger.error(f"Ollama API error: {response.status_code} - {response.text}")
            raise HTTPException(
                status_code=500, 
                detail="Error communicating with AI service"
            )
            
        result = response.json()
        logger.debug(f"Received response from Ollama API")
        
        return {
            "response": result["response"],
            "conversation_id": conversation_id
            # If implementing history: "context": result.get("context", None)
        }
        
    except requests.exceptions.Timeout:
        logger.error("Request to Ollama API timed out")
        raise HTTPException(status_code=504, detail="AI service timed out")
    except requests.exceptions.ConnectionError:
        logger.error("Connection error to Ollama API")
        raise HTTPException(status_code=503, detail="AI service unavailable")
    except Exception as e:
        logger.error(f"Chat endpoint error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")


# Initialize database tables on startup
@app.on_event("startup")
async def initialize_database():
    """Create necessary tables if they don't exist"""
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                # Create announcements table
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS announcements (
                        id VARCHAR(22) PRIMARY KEY,
                        title VARCHAR(255) NOT NULL,
                        content TEXT NOT NULL,
                        author VARCHAR(100) NOT NULL,
                        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        target_folder VARCHAR(255),
                        target_file VARCHAR(255),
                        event_date TIMESTAMP
                    );
                    
                    CREATE INDEX IF NOT EXISTS idx_announcements_created_at 
                    ON announcements(created_at);
                """)
        logger.info("Database initialized successfully")
    except Exception as e:
        logger.error(f"Database initialization error: {str(e)}")


# Replace the create_announcement function
@app.post("/announcements")
async def create_announcement(
    announcement_data: dict,
    background_tasks: BackgroundTasks,
    roles: list = Depends(get_current_user_roles)
):
    # Vérifier si l'utilisateur est un professeur
    if "prof" not in roles:
        raise HTTPException(status_code=403, detail="Seuls les professeurs peuvent créer des annonces")
    
    try:
        # Create a new announcement ID
        announcement_id = shortuuid.uuid()
        
        # Extract announcement data with defaults
        title = announcement_data["title"]
        content = announcement_data["content"]
        author = announcement_data["author"]
        target_folder = announcement_data.get("target_folder")
        target_file = announcement_data.get("target_file")
        event_date = announcement_data.get("event_date")
        
        if not title or not content or not author:
            raise HTTPException(status_code=400, detail="Titre, contenu et auteur requis")

        # Insert into database
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    INSERT INTO announcements 
                    (id, title, content, author, target_folder, target_file, event_date)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    RETURNING id, title, content, author, created_at, target_folder, target_file, event_date
                """, (
                    announcement_id, title, content, author, 
                    target_folder, target_file, event_date
                ))
                new_announcement = cur.fetchone()
        
        # Envoyer des notifications par email aux étudiants
        background_tasks.add_task(
            send_announcement_emails,
            title,
            content,
            author,
            event_date
        )
        
        return {"status": "success", "announcement": dict(new_announcement)}
    
    except Exception as e:
        logger.error(f"Erreur lors de la création d'une annonce: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Erreur serveur: {str(e)}")

# Replace the get_announcements function
@app.get("/announcements")
async def get_announcements(
    roles: list = Depends(get_current_user_roles)
):
    # Tous les utilisateurs authentifiés peuvent voir les annonces
    if not roles:
        raise HTTPException(status_code=401, detail="Authentification requise")
    
    try:
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT id, title, content, author, created_at, 
                           target_folder, target_file, event_date
                    FROM announcements
                    ORDER BY created_at DESC
                """)
                announcements = cur.fetchall()
        
        # Convert to list of dictionaries
        return {"announcements": [dict(announcement) for announcement in announcements]}
    
    except Exception as e:
        logger.error(f"Error retrieving announcements: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

# Add a new endpoint to delete announcements (optional but useful)
@app.delete("/announcements/{announcement_id}")
async def delete_announcement(
    announcement_id: str,
    roles: list = Depends(get_current_user_roles)
):
    # Verify professor role
    if "prof" not in roles:
        raise HTTPException(status_code=403, detail="Seuls les professeurs peuvent supprimer des annonces")
    
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM announcements WHERE id = %s", (announcement_id,))
                if cur.rowcount == 0:
                    raise HTTPException(status_code=404, detail="Annonce non trouvée")
                
        return {"status": "success", "message": "Annonce supprimée avec succès"}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting announcement: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

# Fonction pour envoyer des emails d'annonce aux étudiants
def send_announcement_emails(title, content, author, event_date=None):
    try:
        def get_admin_token_sync():
            data = {
                "grant_type": "password",
                "client_id": "admin-cli",
                "username": ADMIN_USER,
                "password": ADMIN_PASSWORD
            }
            response = requests.post(
                f"{KEYCLOAK_URL}/realms/master/protocol/openid-connect/token",
                data=data
            )
            return response.json()["access_token"]
            
        # Récupérer les emails des étudiants de manière synchrone
        def get_student_emails_sync():
            try:
                # Obtenir le token admin pour accéder à l'API Keycloak
                admin_token = get_admin_token_sync()
                headers = {"Authorization": f"Bearer {admin_token}"}
                
                # Récupérer le rôle "etudiant"
                role_response = requests.get(
                    f"{KEYCLOAK_URL}/admin/realms/{REALM}/roles/etudiant",
                    headers=headers
                )
                if role_response.status_code != 200:
                    logger.error("Impossible de récupérer le rôle 'etudiant'")
                    return []
                    
                etudiant_role_id = role_response.json()["id"]
                
                # Récupérer les utilisateurs avec ce rôle
                users_response = requests.get(
                    f"{KEYCLOAK_URL}/admin/realms/{REALM}/roles/etudiant/users",
                    headers=headers
                )
                
                if users_response.status_code != 200:
                    logger.error("Impossible de récupérer les utilisateurs avec le rôle 'etudiant'")
                    return []
                
                # Extraire les emails
                student_emails = []
                for user in users_response.json():
                    if "email" in user and user["email"]:
                        student_emails.append(user["email"])
                        
                return student_emails
                
            except Exception as e:
                logger.error(f"Erreur lors de la récupération des emails étudiants: {str(e)}")
                return []
        
        # Récupérer les emails des étudiants
        student_emails = get_student_emails_sync()
        
        if not student_emails:
            logger.warning("Aucun email étudiant trouvé pour l'envoi d'annonces")
            return
        
        # Log pour débogage
        logger.info(f"Tentative d'envoi d'emails à {len(student_emails)} étudiants")
        
        # Configuration du serveur SMTP avec plus de logs
        logger.debug(f"Connexion SMTP à {EMAIL_HOST}:{EMAIL_PORT}")
        server = smtplib.SMTP(EMAIL_HOST, EMAIL_PORT)
        server.set_debuglevel(1)  # Active les logs SMTP détaillés
        server.starttls()
        logger.debug(f"Tentative de login avec {EMAIL_USERNAME}")
        server.login(EMAIL_USERNAME, EMAIL_PASSWORD)
        
        # Création du message
        msg = MIMEMultipart()
        msg['From'] = EMAIL_FROM
        msg['Subject'] = f"Nouvelle annonce : {title}"
        msg['Bcc'] = ", ".join(student_emails)  # Utiliser BCC pour masquer les adresses
        
        # Corps de l'email avec formatage HTML
        event_date_str = ""
        if event_date:
            try:
        # If it's already a datetime object
                if hasattr(event_date, 'strftime'):
                    formatted_date = event_date.strftime('%d/%m/%Y à %H:%M')
        # If it's a string (e.g., from PostgreSQL)
                elif isinstance(event_date, str):
            # Parse the string into datetime first
                    dt = datetime.fromisoformat(event_date.replace('Z', '+00:00'))  # Handles timezone
                    formatted_date = dt.strftime('%d/%m/%Y à %H:%M')
                else:
                    formatted_date = str(event_date)  # Fallback
            
                event_date_str = f"<p><b>Date de l'événement:</b> {formatted_date}</p>"
            except Exception as e:
                logger.error(f"Could not format event_date: {str(e)}")
                event_date_str = f"<p><b>Date de l'événement:</b> {event_date} (format non reconnu)</p>"
        body = f"""
        <html>
        <body>
            <h2>Nouvelle annonce de Professeur {author}</h2>
            <h3>Sujet :{title}</h3>
            <p>{content}</p>
            {event_date_str}
            <hr>
            <p><small>Cette annonce a été envoyée automatiquement depuis la plateforme ENT, connectez-vous sur la platforme pour consulter l'annonce.</small></p>
        </body>
        </html>
        """
        
        msg.attach(MIMEText(body, 'html'))
        
        # Envoi de l'email avec plus de logs
        logger.debug("Envoi du message...")
        server.send_message(msg)
        server.quit()
        
        logger.info(f"Notification d'annonce envoyée à {len(student_emails)} étudiants")
        
    except Exception as e:
        logger.error(f"Erreur lors de l'envoi des emails d'annonce: {str(e)}")
        # Ajouter plus de détails sur l'erreur
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")


# Endpoint to get metadata for a specific file
@app.api_route("/files/{file_path:path}/metadata", methods=["GET","POST"])
async def get_file_metadata(file_path: str, roles: list = Depends(get_current_user_roles)):
    """Get metadata for a specific file"""
    
    try:
        path_parts = file_path.split('/')
        file_name_parts = path_parts[-1].split('_', 1)
        
        if len(file_name_parts) < 2:
            raise HTTPException(status_code=400, detail="Invalid file path format")
            
        file_uuid = file_name_parts[0]
        
        with get_metadata_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT * FROM files_metadata 
                    WHERE file_uuid = %s AND storage_path = %s
                """, (file_uuid, file_path))
                
                metadata = cur.fetchone()
                
                if not metadata:
                    raise HTTPException(status_code=404, detail="Metadata not found")
                
        return {"metadata": dict(metadata)}
    
    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"Error retrieving file metadata: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")