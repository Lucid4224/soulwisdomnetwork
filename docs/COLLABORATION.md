# Developer Collaboration Guide

This project is built using **Antigravity**. To maintain code quality and prevent conflicts, please follow this guide.

## 1. Setup (For the New Developer)

### Clone the Repository
```bash
git clone <repository-url>
cd soulwisdomnetwork
npm install
```

### Firebase Login
```bash
npx firebase login
```
This ensures you have the necessary permissions to interact with the project's backend.

### Environment Variables
1. Copy the template: `cp .env.example .env.local`
2. Ask the project owner for the specific values (Firebase keys, YouTube API, Gemini API, etc.).
3. Fill in `.env.local`. **DO NOT** commit this file.

### Firebase Access
Ask the owner to add your Google account to the Firebase console as an **Editor**.

---

## 2. Shared AI Context (Antigravity)

Antigravity uses the project files to understand the codebase. To get the best results:
- **Read the Docs**: Start by reading `docs/specs/` to understand current features.
- **Use Task Management**: Always look for the `task.md` in the `.gemini` folder (if shared) or create your own to track your work.

---

## 3. Workflow & Conflict Prevention

### The Branching Rule
**Never push directly to `main`.**

1. Create a feature branch: `git checkout -b feat/your-feature-name`
2. Make your changes using Antigravity.
3. Commit and push: `git push origin feat/your-feature-name`
4. Create a **Pull Request (PR)** on GitHub.zz

### Code Reviews
- Tag the other developer for review.
- Antigravity can help you summarize your changes for the PR description.
- Once approved, merge to `main`.

### Syncing
Before starting new work, always pull the latest changes:
```bash
git checkout main
git pull origin main
```

---

## 4. Communication
- Use GitHub Issues to track bugs or feature requests.
- Use the project's Discord/Slack for quick coordination.
