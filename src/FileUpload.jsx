import { useState, useEffect, useRef } from "react";
import { storage, db } from "./firebase";
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from "firebase/storage";
import {
  doc,
  collection,
  setDoc,
  getDocs,
  writeBatch,
  deleteDoc,
} from "firebase/firestore";

export default function FileUpload() {
  const [files, setFiles] = useState([]);
  const [uploadProgress, setUploadProgress] = useState({});
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [uploadResults, setUploadResults] = useState([]);
  
  // Modal state for full-screen viewing
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentImage, setCurrentImage] = useState(null);
  
  // Admin state for delete functionality
  const [isAdminMode, setIsAdminMode] = useState(false);

  const filename = useRef();

  useEffect(() => {
    setUploaded(false);
  }, [files]);

  useEffect(() => {
    loadAllImages();
  }, []);

  // Close modal with Escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        closeModal();
      }
    };
    
    if (isModalOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }
    
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isModalOpen]);

  async function loadAllImages() {
    setLoading(true);
    const querySnapshot = await getDocs(collection(db, "images"));
    let currImages = [];
    querySnapshot.forEach(doc => {
      currImages = [...currImages, { 
        id: doc.id, 
        imageUrl: doc.data().imageUrl,
        fileName: doc.data().fileName 
      }];
    });
    setImages(currImages);
    setLoading(false);
  }

  // Open image in full-screen modal
  function openModal(imageData) {
    setCurrentImage(imageData);
    setIsModalOpen(true);
  }

  // Close modal
  function closeModal() {
    setIsModalOpen(false);
    setCurrentImage(null);
  }

  // Admin functionality
  function handleAdminClick() {
    const password = prompt("Enter admin password:");
    if (password === "porrazzo123!") {
      const newAdminMode = !isAdminMode;
      setIsAdminMode(newAdminMode);
      alert(newAdminMode ? "Admin mode enabled - click on images to delete them" : "Admin mode disabled");
    } else if (password !== null) {
      alert("Incorrect password");
    }
  }

  // Delete image from both Firebase Storage and Firestore
  async function deleteImage(imageData) {
    if (!isAdminMode) return;
    
    const confirmDelete = confirm(`Are you sure you want to delete "${imageData.fileName}"?`);
    if (!confirmDelete) return;

    try {
      // Delete from Firebase Storage
      const imageRef = ref(storage, `images/${imageData.fileName}`);
      await deleteObject(imageRef);
      
      // Delete from Firestore
      await deleteDoc(doc(db, "images", imageData.id));
      
      // Remove from local state
      setImages(prevImages => prevImages.filter(img => img.id !== imageData.id));
      
      alert("Image deleted successfully");
    } catch (error) {
      console.error("Error deleting image:", error);
      alert("Error deleting image: " + error.message);
    }
  }

  // Handle image click - either open modal or delete based on admin mode
  function handleImageClick(imageData) {
    if (isAdminMode) {
      deleteImage(imageData);
    } else {
      openModal(imageData);
    }
  }

  // Handle image load errors by removing from Firestore
  async function handleImageError(imageData) {
    console.log(`Image failed to load: ${imageData.fileName}, removing from database`);
    try {
      await deleteDoc(doc(db, "images", imageData.id));
      // Remove from local state
      setImages(prevImages => prevImages.filter(img => img.id !== imageData.id));
    } catch (error) {
      console.error("Error removing broken image reference:", error);
    }
  }

  function handleChange(event) {
    const selectedFiles = Array.from(event.target.files);
    setFiles(selectedFiles);
    setUploadResults([]);
    setUploadProgress({});
  }

  // Upload files in parallel (all at once)
  async function handleParallelUpload() {
    if (files.length === 0) {
      alert("Please select files to upload");
      return;
    }

    setUploading(true);

    const uploadPromises = files.map(async file => {
      try {
        const storageRef = ref(storage, `images/${file.name}`);
        const uploadTask = uploadBytesResumable(storageRef, file);

        const downloadURL = await new Promise((resolve, reject) => {
          uploadTask.on(
            "state_changed",
            snapshot => {
              const progress = Math.round(
                (snapshot.bytesTransferred / snapshot.totalBytes) * 100
              );
              setUploadProgress(prev => ({
                ...prev,
                [file.name]: progress,
              }));
            },
            error => {
              reject(error);
            },
            async () => {
              const url = await getDownloadURL(uploadTask.snapshot.ref);
              resolve(url);
            }
          );
        });

        return {
          fileName: file.name,
          downloadURL,
          status: "success",
        };
      } catch (error) {
        console.error(`Error uploading ${file.name}:`, error);
        return {
          fileName: file.name,
          status: "error",
          error: error.message,
        };
      }
    });

    const results = await Promise.all(uploadPromises);

    // Batch write to Firestore for better performance
    const batch = writeBatch(db);
    const successfulUploads = results.filter(
      result => result.status === "success"
    );

    successfulUploads.forEach(result => {
      const imageStoreRef = doc(db, "images", result.fileName);
      batch.set(imageStoreRef, {
        imageUrl: result.downloadURL,
        fileName: result.fileName,
        uploadedAt: new Date(),
      });
    });

    try {
      await batch.commit();
      console.log("Batch write successful");
    } catch (error) {
      console.error("Batch write failed:", error);
    }

    setUploadResults(results);
    setUploading(prevState => !prevState);
    setUploaded(prevState => !prevState);
    loadAllImages(); // Refresh the images list
    filename.current.value = "";
  }

  return (
    <>
      {/* Invisible Admin Button */}
      <button 
        className="admin-button"
        onClick={handleAdminClick}
        title="Admin controls"
      >
      </button>

      <header className="header">
        <h1>in memoria di Ross</h1>
        <p>resterai sempre nei nostri cuori Bomberone</p>
        {isAdminMode && (
          <div className="admin-indicator">
            <p>🗑️ DELETE MODE ACTIVE - Click images to delete them</p>
          </div>
        )}
      </header>
      
      <div className="file-container">
        <input
          className="button"
          type="file"
          multiple
          accept="image/*"
          onChange={handleChange}
          ref={filename}
        />

        <button
          className="button"
          onClick={handleParallelUpload}
          disabled={uploaded || uploading || files.length === 0}
        >
          Save to memorial board
        </button>

        {uploading && (
          <div>
            <p>Uploading files...</p>
            {Object.entries(uploadProgress).map(([fileName, progress]) => (
              <div key={fileName}>
                <span>{fileName}: </span>
                <progress value={progress} max="100" />
                <span> {progress}%</span>
              </div>
            ))}
          </div>
        )}

        {uploadResults.length > 0 && (
          <div>
            <h3>Upload Results:</h3>
            {uploadResults.map((result, index) => (
              <div
                key={index}
                style={{
                  color: result.status === "success" ? "green" : "red",
                  marginBottom: "5px",
                }}
              >
                {result.fileName}: {result.status}
                {result.error && ` - ${result.error}`}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="images-collection">
        {loading && <p>Loading....</p>}
        <ul>
          {images &&
            images.map(imageData => {
              return (
                <li key={imageData.id}>
                  <img
                    className={`image ${isAdminMode ? 'delete-mode' : ''}`}
                    src={imageData.imageUrl}
                    alt="Memorial photo"
                    onClick={() => handleImageClick(imageData)}
                    onError={() => handleImageError(imageData)}
                    onLoad={() => console.log(`Image loaded successfully: ${imageData.fileName}`)}
                  />
                </li>
              );
            })}
        </ul>
      </div>

      {/* Full-screen Modal */}
      {isModalOpen && currentImage && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="close-button" onClick={closeModal}>×</button>
            <img
              src={currentImage.imageUrl}
              alt="Full-screen view"
              className="modal-image"
            />
            <div className="image-info">
              <p>{currentImage.fileName}</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}