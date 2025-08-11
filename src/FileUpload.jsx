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

  // Helper function to determine if file is a video
  function isVideoFile(fileName) {
    const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.3gp', '.flv'];
    return videoExtensions.some(ext => fileName.toLowerCase().endsWith(ext));
  }

  // Generate video thumbnail
  async function generateVideoThumbnail(file) {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      video.preload = 'metadata';
      video.muted = true;
      
      video.onloadedmetadata = () => {
        // Set canvas dimensions
        canvas.width = 300;
        canvas.height = (video.videoHeight / video.videoWidth) * 300;
        
        // Seek to 1 second (or 10% of duration, whichever is smaller)
        video.currentTime = Math.min(1, video.duration * 0.1);
      };
      
      video.onseeked = () => {
        // Draw video frame to canvas
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Convert canvas to blob
        canvas.toBlob((blob) => {
          resolve(blob);
        }, 'image/jpeg', 0.7);
      };
      
      video.onerror = () => {
        resolve(null);
      };
      
      video.src = URL.createObjectURL(file);
    });
  }

  async function loadAllImages() {
    setLoading(true);
    const querySnapshot = await getDocs(collection(db, "images"));
    let currImages = [];
    querySnapshot.forEach(doc => {
      currImages = [...currImages, { 
        id: doc.id, 
        imageUrl: doc.data().imageUrl,
        thumbnailUrl: doc.data().thumbnailUrl || null,
        fileName: doc.data().fileName,
        fileType: doc.data().fileType || 'image' // New field to track file type
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
      
      // Delete thumbnail if it exists (for videos)
      if (imageData.thumbnailUrl && imageData.fileType === 'video') {
        const thumbnailRef = ref(storage, `thumbnails/${imageData.fileName}_thumbnail.jpg`);
        try {
          await deleteObject(thumbnailRef);
        } catch (error) {
          console.log("Thumbnail not found or already deleted");
        }
      }
      
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
        const isVideo = isVideoFile(file.name);
        const storageRef = ref(storage, `images/${file.name}`); // Keep using images folder
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

        let thumbnailURL = null;

        // Generate and upload thumbnail for videos
        if (isVideo) {
          const thumbnailBlob = await generateVideoThumbnail(file);
          if (thumbnailBlob) {
            const thumbnailRef = ref(storage, `thumbnails/${file.name}_thumbnail.jpg`);
            const thumbnailUploadTask = uploadBytesResumable(thumbnailRef, thumbnailBlob);
            
            thumbnailURL = await new Promise((resolve, reject) => {
              thumbnailUploadTask.on(
                "state_changed",
                null,
                error => {
                  console.error("Thumbnail upload error:", error);
                  resolve(null); // Continue without thumbnail
                },
                async () => {
                  const url = await getDownloadURL(thumbnailUploadTask.snapshot.ref);
                  resolve(url);
                }
              );
            });
          }
        }

        return {
          fileName: file.name,
          downloadURL,
          thumbnailURL,
          fileType: isVideo ? 'video' : 'image',
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
      const imageStoreRef = doc(db, "images", result.fileName); // Keep using images collection
      const imageData = {
        imageUrl: result.downloadURL,
        fileName: result.fileName,
        fileType: result.fileType, // Add file type
        uploadedAt: new Date(),
      };
      
      if (result.thumbnailURL) {
        imageData.thumbnailUrl = result.thumbnailURL;
      }
      
      batch.set(imageStoreRef, imageData);
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
          accept="image/*,video/*"
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
              // For videos, show thumbnail if available, otherwise show the video file itself
              const displayUrl = (imageData.fileType === 'video' && imageData.thumbnailUrl) 
                ? imageData.thumbnailUrl 
                : imageData.imageUrl;
              
              return (
                <li key={imageData.id}>
                  <div className="media-container">
                    <img
                      className={`image ${isAdminMode ? 'delete-mode' : ''}`}
                      src={displayUrl}
                      alt="Memorial photo"
                      onClick={() => handleImageClick(imageData)}
                      onError={() => handleImageError(imageData)}
                      onLoad={() => console.log(`Image loaded successfully: ${imageData.fileName}`)}
                    />
                    {imageData.fileType === 'video' && (
                      <div className="video-indicator">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M8 5v14l11-7z"/>
                        </svg>
                      </div>
                    )}
                  </div>
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
            {currentImage.fileType === 'video' ? (
              <video
                src={currentImage.imageUrl}
                controls
                className="modal-image"
                preload="metadata"
              />
            ) : (
              <img
                src={currentImage.imageUrl}
                alt="Full-screen view"
                className="modal-image"
              />
            )}
            <div className="image-info">
              <p>{currentImage.fileName}</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}