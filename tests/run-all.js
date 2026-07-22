const { execFileSync } = require("node:child_process");
const path = require("node:path");

execFileSync(process.execPath, ["--test", path.join(__dirname, "class-admin-api.test.js")], { stdio: "inherit" });
execFileSync(process.execPath, ["--test", path.join(__dirname, "chat-store.test.js")], { stdio: "inherit" });
execFileSync(process.execPath, ["--test", path.join(__dirname, "chat-api.test.js")], { stdio: "inherit" });
execFileSync(process.execPath, ["--test", path.join(__dirname, "chat-realtime.test.js")], { stdio: "inherit" });
execFileSync(process.execPath, ["--test", path.join(__dirname, "chat-load.test.js")], { stdio: "inherit" });
execFileSync(process.execPath, ["--test", path.join(__dirname, "class-sync-script.test.js")], { stdio: "inherit" });
execFileSync(process.execPath, ["--test", path.join(__dirname, "chat-frontend-contract.test.js")], { stdio: "inherit" });
execFileSync(process.execPath, ["--test", path.join(__dirname, "quality-rules.test.js")], { stdio: "inherit" });
execFileSync(process.execPath, ["--test", path.join(__dirname, "quality-store.test.js")], { stdio: "inherit" });
execFileSync(process.execPath, ["--test", path.join(__dirname, "quality-api.test.js")], { stdio: "inherit" });
execFileSync(process.execPath, ["--test", path.join(__dirname, "quality-evidence.test.js")], { stdio: "inherit" });

require("./class-domain.test.js");
require("./class-store.test.js");
require("./timetable-core.test.js");
require("./security-policy.test.js");
require("./asset-contract.test.js");
require("./site-smoke.test.js");
