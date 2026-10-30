import { seedDefaultData } from "./lib/seed";

async function main() {
  console.log("Starting database seed...");
  await seedDefaultData();
  console.log("Database seed finished successfully.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});

