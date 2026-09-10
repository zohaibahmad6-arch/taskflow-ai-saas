import fs from "node:fs";

/** Runs once before the whole test run: start with a completely fresh test DB. */
export default function globalSetup() {
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = `./data/test.db${suffix}`;
    if (fs.existsSync(p)) fs.rmSync(p);
  }
}
