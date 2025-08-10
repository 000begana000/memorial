// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getStorage } from "firebase/storage";
import { getFirestore } from "firebase/firestore";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCUoKyJAzFJIX_Cx0qMpvc23NtgvQMwVxY",
  authDomain: "memorial-5ee92.firebaseapp.com",
  projectId: "memorial-5ee92",
  storageBucket: "memorial-5ee92.firebasestorage.app",
  messagingSenderId: "409301344582",
  appId: "1:409301344582:web:31b601be54af7603cdc547",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Cloud Storage and get a reference to the service
export const storage = getStorage(app);

// Initialize Cloud Firestore and get a reference to the service
export const db = getFirestore(app);
