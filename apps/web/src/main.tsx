import { DbConnection } from "@scamshield/bindings";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SpacetimeDBProvider } from "spacetimedb/react";
import { App } from "./App";
import "./index.css";

const uri = import.meta.env.VITE_SPACETIME_URI ?? `ws://${window.location.hostname}:3000`;
const database = import.meta.env.VITE_SPACETIME_DB ?? "scamshield";

// No login in the MVP: every visitor connects anonymously and sees the same account.
const connectionBuilder = DbConnection.builder().withUri(uri).withDatabaseName(database);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <App />
    </SpacetimeDBProvider>
  </StrictMode>,
);
