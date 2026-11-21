// Writes the committed snapshots: npm run fixtures
//   server/fixtures/drive.json  every document, comment and reply the mock server serves
//   tasks/expected.json         T1-T3 prompts and expected answers, computed from those fixtures
import { writeFileSync } from "node:fs";
import { buildTasks } from "../../tasks/src/tasks.js";
import { EXPECTED_PATH, FIXTURES_PATH } from "../../shared/paths.js";
import { generateDrive, serializeDrive } from "./fixtures.js";

const drive = generateDrive();
writeFileSync(FIXTURES_PATH, serializeDrive(drive));
writeFileSync(EXPECTED_PATH, `${JSON.stringify(buildTasks(drive), null, 2)}\n`);
console.log(`wrote ${FIXTURES_PATH}\nwrote ${EXPECTED_PATH}`);
