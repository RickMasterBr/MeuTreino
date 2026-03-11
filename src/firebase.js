import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
// NOVAS IMPORTAÇÕES DO AUTH:
import { getAuth, GoogleAuthProvider } from "firebase/auth";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCvMqEitxJld63eIsgm8Rb9mvuTGf7NvLs",
  authDomain: "meu-treinoapp.firebaseapp.com",
  projectId: "meu-treinoapp",
  storageBucket: "meu-treinoapp.firebasestorage.app",
  messagingSenderId: "272866094326",
  appId: "1:272866094326:web:63e7f609d694f1c8b690d7"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Inicializa o Firestore (Banco de Dados) e exporta a variável 'db' para usarmos nas telas
export const db = getFirestore(app);

export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();