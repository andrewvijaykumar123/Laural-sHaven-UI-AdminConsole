import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection, setDoc, onSnapshot,
  query, where, orderBy, limit, writeBatch, getDocs, serverTimestamp, enableNetwork, disableNetwork
} from 'firebase/firestore';

window.LH_FB = {
  initializeApp, getAuth, onAuthStateChanged, signInAnonymously, signInWithEmailAndPassword, signOut,
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection, setDoc, onSnapshot,
  query, where, orderBy, limit, writeBatch, getDocs, serverTimestamp, enableNetwork, disableNetwork
};
