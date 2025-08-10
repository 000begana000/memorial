import { useState, useEffect } from "react";
import { storage, db } from "./firebase";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { doc, collection, setDoc, getDocs } from "firebase/firestore";

export default function FileUpload() {
  const [file, setFile] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploaded, setUploaded] = useState(false);

  useEffect(() => {
    loadAllImages();
  }, []);

  useEffect(() => {
    if (!open) {
      setUploaded(false);
    }
  }, [open]);

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
    setFile(event.target.files[0]);
  }

  function handleUpload() {
    if (!file) {
      alert("please add the file");
    }

    const storageRef = ref(storage, `images/${file.name}`);

    const uploadTask = uploadBytesResumable(storageRef, file);

    setUploaded(false);

    uploadTask.on(
      "state_changed",
      snapshot => {
        const progress =
          (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        setUploadProgress(progress);
      },
      error => {
        console.log(error);
      },
      () => {
        getDownloadURL(uploadTask.snapshot.ref).then(downloadURL => {
          const imageStoreRef = doc(db, "images", file.name);
          setDoc(imageStoreRef, {
            imageUrl: downloadURL,
          });
        });
        setUploaded(true);
      }
    );
  }

  return (
    <>
      <div>
        <input type="file" accept="/image/*" onChange={handleChange}></input>
        <button onClick={handleUpload}>save</button>
        {uploaded && <p>Image was uploaded successfully</p>}
      </div>
      <div className="images-collection">
        {loading && <p>Loading....</p>}
        {images &&
          images.map(imageUrl => {
            return (
              <div key={imageUrl} className="image-container">
                <img src={imageUrl} />
              </div>
            );
          })}
      </div>
    </>
  );
}
