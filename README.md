<!-- Server file -->

## Introduction

This is the server-side code for the Madinory project. It is built using Node.js and Express.js, and it serves as the backend for the application.

### Declerations

- I am using `pnpm` as the package manager for this project. If you don't have it installed, you can install it globally using npm:

```bash
npm install -g pnpm
```

Then you can install the dependencies using `pnpm install`.

### Getting Started

- To get started with the server, follow these steps:

1. Clone the repository to your local machine.
2. Navigate to the `server` directory.
3. Install the dependencies using `pnpm install`.

### Requirements

- Node.js (version 14 or higher)
- pnpm (version 6 or higher)
- Git (version control)
- Docker (Redis Container)

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

server will start running on the specified port (default is 3000). You can access the server at `http://localhost:5000`.



