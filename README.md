# Ignition — Data Seeder

Small utility to generate test patients and seed a target API.

Quick commands

Install dependencies:

```powershell
npm install
```

Start the server (serves the UI at `/ui/index.html`):

```powershell
npm run start
```

Run the seeder from CLI:

```powershell
npm run seed -- --count=10 --url=http://localhost:3000/api/patients
```

Development with auto-reload (server):

```powershell
npm run dev:server
```

Notes
- The UI posts `{ args: [...] }` to `/seed` and the server runs the seeder in-process.
- `server/seeder.ts` contains the main orchestration and can be extended for streaming logs or concurrency.

