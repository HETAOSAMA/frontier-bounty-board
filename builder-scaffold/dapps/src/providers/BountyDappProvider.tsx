import { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DAppKitProvider } from "@mysten/dapp-kit-react";
import { dAppKit, NotificationProvider, VaultProvider } from "@evefrontier/dapp-kit";

export function BountyDappProvider(props: {
  children: ReactNode;
  queryClient: QueryClient;
}) {
  return (
    <QueryClientProvider client={props.queryClient}>
      <DAppKitProvider dAppKit={dAppKit}>
        <VaultProvider>
          <NotificationProvider>{props.children}</NotificationProvider>
        </VaultProvider>
      </DAppKitProvider>
    </QueryClientProvider>
  );
}
