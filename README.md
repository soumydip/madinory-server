<!-- Server file -->

## Introduction

This is the server-side code for the Medinory project. It is built using Node.js and Express.js, and it serves as the backend for the application.

### Declerations

- I am using `pnpm` as the package manager for this project. If you don't have it installed, you can install it globally using npm:

```bash
npm install -g pnpm
```

Then you can install the dependencies using `pnpm`:

```bash
pnpm install
```

### Getting Started

- To get started with the server, follow these steps:

1. Clone the repository to your local machine.
2. Navigate to the `server` directory.
3. Install the dependencies using `pnpm install`.

### Requirements

- Node.js (version 14 or higher)
- pnpm (version 6 or higher)
- Git (version control)
- TypeScript (for development)

### Install in your local machine

To install the server on your local machine, follow these steps:

- Clone the repository to your local machine using Git:

```bash
git clone https://github.com/soumydip/madinory-server.git
```

- Navigate to the cloned directory:

```bash
cd madinory-server
```

- Install the dependencies using `pnpm`:

```bash
pnpm install
```

See the .env.example file for the required environment variables. Create a .env file in the root directory and add the necessary environment variables.

- To run the server in development mode, use the following command:

```bash
pnpm run dev
```

server will start running on the specified port (default is 5000). You can access the server at `http://localhost:5000`.

### Environment Variables

see the `.env.example` file for the required environment variables. Create a `.env` file in the root directory and add the necessary environment variables.

### Git Workflow

To avoid merge conflicts and keep everyone working on the latest code, follow this workflow:

- **Never push directly to `main`.** Always work on your own feature branch.

- Before starting new work, sync with the latest `main`:

```bash
git checkout main
git pull origin main
```

- Create a new branch for your task:

```bash
git checkout -b feature/your-task-name
```

- Work, commit, and push your branch:

```bash
git add .
git commit -m "your message"
git push origin feature/your-task-name
```

- Open a **Pull Request** on GitHub to merge your branch into `main`. Do not merge without review.

- `git pull` only updates the branch you're currently on. If you need to see all branches (yours and teammates'), fetch everything first:

```bash
git fetch --all
git branch -a
```

- If you already have a branch and want the latest changes from `main` merged into it (recommended daily, or before opening a PR):

```bash
git checkout feature/your-task-name
git pull origin main
```

### Important Note

- Before you start writing code each day, always run `git pull origin main` (after checking out `main`, or merge `main` into your feature branch) to get the latest code. This helps avoid merge conflicts and ensures you're working with the most up-to-date codebase.
