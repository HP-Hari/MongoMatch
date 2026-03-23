# MongoMatch | Premium Movie Database Search

Experience a state-of-the-art search engine for your movie database. This project leverages **MongoDB Atlas Search** to provide lightning-fast autocomplete suggestions and typos-resilient fuzzy matching.

## ✨ Key Features

-   🔍 **Real-time Autocomplete**: As you type, the search engine suggests movie titles instantly.
-   🖋️ **Fuzzy Matching**: Don't worry about typos. Search for "Godefather" and find "The Godfather".
-   🎥 **Cinematic UI**: A modern, dark-themed experience with glassmorphism and premium aesthetics.
-   📱 **Full Movie Context**: View posters, IMDb ratings, genres, and storylines in a stunning modal view.

## 🚀 Getting Started

### 1. Prerequisites
-   A [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) account.
-   The `sample_mflix` dataset loaded into your Atlas cluster.
-   Node.js installed on your machine.

### 2. Configure Atlas Search Index
Before running the application, you **must** create a search index in your MongoDB Atlas cluster. Detailed steps can be found in [atlas_search_setup.md](file:///Users/hari/.gemini/antigravity/brain/1dcb1f97-f1be-4c86-9069-9d05f84e48c4/atlas_search_setup.md).

### 3. Environment Setup
Rename `.env.example` to `.env` and fill in your connection details:

```env
MONGODB_URI=your_mongodb_connection_string
PORT=8080
DATABASE_NAME=sample_mflix
COLLECTION_NAME=movies
INDEX_NAME=default
```

### 4. Installation & Running
In your terminal, run the following commands:

```bash
# Install dependencies
npm install

# Start the server
node server.js
```

Open [http://localhost:8080](http://localhost:8080) in your browser to start searching!

## 🛠️ Technology Stack
-   **Backend**: Node.js & Express.js
-   **Database**: MongoDB Atlas with Search Engine (Lucene based)
-   **Frontend**: Vanilla HTML5, Premium CSS3 (Glassmorphism), and Vanilla JavaScript
-   **Fonts**: Outfit (Google Fonts)

---
*Created as part of the Enhancing User Experience Movie Database Project.*
