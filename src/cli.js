const { createFullBackup } = require("./backup");
const { initDatabase, closeDatabase } = require("./db");

async function main() {
  const command = process.argv[2];
  if (command === "backup") {
    initDatabase();
    const result = await createFullBackup();
    console.log(result.path);
    closeDatabase();
    return;
  }
  console.error("Perintah tersedia: backup");
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  closeDatabase();
  process.exitCode = 1;
});
