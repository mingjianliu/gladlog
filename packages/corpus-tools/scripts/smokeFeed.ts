import { fetchMatchStubs } from "../src/feedClient";
async function main() {
  const stubs = await fetchMatchStubs({
    bracket: "Rated Solo Shuffle",
    minRating: 2300,
    limit: 20,
  });
  console.log(`feed returned ${stubs.length} stubs >= 2300 (Solo Shuffle)`);
  if (stubs.length === 0) {
    console.error("GO/NO-GO FAIL: feed returned 0 stubs");
    process.exit(1);
  }
  console.log("GO: feed alive.");
}
main().catch((e) => {
  console.error("GO/NO-GO FAIL:", e);
  process.exit(1);
});
