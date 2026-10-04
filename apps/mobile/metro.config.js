// Expo's default Metro config, plus one extra URL.
//
// `pnpm phone` reaches the database and the relay through tunnels whose
// addresses change whenever a tunnel is restarted. It writes the current
// addresses to .expo/endpoints.json, and the dev server hands that file to the
// app at /scamshield-endpoints.json, so the app can follow a tunnel that moved
// without being rebuilt.
const fs = require("fs");
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const endpointsFile = path.join(__dirname, ".expo", "endpoints.json");
const previous = config.server && config.server.enhanceMiddleware;

config.server = {
  ...config.server,
  enhanceMiddleware: (middleware, server) => {
    const base = previous ? previous(middleware, server) : middleware;
    return (req, res, next) => {
      if (req.url && req.url.split("?")[0] === "/scamshield-endpoints.json") {
        let body = "{}";
        try {
          body = fs.readFileSync(endpointsFile, "utf8");
        } catch {
          // No file: the app falls back to the machine that served it.
        }
        res.setHeader("content-type", "application/json");
        res.setHeader("cache-control", "no-store");
        res.setHeader("access-control-allow-origin", "*");
        res.end(body);
        return;
      }
      return base(req, res, next);
    };
  },
};

module.exports = config;
