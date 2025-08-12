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
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [bulkDeleteMode, setBulkDeleteMode] = useState(false);

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
        if (bulkDeleteMode) {
          exitBulkDeleteMode();
        }
      }
    };
    
    if (isModalOpen || bulkDeleteMode) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }
    
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isModalOpen, bulkDeleteMode]);

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
        canvas.width = 300;
        canvas.height = (video.videoHeight / video.videoWidth) * 300;
        video.currentTime = Math.min(1, video.duration * 0.1);
      };
      
      video.onseeked = () => {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
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

  // Fisher-Yates shuffle algorithm for random order
  const shuffleArray = (array) => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };

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
        fileType: doc.data().fileType || 'image',
        uploadedAt: doc.data().uploadedAt
      }];
    });
    
    // Randomize the order for each session
    currImages = shuffleArray(currImages);
    
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

  // Admin functionality with environment variable password
  function handleAdminClick() {
    const password = prompt("Enter admin password:");
    if (password === null) return;
    
    const correctPassword = import.meta.env.VITE_ADMIN_PASSWORD;
    
    if (password === correctPassword) {
      const newAdminMode = !isAdminMode;
      setIsAdminMode(newAdminMode);
      if (!newAdminMode) {
        exitBulkDeleteMode(); // Exit bulk delete when exiting admin mode
      }
      alert(newAdminMode ? "Admin mode enabled" : "Admin mode disabled");
    } else {
      alert("Incorrect password");
    }
  }

  // Toggle item selection for bulk delete
  function toggleItemSelection(imageId) {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(imageId)) {
      newSelected.delete(imageId);
    } else {
      newSelected.add(imageId);
    }
    setSelectedItems(newSelected);
  }

  // Enter bulk delete mode
  function enterBulkDeleteMode() {
    setBulkDeleteMode(true);
    setSelectedItems(new Set());
  }

  // Exit bulk delete mode
  function exitBulkDeleteMode() {
    setBulkDeleteMode(false);
    setSelectedItems(new Set());
  }

  // Select all items
  function selectAllItems() {
    const allIds = new Set(images.map(img => img.id));
    setSelectedItems(allIds);
  }

  // Deselect all items
  function deselectAllItems() {
    setSelectedItems(new Set());
  }

  // Delete multiple items
  async function bulkDeleteItems() {
    if (selectedItems.size === 0) {
      alert("No items selected");
      return;
    }

    const confirmDelete = confirm(`Are you sure you want to delete ${selectedItems.size} item(s)?`);
    if (!confirmDelete) return;

    const itemsToDelete = images.filter(img => selectedItems.has(img.id));
    let successCount = 0;
    let errorCount = 0;

    for (const imageData of itemsToDelete) {
      try {
        // Delete from Firebase Storage
        const imageRef = ref(storage, `images/${imageData.fileName}`);
        await deleteObject(imageRef);
        
        // Delete thumbnail if it exists
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
        successCount++;
      } catch (error) {
        console.error(`Error deleting ${imageData.fileName}:`, error);
        errorCount++;
      }
    }

    alert(`Deleted ${successCount} items. ${errorCount > 0 ? `${errorCount} errors.` : ''}`);
    exitBulkDeleteMode();
    loadAllImages(); // Refresh the list
  }

  // Delete single image
  async function deleteImage(imageData) {
    if (!isAdminMode) return;
    
    const confirmDelete = confirm(`Are you sure you want to delete "${imageData.fileName}"?`);
    if (!confirmDelete) return;

    try {
      const imageRef = ref(storage, `images/${imageData.fileName}`);
      await deleteObject(imageRef);
      
      if (imageData.thumbnailUrl && imageData.fileType === 'video') {
        const thumbnailRef = ref(storage, `thumbnails/${imageData.fileName}_thumbnail.jpg`);
        try {
          await deleteObject(thumbnailRef);
        } catch (error) {
          console.log("Thumbnail not found or already deleted");
        }
      }
      
      await deleteDoc(doc(db, "images", imageData.id));
      setImages(prevImages => prevImages.filter(img => img.id !== imageData.id));
      alert("Item deleted successfully");
    } catch (error) {
      console.error("Error deleting item:", error);
      alert("Error deleting item: " + error.message);
    }
  }

  // Handle image click based on mode
  function handleImageClick(imageData) {
    if (bulkDeleteMode) {
      toggleItemSelection(imageData.id);
    } else if (isAdminMode) {
      deleteImage(imageData);
    } else {
      openModal(imageData);
    }
  }

  // Handle image load errors
  async function handleImageError(imageData) {
    console.log(`Image failed to load: ${imageData.fileName}, removing from database`);
    try {
      await deleteDoc(doc(db, "images", imageData.id));
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

  // Upload files - completely open
  async function handleParallelUpload() {
    if (files.length === 0) {
      alert("Please select files to upload");
      return;
    }

    setUploading(true);

    const uploadPromises = files.map(async file => {
      try {
        const isVideo = isVideoFile(file.name);
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

        let thumbnailURL = null;

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
                  resolve(null);
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

    const batch = writeBatch(db);
    const successfulUploads = results.filter(result => result.status === "success");

    successfulUploads.forEach(result => {
      const imageStoreRef = doc(db, "images", result.fileName);
      const imageData = {
        imageUrl: result.downloadURL,
        fileName: result.fileName,
        fileType: result.fileType,
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
    loadAllImages();
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
            <p>🔧 ADMIN MODE ACTIVE</p>
            <div className="admin-controls">
              {!bulkDeleteMode ? (
                <>
                  <button className="admin-btn" onClick={enterBulkDeleteMode}>
                    📦 Bulk Delete Mode
                  </button>
                  <span style={{margin: '0 10px'}}>or click individual items to delete</span>
                </>
              ) : (
                <div className="bulk-delete-controls">
                  <button className="admin-btn" onClick={selectAllItems}>
                    ✅ Select All ({images.length})
                  </button>
                  <button className="admin-btn" onClick={deselectAllItems}>
                    ❌ Deselect All
                  </button>
                  <button 
                    className="admin-btn delete-btn" 
                    onClick={bulkDeleteItems}
                    disabled={selectedItems.size === 0}
                  >
                    🗑️ Delete Selected ({selectedItems.size})
                  </button>
                  <button className="admin-btn" onClick={exitBulkDeleteMode}>
                    ↩️ Exit Bulk Mode
                  </button>
                </div>
              )}
            </div>
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
              const displayUrl = (imageData.fileType === 'video' && imageData.thumbnailUrl) 
                ? imageData.thumbnailUrl 
                : imageData.imageUrl;
              
              const isSelected = selectedItems.has(imageData.id);
              
              return (
                <li key={imageData.id}>
                  <div className="media-container">
                    <img
                      className={`image ${isAdminMode && !bulkDeleteMode ? 'delete-mode' : ''} ${isSelected ? 'selected' : ''}`}
                      src={displayUrl}
                      alt="Memorial content"
                      onClick={() => handleImageClick(imageData)}
                      onError={() => handleImageError(imageData)}
                    />
                    {imageData.fileType === 'video' && (
                      <div className="video-indicator">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M8 5v14l11-7z"/>
                        </svg>
                      </div>
                    )}
                    {bulkDeleteMode && (
                      <div className="selection-indicator">
                        {isSelected ? '✅' : '⭕'}
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