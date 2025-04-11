// server.js - Backend for Form-Filling Assistant
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const fs = require('fs');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const port = process.env.PORT || 3000;

// Configure Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Set up storage for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)){
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Initialize chat history
const chatSessions = {};

// Helper function to get file MIME type
function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.ogg': 'audio/ogg',
    '.mp3': 'audio/mp3',
    '.wav': 'audio/wav',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

// Helper function to read files as base64
async function fileToGenerativePart(path, mimeType) {
  const data = fs.readFileSync(path);
  return {
    inlineData: {
      data: data.toString('base64'),
      mimeType
    }
  };
}

// Initialize chat session
app.post('/api/chat/init', async (req, res) => {
  try {
    const sessionId = Date.now().toString();
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: {
        temperature: 1,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
      }
    });

    // Start the chat with system instructions
    const chat = model.startChat({
      history: [
        {
          role: "user",
          parts: [
            "You are a smart form-filling assistant. Your job is to help the user fill out any kind of form by:\n\nAsking for the form the user wants to fill (PDF/image/text/structured).\n\nAsking for any supporting documents that can help fill in the form (optional), such as resumes, financial records, identification documents, medical reports, etc.\n\nExtracting relevant information from uploaded documents (including PDFs, images, text, or audio) and mapping it to corresponding form fields.\n\nIntelligently chatting with the user to ask only the missing or unclear fields — one question at a time.\n\nIf a user uploads a document or audio file mid-conversation, you must:\n\nAnalyze it immediately.\n\nExtract useful data to fill unanswered fields.\n\nValidate if the document is relevant or not.\n\nIf irrelevant, politely ask the user to upload a better document or continue the chat.\n\nSupport multi-modal input: Users can reply using text or audio. Handle both gracefully.\n\nStore the responses internally in a JSON format."
          ]
        }
      ]
    });

    // Store chat session
    chatSessions[sessionId] = chat;

    // Get initial response
    const result = await chat.sendMessage("Hello, I need help filling out a form.");

    res.json({
      sessionId: sessionId,
      message: result.response.text()
    });
  } catch (error) {
    console.error("Error initializing chat:", error);
    res.status(500).json({ error: error.message });
  }
});

// Send text message to chat
app.post('/api/chat/message', async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    
    if (!chatSessions[sessionId]) {
      return res.status(404).json({ error: "Chat session not found" });
    }

    const chat = chatSessions[sessionId];
    const result = await chat.sendMessage(message);

    res.json({
      message: result.response.text()
    });
  } catch (error) {
    console.error("Error sending message:", error);
    res.status(500).json({ error: error.message });
  }
});

// Upload file and send to chat
app.post('/api/chat/upload', upload.single('file'), async (req, res) => {
  try {
    const { sessionId } = req.body;
    const file = req.file;
    
    if (!chatSessions[sessionId]) {
      return res.status(404).json({ error: "Chat session not found" });
    }

    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const mimeType = getMimeType(file.originalname);
    const filePart = await fileToGenerativePart(file.path, mimeType);
    
    const chat = chatSessions[sessionId];
    const result = await chat.sendMessage([filePart]);

    res.json({
      fileName: file.originalname,
      fileType: mimeType,
      message: result.response.text()
    });
  } catch (error) {
    console.error("Error processing file:", error);
    res.status(500).json({ error: error.message });
  }
});

// Upload audio recording and send to chat
app.post('/api/chat/audio', upload.single('audio'), async (req, res) => {
  try {
    const { sessionId } = req.body;
    const file = req.file;
    
    if (!chatSessions[sessionId]) {
      return res.status(404).json({ error: "Chat session not found" });
    }

    if (!file) {
      return res.status(400).json({ error: "No audio file uploaded" });
    }

    const mimeType = getMimeType(file.originalname) || 'audio/ogg';
    const filePart = await fileToGenerativePart(file.path, mimeType);
    
    const chat = chatSessions[sessionId];
    const result = await chat.sendMessage([filePart]);

    res.json({
      fileName: file.originalname,
      fileType: mimeType,
      message: result.response.text()
    });
  } catch (error) {
    console.error("Error processing audio:", error);
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Form-filling assistant backend running on port ${port}`);
});