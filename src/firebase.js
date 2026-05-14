import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDthev5LZ1GE3rmXOa7-WKB4-fGKFCNmTc",
  authDomain: "tl-manager-230a1.firebaseapp.com",
  projectId: "tl-manager-230a1",
  storageBucket: "tl-manager-230a1.firebasestorage.app",
  messagingSenderId: "645392057796",
  appId: "1:645392057796:web:120d469a88f4d3e16c9091"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
