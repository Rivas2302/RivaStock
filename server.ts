import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import admin from "firebase-admin";
import fs from "fs";

// Load Firebase config
const firebaseConfig = JSON.parse(fs.readFileSync("./firebase-applet-config.json", "utf-8"));

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

const db = admin.firestore(firebaseConfig.firestoreDatabaseId);
const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_for_dev_only";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors({
    origin: true,
    credentials: true
  }));
  app.use(express.json());
  app.use(cookieParser());

  // API routes go here
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Auth Routes
  app.post("/api/auth/register", async (req, res) => {
    const { email, password, businessName } = req.body;
    console.log(`Registration attempt for: ${email}`);

    try {
      if (!email || !password || !businessName) {
        return res.status(400).json({ error: "Todos los campos son obligatorios" });
      }

      if (password.length < 6) {
        return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
      }

      // Check if user exists
      const userRef = db.collection("users").where("email", "==", email).limit(1);
      const snapshot = await userRef.get();

      if (!snapshot.empty) {
        console.log(`Registration failed: Email ${email} already in use`);
        return res.status(400).json({ error: "Este email ya está registrado" });
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 10);
      const uid = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      
      // Slugify helper
      const slugify = (text: string) => text.toString().toLowerCase().trim()
        .replace(/\s+/g, '-')
        .replace(/[^\w-]+/g, '')
        .replace(/--+/g, '-');

      const baseSlug = slugify(businessName);
      let catalogSlug = baseSlug;
      
      // Check for slug uniqueness
      const slugCheck = await db.collection("users").where("catalogSlug", "==", catalogSlug).limit(1).get();
      if (!slugCheck.empty) {
        catalogSlug = `${baseSlug}-${Math.floor(Math.random() * 1000)}`;
      }

      const newUser = {
        uid,
        email,
        passwordHash,
        businessName,
        displayName: email.split('@')[0],
        role: 'admin',
        currencySymbol: '$',
        darkMode: false,
        createdAt: new Date().toISOString(),
        catalogSlug,
      };

      await db.collection("users").doc(uid).set(newUser);
      console.log(`Registration success for: ${email}`);

      // Create token
      const token = jwt.sign({ uid, email }, JWT_SECRET, { expiresIn: "7d" });
      
      res.cookie("session", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      });

      const { passwordHash: _, ...userProfile } = newUser;
      res.json(userProfile);
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ error: "Error interno del servidor" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    console.log(`Login attempt for: ${email}`);

    try {
      if (!email || !password) {
        return res.status(400).json({ error: "Email y contraseña son obligatorios" });
      }

      const userRef = db.collection("users").where("email", "==", email).limit(1);
      const snapshot = await userRef.get();

      if (snapshot.empty) {
        console.log(`Login failed: User ${email} not found`);
        return res.status(401).json({ error: "Email o contraseña incorrectos" });
      }

      const userData = snapshot.docs[0].data();
      
      // If it's a Google user without a passwordHash, they must use Google login
      if (!userData.passwordHash) {
        console.log(`Login failed: User ${email} is a Google user`);
        return res.status(401).json({ error: "Este usuario usa Google Login. Por favor, usa el botón de Google." });
      }

      const isValid = await bcrypt.compare(password, userData.passwordHash);
      console.log(`Password comparison for ${email}: ${isValid ? 'SUCCESS' : 'FAILURE'}`);

      if (!isValid) {
        return res.status(401).json({ error: "Email o contraseña incorrectos" });
      }

      const token = jwt.sign({ uid: userData.uid, email: userData.email }, JWT_SECRET, { expiresIn: "7d" });
      
      res.cookie("session", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      });

      const { passwordHash: _, ...userProfile } = userData;
      res.json(userProfile);
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Error interno del servidor" });
    }
  });

  app.get("/api/auth/me", async (req, res) => {
    const token = req.cookies.session;
    if (!token) return res.status(401).json({ error: "No session" });

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { uid: string };
      const userDoc = await db.collection("users").doc(decoded.uid).get();
      
      if (!userDoc.exists) {
        return res.status(401).json({ error: "User not found" });
      }

      const userData = userDoc.data();
      const { passwordHash: _, ...userProfile } = userData!;
      res.json(userProfile);
    } catch (error) {
      res.status(401).json({ error: "Invalid session" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    res.clearCookie("session");
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
