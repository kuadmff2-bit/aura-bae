import { randomBytes } from "node:crypto";

const token = () => randomBytes(32).toString("base64url");
console.log("ADMIN_SETUP_TOKEN=" + token());
console.log("ASAAS_WEBHOOK_TOKEN=" + token());
