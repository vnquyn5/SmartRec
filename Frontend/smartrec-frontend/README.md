# SmartRec - Frontend
Smart Recommendation System Frontend built with ReactJS and Vite.

## Project Structure
```text
Frontend/smartrec-frontend/
├── src/
│   ├── api/          # Axios configuration and API calls
│   ├── assets/       # Static assets and global styles (Tailwind)
│   ├── components/   # Reusable UI components (common, layout, video)
│   ├── context/      # Global state management
│   ├── hooks/        # Custom React hooks
│   ├── pages/        # Page views (auth, dashboard, meeting)
│   ├── routes/       # React Router DOM configuration
│   ├── utils/        # Utility functions
│   ├── App.jsx       # Root component
│   └── main.jsx      # Entry point
├── .env              # Environment variables
├── index.html        # HTML template
├── package.json      # Dependencies and scripts
├── tailwind.config.js# Tailwind CSS configuration
└── vite.config.js    # Vite configuration
```

## Getting Started

### Prerequisites
- Node.js (v18 or higher recommended)
- npm (Node Package Manager)

### Build and Run

```bash
# Navigate to the frontend directory
cd Frontend/smartrec-frontend

# Install dependencies
npm install

# Start the development server
npm run dev

# Build for production
npm run build
```

## Features
- **Routing**: React Router DOM
- **Styling**: Tailwind CSS
- **API Communication**: Axios with JWT Interceptors
- **Video Player**: Video.js integration
- **WebSocket**: SockJS & StompJS for real-time progress updates

## Development
The frontend application runs on `http://localhost:5173` by default.
