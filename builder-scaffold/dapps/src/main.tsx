import React from "react";
import ReactDOM from "react-dom/client";
import "./main.css";

import { QueryClient } from "@tanstack/react-query";
import App from "./App.tsx";
import { Theme } from "@radix-ui/themes";
import { getDappBountyConfigOrNull } from "./env/bounty-config";
import { BountyDappProvider } from "./providers/BountyDappProvider";

const queryClient = new QueryClient();
getDappBountyConfigOrNull();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Theme appearance="dark">
      <BountyDappProvider queryClient={queryClient}>
        <App />
      </BountyDappProvider>
    </Theme>
  </React.StrictMode>,
);
