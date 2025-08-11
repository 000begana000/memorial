import { useState, useEffect } from "react";
import { storage, db } from "./firebase";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import {
  doc,
  collection,
  setDoc,
  getDocs,
  writeBatch,
} from "firebase/firestore";

export default function FileUpload() {
  const [files, setFiles] = useState([]); // Changed to array
  const [uploadProgress, setUploadProgress] = useState({});
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResults, setUploadResults] = useState([]);

  useEffect(() => {
    loadAllImages();
  }, []);

  async function loadAllImages() {
    setLoading(true);
    const querySnapshot = await getDocs(collection(db, "images"));
    let currImages = [];
    querySnapshot.forEach(doc => {
      currImages = [...currImages, doc.data().imageUrl];
    });
    setImages(currImages);
    setLoading(false);
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
    setUploading(false);
    loadAllImages(); // Refresh the images list
  }

  return (
    <>
      <header className="header">
        <h1>in memoria di Ross</h1>
        <p>resterai sempre nei nostri cuori Bomberone</p>
      </header>
      <div className="file-container">
        <input
          className="button"
          type="file"
          multiple
          accept="image/*" // Fixed the accept attribute
          onChange={handleChange}
        />

        <button
          className="button"
          onClick={handleParallelUpload}
          disabled={uploading || files.length === 0}
        >
          Save to memorial borad
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
        {images &&
          images.map(imageUrl => {
            return (
              <img
                className="image"
                src={imageUrl}
                key={imageUrl}
                alt="Uploaded"
              />
            );
          })}
      </div>
    </>
  );
}
