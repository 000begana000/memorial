// Handle sort mode change
  const handleSortChange = (newMode) => {
    setSortMode(newMode);
    // Show menu again when user interacts
    setShowSortMenu(true);
    // Reset timeout
    if (sortMenuTimeout.current) {
      clearTimeout(sortMenuTimeout.current);
    }
    sortMenuTimeout.current = setTimeout(() => {
      setShowSortMenu(false);
    }, 3000);
  };import { useState, useEffect, useRef } from "react";
import { storage, db } from "./firebase";
import { ref, uploadBytesResumable, getDownloadURL, deleteObject, listAll } from "firebase/storage";
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
  
  // Sorting state
  const [sortMode, setSortMode] = useState('random'); // 'random' or 'date'
  const [showSortMenu, setShowSortMenu] = useState(true);

  const filename = useRef();
  const sortMenuTimeout = useRef();

  useEffect(() => {
    setUploaded(false);
  }, [files]);

  useEffect(() => {
    loadAllImages();
    
    // Hide sort menu after 5 seconds
    sortMenuTimeout.current = setTimeout(() => {
      setShowSortMenu(false);
    }, 5000);
    
    return () => {
      if (sortMenuTimeout.current) {
        clearTimeout(sortMenuTimeout.current);
      }
    };
  }, []);

  // Re-sort images when sort mode changes
  useEffect(() => {
    if (images.length > 0) {
      const sortedImages = sortImages(images, sortMode);
      setImages(sortedImages);
    }
  }, [sortMode]);

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

  // Sort images based on mode
  const sortImages = (imageArray, mode) => {
    const imageCopy = [...imageArray];
    if (mode === 'random') {
      return shuffleArray(imageCopy);
    } else if (mode === 'date') {
      return imageCopy.sort((a, b) => {
        if (!a.uploadedAt || !b.uploadedAt) return 0;
        return a.uploadedAt.toDate() - b.uploadedAt.toDate(); // Ascending (oldest first)
      });
    }
    return imageCopy;
  };

  // Bulk import missing files from Storage to Firestore
  async function syncStorageToFirestore() {
    if (!isAdminMode) {
      alert("This function requires admin access");
      return;
    }

    const confirmSync = confirm("This will scan Firebase Storage and add missing files to Firestore. Continue?");
    if (!confirmSync) return;

    try {
      console.log("🔄 Starting Storage → Firestore sync...");
      
      // Get all files from Storage
      const storageRef = ref(storage, 'images');
      const storageList = await listAll(storageRef);
      console.log("📁 Files found in Storage:", storageList.items.length);
      
      // Get existing Firestore documents
      const firestoreSnapshot = await getDocs(collection(db, "images"));
      const existingFiles = new Set();
      firestoreSnapshot.forEach(doc => {
        existingFiles.add(doc.data().fileName);
      });
      console.log("📄 Documents in Firestore:", existingFiles.size);
      
      // Find missing files
      const missingFiles = [];
      for (const item of storageList.items) {
        const fileName = item.name;
        if (!existingFiles.has(fileName)) {
          missingFiles.push(item);
        }
      }
      
      console.log("🚫 Missing files to add:", missingFiles.length);
      console.log("Missing filenames:", missingFiles.map(item => item.name));
      
      if (missingFiles.length === 0) {
        alert("All Storage files are already in Firestore!");
        return;
      }
      
      // Add missing files to Firestore
      let addedCount = 0;
      let errorCount = 0;
      
      for (const item of missingFiles) {
        try {
          console.log(`➕ Adding ${item.name} to Firestore...`);
          
          // Get download URL
          const downloadURL = await getDownloadURL(item);
          
          // Determine file type
          const isVideo = isVideoFile(item.name);
          
          // Create Firestore document
          await setDoc(doc(db, "images", item.name), {
            imageUrl: downloadURL,
            fileName: item.name,
            fileType: isVideo ? 'video' : 'image',
            uploadedAt: new Date(), // Use current date since we don't have original
          });
          
          addedCount++;
          console.log(`✅ Added ${item.name}`);
          
        } catch (error) {
          console.error(`❌ Error adding ${item.name}:`, error);
          errorCount++;
        }
      }
      
      alert(`Sync complete!\nAdded: ${addedCount} files\nErrors: ${errorCount} files`);
      
      // Reload images
      loadAllImages();
      
    } catch (error) {
      console.error("❌ Sync failed:", error);
      alert("Sync failed: " + error.message);
    }
  }

  async function loadAllImages() {
    setLoading(true);
    try {
      console.log("=== LOADING IMAGES FROM FIRESTORE ===");
      console.log("Sort mode:", sortMode);
      
      // Get ALL documents from the images collection (no limit)
      const querySnapshot = await getDocs(collection(db, "images"));
      
      console.log("📊 Firestore query completed!");
      console.log("Documents returned:", querySnapshot.size);
      console.log("Query metadata:", {
        hasPendingWrites: querySnapshot.metadata.hasPendingWrites,
        isFromCache: querySnapshot.metadata.fromCache
      });
      
      let currImages = [];
      let skippedCount = 0;
      
      querySnapshot.forEach((doc, index) => {
        console.log(`📄 Processing document ${index + 1}/${querySnapshot.size}:`, doc.id);
        
        const data = doc.data();
        console.log("Document data:", {
          fileName: data.fileName,
          hasImageUrl: !!data.imageUrl,
          hasThumbnail: !!data.thumbnailUrl,
          fileType: data.fileType,
          uploadedAt: data.uploadedAt
        });
        
        // Check if document has required fields
        if (!data.imageUrl || !data.fileName) {
          console.warn(`⚠️ Skipping document ${doc.id} - missing required fields:`, {
            hasImageUrl: !!data.imageUrl,
            hasFileName: !!data.fileName
          });
          skippedCount++;
          return;
        }
        
        currImages.push({ 
          id: doc.id, 
          imageUrl: data.imageUrl,
          thumbnailUrl: data.thumbnailUrl || null,
          fileName: data.fileName,
          fileType: data.fileType || 'image',
          uploadedAt: data.uploadedAt
        });
      });
      
      console.log("✅ Processing complete!");
      console.log("Valid images found:", currImages.length);
      console.log("Skipped documents:", skippedCount);
      console.log("Image filenames:", currImages.map(img => img.fileName));
      
      // Apply initial sorting
      const sortedImages = sortImages(currImages, sortMode);
      console.log("Images after sorting:", sortedImages.length);
      
      setImages(sortedImages);
      
    } catch (error) {
      console.error("❌ Error loading images:", error);
      console.error("Error details:", {
        code: error.code,
        message: error.message,
        stack: error.stack
      });
      alert("Error loading images: " + error.message);
    }
    setLoading(false);
    console.log("=== LOAD IMAGES COMPLETE ===");
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

  // Handle image load errors (but don't auto-delete videos)
  async function handleImageError(imageData) {
    console.log(`Media failed to load: ${imageData.fileName}`);
    
    // Don't auto-delete videos - they might just need thumbnails
    if (imageData.fileType === 'video') {
      console.log(`⚠️ Video ${imageData.fileName} failed to load - this is expected if no thumbnail exists`);
      return; // Don't delete videos automatically
    }
    
    // Only auto-delete actual images that fail to load
    console.log(`🗑️ Removing broken image ${imageData.fileName} from database`);
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
      {/* Discrete Sort Menu */}
      <div className={`sort-menu ${showSortMenu ? 'visible' : 'hidden'}`}>
        <div className="sort-options">
          <button 
            className={`sort-btn ${sortMode === 'random' ? 'active' : ''}`}
            onClick={() => handleSortChange('random')}
            title="Random order"
          >
            🎲 Random
          </button>
          <button 
            className={`sort-btn ${sortMode === 'date' ? 'active' : ''}`}
            onClick={() => handleSortChange('date')}
            title="Oldest to newest"
          >
            📅 By Date
          </button>
        </div>
      </div>

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
        
        {/* Debug Info */}
        <div style={{ 
          background: 'rgba(0,0,0,0.1)', 
          padding: '10px', 
          margin: '10px', 
          borderRadius: '5px',
          fontSize: '14px'
        }}>
          <p><strong>Debug Info:</strong></p>
          <p>Images loaded: {images.length}</p>
          <p>Sort mode: {sortMode}</p>
          <button 
            onClick={() => {
              console.log("=== MANUAL RELOAD ===");
              loadAllImages();
            }}
            style={{ padding: '5px 10px', margin: '5px' }}
          >
            🔄 Force Reload
          </button>
          <button 
            onClick={() => {
              console.log("=== CURRENT IMAGES STATE ===");
              console.log("Total images in state:", images.length);
              console.log("Images array:", images);
              images.forEach((img, index) => {
                console.log(`Image ${index + 1}:`, {
                  id: img.id,
                  fileName: img.fileName,
                  hasImageUrl: !!img.imageUrl,
                  hasThumbnail: !!img.thumbnailUrl,
                  fileType: img.fileType
                });
              });
            }}
            style={{ padding: '5px 10px', margin: '5px' }}
          >
            📊 Log Current State
          </button>
          {isAdminMode && (
            <button 
              onClick={syncStorageToFirestore}
              style={{ 
                padding: '5px 10px', 
                margin: '5px',
                backgroundColor: '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '3px'
              }}
            >
              🔄 Sync Storage → Firestore
            </button>
          )}
        </div>

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