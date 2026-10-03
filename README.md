# TeleStore

### Telegram-Backed Resource Storage & High-Concurrency Delivery Platform

TeleStore is a low-cost resource storage and delivery platform designed for websites that need to distribute large files while keeping infrastructure and storage costs low.

The system uses Telegram as the underlying file storage layer, while a lightweight VPS handles application logic, metadata management, request routing, caching, concurrency control, and resource delivery.

The architecture was designed around a simple goal:

> **Build a resource platform capable of serving large files and handling concurrent requests without requiring expensive object storage infrastructure.**

---

## Features

* Telegram-backed file storage
* Large file resource management
* Metadata indexing with MongoDB
* RESTful API built with Node.js
* File forwarding and retrieval through Telegram
* Resource caching
* Concurrent request control
* Duplicate request protection
* File download task management
* Lightweight VPS deployment
* Stateless API architecture
* Environment-based configuration
* Logging and error handling

---

## Architecture

```text
                         ┌──────────────────────┐
                         │       Client         │
                         │  Web / App / API     │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │     Node.js API      │
                         │                      │
                         │  Authentication      │
                         │  Resource API        │
                         │  Request Routing     │
                         │  Concurrency Control │
                         └──────────┬───────────┘
                                    │
                   ┌────────────────┼────────────────┐
                   │                │                │
                   ▼                ▼                ▼
          ┌────────────────┐ ┌───────────────┐ ┌──────────────┐
          │    MongoDB     │ │ Cache Layer   │ │ Task Manager │
          │                │ │               │ │              │
          │ File Metadata  │ │ Hot Resources │ │ Download /   │
          │ Message IDs    │ │ File Paths    │ │ Forward Jobs │
          │ File IDs       │ │ Request Lock  │ │              │
          └────────────────┘ └───────┬───────┘ └──────┬───────┘
                                     │                │
                                     └────────┬───────┘
                                              │
                                              ▼
                                   ┌────────────────────┐
                                   │  Telegram Storage  │
                                   │                    │
                                   │ Files / Documents  │
                                   │ Message Metadata   │
                                   └────────────────────┘
```

---

## Core Architecture

The system separates **metadata**, **application logic**, and **file storage**.

### 1. Application Server

A low-cost VPS runs the Node.js backend.

The VPS is responsible for:

* API requests
* Authentication
* Resource lookup
* Access control
* Telegram API communication
* Download/forward tasks
* Caching
* Concurrency management
* Logging

The application server does not need to permanently store every large resource file locally.

---

### 2. Telegram Storage Layer

Telegram is used as the underlying storage source for resource files.

Instead of storing large files directly on the VPS, the system stores references such as:

```text
chat_id
message_id
file_id
file_unique_id
file_size
file_path
```

This allows the application to locate the original resource without keeping a complete permanent copy on the application server.

---

### 3. MongoDB Metadata Layer

MongoDB stores resource metadata and indexes.

Example:

```json
{
  "resourceId": "example-resource",
  "fileName": "example.zip",
  "fileSize": 524288000,
  "fileId": "...",
  "fileUniqueId": "...",
  "chatId": "...",
  "messageId": 12345,
  "createdAt": "..."
}
```

The database is therefore used primarily for **resource discovery and metadata management**, rather than large binary storage.

---

# Request Flow

A typical resource request follows this flow:

```text
Client
  │
  │ GET /api/resource/:id
  ▼
Node.js API
  │
  ├── Check metadata
  │
  ├── Check cache
  │
  ├── Check active download task
  │
  ▼
MongoDB
  │
  │ Resource metadata
  ▼
Telegram
  │
  │ Retrieve / forward resource
  ▼
Cache / Delivery Layer
  │
  ▼
Client
```

For frequently requested resources, caching can reduce repeated requests to Telegram.

---

# Concurrency Control

One of the main engineering challenges is handling multiple users requesting the same large resource at the same time.

A naive implementation could create:

```text
100 users
   ↓
100 Telegram requests
   ↓
100 download tasks
```

This wastes bandwidth and increases the load on both the application and storage layers.

TeleStore instead uses request coordination to avoid unnecessary duplicate work.

For example:

```text
             ┌── User A
             │
             ├── User B
Resource ────┼── User C ──► Shared Task
             │
             └── User D
```

The first request can create the active retrieval task while subsequent requests reuse the same task or cached result.

This approach helps reduce duplicate downloads and improves resource utilization under concurrent traffic.

---

# Caching Strategy

The system uses caching to reduce repeated access to the underlying storage layer.

Conceptually:

```text
Request
   │
   ▼
Cache?
 ┌─┴───────────────┐
 │                 │
Hit               Miss
 │                 │
 ▼                 ▼
Return         Telegram
                  │
                  ▼
                Cache
                  │
                  ▼
                Return
```

Caching policies can be adjusted depending on:

* File size
* Request frequency
* Available disk space
* Resource popularity
* Cache expiration

This allows the VPS to act as a lightweight delivery layer instead of a permanent storage server.

---

# Tech Stack

## Backend

* Node.js
* Express.js
* JavaScript
* REST API

## Database

* MongoDB

## Storage / Delivery

* Telegram Bot API
* Telegram-based file storage
* Local temporary cache

## Infrastructure

* Linux
* Nginx
* Docker
* VPS

## Supporting Technologies

* Redis
* JWT
* HTTP caching
* File streaming
* Asynchronous task processing

---

# Project Structure

```text
telestore/
│
├── src/
│   ├── controllers/
│   ├── services/
│   ├── routes/
│   ├── models/
│   ├── middleware/
│   ├── utils/
│   └── config/
│
├── scripts/
│
├── tests/
│
├── docker/
│
├── .env.example
├── docker-compose.yml
├── package.json
└── README.md
```

The exact structure may vary depending on the deployment version.

---

# Getting Started

## Requirements

* Node.js 20+
* MongoDB
* Telegram Bot
* Linux VPS
* Nginx (optional)
* Docker (optional)

---

## Installation

Clone the repository:

```bash
git clone https://github.com/TangGuo11/TeleStore-Telegram-Backed-Resource-Storage-Delivery-Platform.git/telestore.git

cd telestore
```

Install dependencies:

```bash
npm install
```

Create the environment file:

```bash
cp .env.example .env
```

Configure the required environment variables.

---

# Environment Variables

Example:

```env
NODE_ENV=production

PORT=3000

MONGO_URI=mongodb://localhost:27017/telestore

TELEGRAM_BOT_TOKEN=your_bot_token

TELEGRAM_CHAT_ID=your_storage_chat_id

JWT_SECRET=your_secret

CACHE_DIR=./cache
```

> Never commit real credentials, bot tokens, database passwords, or private keys to GitHub.

---

# Running the Project

Development:

```bash
npm run dev
```

Production:

```bash
npm start
```

Using Docker:

```bash
docker compose up -d
```

---

# Deployment

A typical deployment uses:

```text
Internet
   │
   ▼
Nginx
   │
   ▼
Node.js Application
   │
   ├── MongoDB
   │
   ├── Cache
   │
   └── Telegram
```

The application can run on a small VPS because large permanent resource storage is separated from the application server.

This makes the architecture suitable for resource-heavy websites where storage requirements can grow significantly faster than application logic.

---

# Design Considerations

The project focuses on minimizing infrastructure requirements while maintaining a practical delivery architecture.

Instead of:

```text
Large VPS
+
Large Disk
+
Expensive Object Storage
+
CDN
```

the system separates responsibilities:

```text
Low-cost VPS
      +
Telegram Storage
      +
MongoDB Metadata
      +
Application-level Cache
      +
Concurrency Control
```

This allows the application layer to remain relatively lightweight even when the resource library becomes large.

---

# Security

The following practices are recommended:

* Store secrets in environment variables
* Never commit Telegram bot tokens
* Validate resource identifiers
* Validate uploaded metadata
* Implement authentication and authorization
* Apply request rate limiting
* Restrict administrative endpoints
* Validate file metadata before processing
* Use HTTPS in production

---

# Engineering Challenges

Some of the main engineering challenges addressed by this project include:

### Large File Handling

Large resources should not be treated like normal API payloads.

The system separates metadata operations from file retrieval and uses streaming/caching where appropriate.

### Concurrent Requests

Multiple users may request the same resource simultaneously.

Request coordination helps prevent duplicate retrieval tasks.

### Storage Cost

Traditional object storage can become expensive as a resource library grows.

The architecture separates application infrastructure from the underlying file storage layer.

### Resource Lookup

Instead of searching through files directly, MongoDB provides an indexed metadata layer for fast resource discovery.

---

# Future Improvements

Potential improvements include:

* Distributed caching
* Multi-instance application deployment
* Advanced rate limiting
* Background task queues
* Automatic cache eviction
* Resource popularity tracking
* Download analytics
* Multi-source storage support
* CDN integration
* Automated health checks
* Horizontal scaling

---

# Disclaimer

This project is an engineering experiment demonstrating a low-cost resource storage and delivery architecture.

The repository does not contain private credentials or production secrets.

Always review the terms, API limitations, and applicable policies of third-party services before deploying a production system.

---

## Author

Built as an independent engineering project focusing on:

* Backend development
* Distributed resource delivery
* Low-cost infrastructure
* File processing
* Concurrency control
* API design
* System architecture
