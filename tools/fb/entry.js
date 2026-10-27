import qrcode from 'qrcode-generator';
import { initializeApp } from 'firebase/app';
import { getAuth, initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, onAuthStateChanged, signInAnonymously, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection, setDoc, onSnapshot,
  query, where, orderBy, limit, writeBatch, getDocs, serverTimestamp, enableNetwork, disableNetwork
} from 'firebase/firestore';

window.LH_FB = {
  initializeApp, getAuth, initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, onAuthStateChanged, signInAnonymously, signInWithEmailAndPassword, signOut,
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection, setDoc, onSnapshot,
  query, where, orderBy, limit, writeBatch, getDocs, serverTimestamp, enableNetwork, disableNetwork
};

window.LH_QR = (text) => {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createDataURL(8, 16);
};
