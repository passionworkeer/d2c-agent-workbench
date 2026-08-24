import { buildApp } from "./app";

const app = buildApp();

await app.listen({ host: "127.0.0.1", port: 8787 });
