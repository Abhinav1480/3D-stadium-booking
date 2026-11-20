# 🏏 STADIUMX — 3D Cricket Stadium & Seat Booking Platform

<p align="center">
  <strong>Explore the stadium. Experience your seat. Book your view.</strong>
</p>

<p align="center">
  An immersive 3D cricket stadium exploration and intelligent seat-booking experience.
</p>

<p align="center">
  <a href="https://3d-stadium-booking.vercel.app/">🌐 Live Demo</a> |
  <a href="https://github.com/Abhinav1480/3D-Stadium-Booking">💻 GitHub Repository</a>
</p>

---

## 🌟 Overview

**STADIUMX** is an interactive 3D cricket stadium exploration and seat-booking platform designed to transform the traditional ticket-booking experience.

Instead of selecting seats using static 2D layouts, users can explore a detailed cricket stadium, navigate different stands and seating tiers, inspect individual seat perspectives, compare viewing conditions and reserve their preferred seats.

The platform combines real-time seat inventory, interactive 3D visualisation, intelligent seat discovery and digital ticket management into one connected web application.

## ✨ Key Features

### 🏟️ Interactive 3D Stadium
- Immersive cricket stadium environment.
- 8 stadium stands with 3 seating tiers.
- Explore the stadium with interactive camera controls.
- Orbit, pan, zoom, Fly and Tour navigation.
- Bowl Radar for navigating stadium sections.
- 2D and 3D viewing modes.

### 🎨 Graphics & Visualisation
- Day, Dusk and Night lighting modes.
- Adjustable time-of-day experience.
- Solid and X-Ray visualisation modes.
- Graphics quality presets: Low, Normal, Medium, High and Ultra.
- Performance-conscious rendering options.

### 👁️ Seat Sightline Inspector
- Explore the stadium from an individual seat's perspective.
- Head Pan (Yaw) and Eye Zoom (FOV) controls.
- Inspect pitch distance and boundary distance.
- Examine elevation and canopy shade.
- Check scoreboard visibility and viewing conditions.

### 🧠 Smart Seat Discovery Engine
- Explore recommendations across 4,800 stadium seats.
- Filter seats based on budget and preferences.
- Explore stands and seating categories.
- Find adjacent seats.
- Compare viewing scores and seat characteristics.
- Locate recommended seats inside the 3D stadium.

### 🎟️ Seat Booking System
- Interactive seat selection.
- Live seat availability synchronisation.
- Temporary seat holds.
- Booking checkout workflow.
- Backend validation and booking persistence.
- Protection against conflicting seat reservations.

### 📱 Digital Ticket Management
- My Tickets section.
- My QR digital passes.
- Booking information and QR-based ticket access.
- Customer-focused ticket management experience.

---

## 🛠️ Technology Stack

| Category | Technologies |
|---|---|
| Frontend | React, TypeScript, Vite |
| 3D Graphics | Three.js, React Three Fiber |
| Styling | CSS, Tailwind CSS |
| Backend | Node.js, Express.js |
| Real-time Communication | Socket.IO |
| Database | PostgreSQL |
| Database ORM | Drizzle ORM |
| Authentication | Firebase Authentication |
| Frontend Hosting | Vercel |
| Backend Hosting | Render |
| Version Control | Git & GitHub |

---

## 🏗️ System Architecture

STADIUMX uses a split deployment architecture.

```text
                 USER
                   |
                   v
          VERCEL FRONTEND
          React + Three.js
                   |
                   v
          EXPRESS BACKEND
             RENDER
                   |
          +--------+--------+
          |                 |
          v                 v
     POSTGRESQL          SOCKET.IO
      DATABASE       REAL-TIME EVENTS
          |                 |
          +--------+--------+
                   |
                   v
          SEAT INVENTORY
          AND BOOKINGS
```

**Frontend:** Hosted on Vercel.

**Backend:** Persistent Node.js and Express service hosted on Render.

**Database:** PostgreSQL for persistent seat inventory and booking records.

**Real-time layer:** Socket.IO for live communication and seat inventory updates.

---

## 🚀 Live Deployment

| Component | URL |
|---|---|
| Live Website | https://3d-stadium-booking.vercel.app/ |
| Backend Service | https://stadiumx-backend.onrender.com |
| Backend Health | https://stadiumx-backend.onrender.com/api/health |
| GitHub Repository | https://github.com/Abhinav1480/3D-Stadium-Booking |

---

## ⚙️ Local Development Setup

### Prerequisites

- Node.js
- Bun or the package manager configured by the project
- PostgreSQL database
- Git

### 1. Clone the repository

```bash
git clone https://github.com/Abhinav1480/3D-Stadium-Booking.git
```

### 2. Enter the project directory

```bash
cd 3D-Stadium-Booking
```

### 3. Install dependencies

```bash
bun install
```

### 4. Configure environment variables

Create the required environment files based on `.env.example`.

Frontend configuration:

```env
VITE_API_BASE_URL=http://localhost:3000
```

Backend configuration:

```env
NODE_ENV=development
DATABASE_URL=your_postgresql_connection_string
CORS_ORIGINS=http://localhost:5173
JWT_SECRET=your_development_secret
QR_HMAC_SECRET=your_development_secret
```

Add other integration credentials required by your local configuration.

**Never commit actual secrets, passwords or private credentials to GitHub.**

### 5. Start the application

Use the development scripts configured in `package.json`.

For example:

```bash
bun run dev
```

Check the project's workspace scripts if the frontend and backend need to be started separately.

---

## 🔐 Production Environment Configuration

The production application uses environment variables to connect the frontend, backend and database.

**Vercel:**
- `VITE_API_BASE_URL`

**Render:**
- `NODE_ENV`
- `DATABASE_URL`
- `CORS_ORIGINS`
- `JWT_SECRET`
- `QR_HMAC_SECRET`
- Other backend integration credentials as required.

Sensitive backend credentials must remain on the backend and must never be exposed through frontend environment variables.

---

## ⚡ Performance & Reliability

STADIUMX focuses on rendering performance and reliable seat-booking operations.

- Optimised 3D rendering and camera interactions.
- Graphics quality controls.
- Efficient rendering of large seat collections.
- Backend connection and inventory synchronisation handling.
- Database-backed booking persistence.
- Seat reservation concurrency protection.
- Graceful handling of temporary backend availability issues.

---

## 🔮 Future Improvements

- Further 3D rendering and loading optimisations.
- More detailed seat-view comparisons.
- Enhanced stadium customisation.
- Improved mobile and touch interactions.
- Additional personalisation and recommendation capabilities.

---

## 👨‍💻 Developer

**N. Abhinav**

Full Stack Developer | UI Engineer | Creative Developer

B.Tech — Computer Science and Engineering

GitHub: [@Abhinav1480](https://github.com/Abhinav1480)

LinkedIn: [Abhinav Nakka](https://www.linkedin.com/in/abhinav-nakka-5133b1356/)

---

## 📄 License

This project is developed as a personal software project. Licensing and reuse permissions should be confirmed by the repository owner before redistribution.

---

<p align="center">
  <strong>STADIUMX — Experience Every Seat Before You Book It. 🏏</strong>
</p>
